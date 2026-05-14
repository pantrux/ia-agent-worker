#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prueba por consola: inferencia REST en GitHub Models o POST /api/chat del Worker.

Requisitos: Python 3.9+ (solo biblioteca estándar).

Inferencia directa (mismo contrato que documenta GitHub; útil para aislar 403/404 del token):
  set COPILOT_GITHUB_TOKEN=ghp_...
  python scripts/probe_github_models_inference.py

Con organización (endpoint /orgs/{org}/inference/...):
  python scripts/probe_github_models_inference.py --org mi-org

Contra el Worker (pasa por LangGraph; opcional BFF):
  python scripts/probe_github_models_inference.py --worker https://ia-agent-worker.xxx.workers.dev --message "hola"
  python scripts/probe_github_models_inference.py --worker ... --bff-token "$env:BFF_API_TOKEN"
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


def _token(args: argparse.Namespace) -> str:
    t = (args.token or os.environ.get("COPILOT_GITHUB_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
    if not t:
        print(
            "Falta token. Define COPILOT_GITHUB_TOKEN (o GITHUB_TOKEN) o usa --token.",
            file=sys.stderr,
        )
        sys.exit(2)
    return t


def _github_url(org: str | None) -> str:
    if org and org.strip():
        o = org.strip()
        return f"https://models.github.ai/orgs/{urllib.parse.quote(o, safe='')}/inference/chat/completions"
    return "https://models.github.ai/inference/chat/completions"


def _post_json(url: str, headers: dict[str, str], payload: dict[str, Any], timeout: int) -> tuple[int, str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={**headers, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.status, body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        return e.code, body


def run_github(args: argparse.Namespace) -> int:
    token = _token(args)
    url = _github_url(args.org)
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": args.api_version.strip(),
    }
    payload: dict[str, Any] = {
        "model": args.model.strip(),
        "messages": [{"role": "user", "content": args.message.strip()}],
        "stream": False,
    }
    print(f"POST {url}", file=sys.stderr)
    print(f"model={payload['model']!r}", file=sys.stderr)
    status, body = _post_json(url, headers, payload, args.timeout)
    print(f"HTTP {status}", file=sys.stderr)
    try:
        obj = json.loads(body)
        print(json.dumps(obj, indent=2, ensure_ascii=False))
    except json.JSONDecodeError:
        print(body)
    return 0 if 200 <= status < 300 else 1


def run_worker(args: argparse.Namespace) -> int:
    base = args.worker.rstrip("/")
    url = f"{base}/api/chat"
    headers = {"Content-Type": "application/json"}
    bff = (args.bff_token or os.environ.get("BFF_API_TOKEN") or "").strip()
    if bff:
        headers["Authorization"] = f"Bearer {bff}"
    payload: dict[str, Any] = {"message": args.message.strip()}
    if args.thread_id:
        payload["thread_id"] = args.thread_id.strip()
    print(f"POST {url}", file=sys.stderr)
    status, body = _post_json(url, headers, payload, args.timeout)
    print(f"HTTP {status}", file=sys.stderr)
    try:
        obj = json.loads(body)
        print(json.dumps(obj, indent=2, ensure_ascii=False))
    except json.JSONDecodeError:
        print(body)
    return 0 if 200 <= status < 300 else 1


def main() -> int:
    p = argparse.ArgumentParser(
        description="Prueba inferencia GitHub Models o POST /api/chat del Worker.",
    )
    p.add_argument(
        "--mode",
        choices=("github", "worker"),
        default="github",
        help="github = REST models.github.ai; worker = POST /api/chat",
    )
    p.add_argument("--token", default="", help="Bearer GitHub (por defecto COPILOT_GITHUB_TOKEN)")
    p.add_argument("--model", default="openai/gpt-4o-mini", help="Id de modelo (solo modo github)")
    p.add_argument("--message", "-m", default="hola", help="Mensaje de usuario")
    p.add_argument(
        "--org",
        default="",
        help="Login org GitHub: URL /orgs/{org}/inference/chat/completions (solo github)",
    )
    p.add_argument(
        "--api-version",
        default="2026-03-10",
        help="Cabecera X-GitHub-Api-Version (solo github)",
    )
    p.add_argument(
        "--worker",
        default="",
        help="URL base del Worker (sin barra final); activa modo worker si se pasa",
    )
    p.add_argument("--bff-token", default="", help="Authorization Bearer para BFF (solo worker)")
    p.add_argument("--thread-id", default="", help="UUID opcional de hilo (solo worker)")
    p.add_argument("--timeout", type=int, default=120, help="Timeout HTTP en segundos")
    args = p.parse_args()

    if args.worker.strip():
        args.mode = "worker"
        args.worker = args.worker.strip()

    if args.mode == "worker":
        if not args.worker:
            print("Modo worker: indica --worker https://...", file=sys.stderr)
            return 2
        return run_worker(args)
    return run_github(args)


if __name__ == "__main__":
    raise SystemExit(main())
