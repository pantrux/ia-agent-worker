#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prueba CLI el flujo Copilot alineado con TradingAgents-crypto + ajustes para GitHub actual.

- Valida credencial: GET https://api.github.com/user (REST + X-GitHub-Api-Version).
  El NAS llama GET /user/copilot (trading_graph.py); esa ruta suele dar 404 en la API publica.
- Intercambio: GET /copilot_internal/v2/token con cabeceras NAS + Accept vnd.github+json + X-GitHub-Api-Version.
- Chat: POST {base}/chat/completions (misma ruta que OpenAI SDK en el contenedor NAS; no /v1) con cabeceras de cliente Copilot;
  prueba bases del JSON de intercambio, luego https://api.githubcopilot.com y https://api.individual.githubcopilot.com.

Requisitos: Python 3.9+ (stdlib).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


def _read_access_token(args: argparse.Namespace) -> str:
    raw = (args.token or "").strip()
    if raw:
        return raw
    path = (args.token_file or os.environ.get("GITHUB_TOKEN_FILE") or "").strip()
    if not path:
        print(
            "Indica --token o --token-file (o GITHUB_TOKEN_FILE) con el OAuth access_token de GitHub.",
            file=sys.stderr,
        )
        sys.exit(2)
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    t = (data.get("access_token") or "").strip()
    if not t:
        print("El JSON no contiene access_token.", file=sys.stderr)
        sys.exit(2)
    return t


def _http_json(
    method: str,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any] | None,
    timeout: int,
) -> tuple[int, dict[str, Any] | list[Any] | str]:
    data_bytes = None
    h = {**headers}
    if body is not None:
        data_bytes = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data_bytes, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            status = resp.status
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace") if e.fp else ""
        status = e.code
    try:
        parsed: dict[str, Any] | list[Any] | str = json.loads(text)
    except json.JSONDecodeError:
        parsed = text
    return status, parsed


def _github_rest_headers(gh_token: str, api_version: str) -> dict[str, str]:
    return {
        "Authorization": f"token {gh_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": api_version,
    }


def _exchange_headers(gh_token: str, api_version: str) -> dict[str, str]:
    return {
        "Authorization": f"token {gh_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": api_version,
        "Editor-Version": "vscode/1.90.0",
        "Editor-Plugin-Version": "copilot-chat/0.17.2024051401",
        "User-Agent": "GitHubCopilot/1.155.0",
    }


def _chat_headers(bearer: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {bearer}",
        "Content-Type": "application/json",
        "Editor-Version": "vscode/1.90.0",
        "Editor-Plugin-Version": "copilot-chat/0.17.2024051401",
        "User-Agent": "GitHubCopilot/1.155.0",
        "Copilot-Integration-Id": "vscode-chat",
    }


def _bases_from_exchange(data: dict[str, Any] | None) -> list[str]:
    if not data or not isinstance(data, dict):
        return []
    out: list[str] = []
    for k in ("base_url", "baseUrl", "api_url", "endpoint"):
        v = data.get(k)
        if isinstance(v, str) and v.strip():
            out.append(v.strip().rstrip("/"))
    ep = data.get("endpoints")
    if isinstance(ep, dict):
        for k2 in ("api", "chat", "models"):
            v2 = ep.get(k2)
            if isinstance(v2, str) and v2.strip():
                out.append(v2.strip().rstrip("/"))
    seen: set[str] = set()
    uniq: list[str] = []
    for b in out:
        if b not in seen:
            seen.add(b)
            uniq.append(b)
    return uniq


def _exchange_copilot(gh_token: str, api_version: str, timeout: int) -> tuple[str, str, dict[str, Any] | None]:
    url = "https://api.github.com/copilot_internal/v2/token"
    status, body = _http_json("GET", url, _exchange_headers(gh_token, api_version), None, timeout)
    if status == 200 and isinstance(body, dict):
        tok = str(body.get("token") or "").strip()
        if tok:
            return tok, "copilot_internal/v2/token", body
    print(
        f"Intercambio Copilot HTTP {status} (fallback: token GitHub OAuth como Bearer).",
        file=sys.stderr,
    )
    return gh_token, "github_oauth_token_fallback", body if isinstance(body, dict) else None


def _copilot_chat(
    bearer: str,
    base: str,
    model: str,
    user_message: str,
    timeout: int,
) -> tuple[int, Any]:
    base = base.rstrip("/")
    url = f"{base}/chat/completions"
    headers = _chat_headers(bearer)
    payload: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": user_message}],
        "stream": False,
    }
    return _http_json("POST", url, headers, payload, timeout)


def main() -> int:
    p = argparse.ArgumentParser(description="Prueba GitHub Copilot (TradingAgents + cabeceras actuales).")
    p.add_argument("--token-file", default="", help="JSON con access_token")
    p.add_argument("--token", default="", help="OAuth access_token")
    p.add_argument(
        "--github-api-version",
        default=os.environ.get("GITHUB_TOKEN_API_VERSION", "2026-03-10"),
        help="X-GitHub-Api-Version para api.github.com",
    )
    p.add_argument("--copilot-api-base", default="", help="Si se indica, solo se prueba ese host (sin rotacion)")
    p.add_argument("--model", default="gpt-4o", help="Modelo")
    p.add_argument("--message", "-m", default="Responde solo: OK", help="Mensaje usuario")
    p.add_argument(
        "--legacy-nas-user-copilot",
        action="store_true",
        help="Ademas llama GET /user/copilot como el NAS (suele 404)",
    )
    p.add_argument("--skip-user", action="store_true", help="No llamar GET /user")
    p.add_argument("--timeout", type=int, default=120)
    args = p.parse_args()

    gh = _read_access_token(args)
    ver = args.github_api_version.strip()

    if not args.skip_user:
        st, u = _http_json("GET", "https://api.github.com/user", _github_rest_headers(gh, ver), None, args.timeout)
        print(f"GET /user -> HTTP {st}", file=sys.stderr)
        if isinstance(u, dict):
            print(json.dumps({"login": u.get("login"), "id": u.get("id")}, indent=2), file=sys.stderr)

    if args.legacy_nas_user_copilot:
        st2, raw = _http_json(
            "GET",
            "https://api.github.com/user/copilot",
            {"Authorization": f"token {gh}"},
            None,
            args.timeout,
        )
        print(f"GET /user/copilot (legacy NAS) -> HTTP {st2}", file=sys.stderr)
        print(json.dumps(raw, indent=2, ensure_ascii=False) if isinstance(raw, (dict, list)) else str(raw)[:800], file=sys.stderr)

    bearer, source, ex_body = _exchange_copilot(gh, ver, args.timeout)
    print(f"Bearer: {source}", file=sys.stderr)

    bases = _bases_from_exchange(ex_body)
    for fb in ("https://api.githubcopilot.com", "https://api.individual.githubcopilot.com"):
        if fb not in bases:
            bases.append(fb)
    if args.copilot_api_base.strip():
        bases = [args.copilot_api_base.strip().rstrip("/")]

    last_status = 0
    last_body: Any = None
    for b in bases:
        print(f"POST {b}/chat/completions ...", file=sys.stderr)
        status, body = _copilot_chat(bearer, b, args.model.strip(), args.message.strip(), args.timeout)
        last_status, last_body = status, body
        if 200 <= status < 300:
            print(json.dumps(body, indent=2, ensure_ascii=False) if isinstance(body, (dict, list)) else body)
            return 0
        print(f"HTTP {status} en {b}", file=sys.stderr)
        if isinstance(body, (dict, list)):
            print(json.dumps(body, indent=2, ensure_ascii=False)[:1200], file=sys.stderr)
        else:
            print(str(body)[:800], file=sys.stderr)

    print(f"Ultimo HTTP {last_status}", file=sys.stderr)
    if isinstance(last_body, (dict, list)):
        print(json.dumps(last_body, indent=2, ensure_ascii=False))
    else:
        print(last_body)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
