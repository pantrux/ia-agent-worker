#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prueba por consola el mismo flujo GitHub Copilot que TradingAgents-crypto (llm_provider github-copilot):

  1) Lee el token OAuth de GitHub desde un JSON (igual que el contenedor: clave `access_token`).
  2) GET https://api.github.com/copilot_internal/v2/token (mismas cabeceras que trading_graph.py).
  3) Si falla el intercambio, usa el token de GitHub como Bearer (fallback del contenedor).
  4) POST chat completions contra https://api.githubcopilot.com/v1/chat/completions con modelo gpt-4o.

No usa models.github.ai (GitHub Models REST); replica el host y modelo del contenedor.

Ejemplos:

  # Copia github_token.json del NAS (misma forma que /app/data/github_token.json) a ./data/
  python scripts/probe_github_copilot_chat.py --token-file data/github_token.json

  # O pega el access_token de OAuth directamente (sin guardar archivo)
  python scripts/probe_github_copilot_chat.py --token gho_...

Requisitos: Python 3.9+ (solo stdlib).
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


def _exchange_copilot(gh_token: str, timeout: int) -> tuple[str, str]:
    """Devuelve (bearer_para_chat, descripcion)."""
    url = "https://api.github.com/copilot_internal/v2/token"
    headers = {
        "Authorization": f"token {gh_token}",
        "Accept": "application/json",
        "Editor-Version": "vscode/1.90.0",
        "Editor-Plugin-Version": "copilot-chat/0.17.2024051401",
        "User-Agent": "GitHubCopilot/1.155.0",
    }
    status, body = _http_json("GET", url, headers, None, timeout)
    if status == 200 and isinstance(body, dict):
        tok = (body.get("token") or "").strip()
        if tok:
            return tok, "copilot_internal/v2/token"
    print(
        f"Intercambio Copilot HTTP {status} (mismo fallback que el contenedor: token GitHub como Bearer).",
        file=sys.stderr,
    )
    return gh_token, "github_oauth_token_fallback"


def _copilot_chat(
    bearer: str,
    base: str,
    model: str,
    user_message: str,
    timeout: int,
) -> tuple[int, Any]:
    base = base.rstrip("/")
    url = f"{base}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {bearer}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": user_message}],
        "stream": False,
    }
    status, body = _http_json("POST", url, headers, payload, timeout)
    return status, body


def main() -> int:
    p = argparse.ArgumentParser(
        description="Prueba chat GitHub Copilot (mismo flujo que TradingAgents-crypto github-copilot).",
    )
    p.add_argument(
        "--token-file",
        default="",
        help="JSON con access_token (como data/github_token.json del contenedor)",
    )
    p.add_argument("--token", default="", help="OAuth access_token de GitHub (alternativa a --token-file)")
    p.add_argument(
        "--copilot-api-base",
        default="https://api.githubcopilot.com",
        help="Base URL del API Copilot (igual que trading_graph.py)",
    )
    p.add_argument("--model", default="gpt-4o", help="Modelo (el contenedor fuerza gpt-4o)")
    p.add_argument("--message", "-m", default="Responde solo: OK", help="Mensaje de usuario")
    p.add_argument(
        "--skip-copilot-status",
        action="store_true",
        help="No llamar a GET /user/copilot (solo depuracion en el contenedor)",
    )
    p.add_argument("--timeout", type=int, default=120, help="Timeout en segundos")
    args = p.parse_args()

    gh = _read_access_token(args)

    if not args.skip_copilot_status:
        st, copilot_user = _http_json(
            "GET",
            "https://api.github.com/user/copilot",
            {"Authorization": f"token {gh}", "Accept": "application/vnd.github+json"},
            None,
            args.timeout,
        )
        print(f"GET /user/copilot -> HTTP {st}", file=sys.stderr)
        if isinstance(copilot_user, (dict, list)):
            print(json.dumps(copilot_user, indent=2, ensure_ascii=False), file=sys.stderr)
        else:
            print(str(copilot_user)[:800], file=sys.stderr)

    bearer, source = _exchange_copilot(gh, args.timeout)
    print(f"Bearer usado: {source}", file=sys.stderr)

    api_base = args.copilot_api_base.strip()
    status, body = _copilot_chat(bearer, api_base, args.model.strip(), args.message.strip(), args.timeout)
    print(f"POST {api_base.rstrip('/')}/v1/chat/completions model={args.model!r} -> HTTP {status}", file=sys.stderr)
    if isinstance(body, (dict, list)):
        print(json.dumps(body, indent=2, ensure_ascii=False))
    else:
        print(body)
    return 0 if 200 <= status < 300 else 1


if __name__ == "__main__":
    raise SystemExit(main())
