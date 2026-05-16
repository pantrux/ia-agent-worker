"""Busca dónde Cursor guarda User Rules (global) en Windows."""
import json
import re
import sqlite3
from pathlib import Path

DB = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"


def main() -> None:
    c = sqlite3.connect(DB)
    print("=== ItemTable keys con 'rule' ===")
    for (key,) in c.execute("SELECT key FROM ItemTable WHERE lower(key) LIKE '%rule%'"):
        print(key)

    app_key = (
        "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl"
        ".persistentStorage.applicationUser"
    )
    row = c.execute("SELECT value FROM ItemTable WHERE key=?", (app_key,)).fetchone()
    if not row:
        print("applicationUser not found")
        c.close()
        return

    text = row[0] if isinstance(row[0], str) else row[0].decode("utf-8")
    data = json.loads(text)

    def walk(obj, path: str = "") -> None:
        if isinstance(obj, dict):
            for k, val in obj.items():
                p = f"{path}.{k}" if path else k
                if re.search(r"rule", k, re.I):
                    preview = val if isinstance(val, (str, int, bool)) else type(val).__name__
                    print(f"KEY {p} => {str(preview)[:500]}")
                walk(val, p)
        elif isinstance(obj, list) and len(obj) < 50:
            for i, val in enumerate(obj):
                walk(val, f"{path}[{i}]")

    print("\n=== applicationUser keys con 'rule' ===")
    walk(data)

    c.close()


if __name__ == "__main__":
    main()
