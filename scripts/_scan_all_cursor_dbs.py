"""Escanea todas las bases state.vscdb de Cursor buscando reglas de usuario."""
import sqlite3
from pathlib import Path

CURSOR = Path.home() / "AppData/Roaming/Cursor"
NEEDLES = ("userRules", "User Rules", "pr-review", "Greptile", "alwaysApply", "personal rule")


def scan_db(db_path: Path) -> None:
    try:
        c = sqlite3.connect(db_path)
        tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        for table in tables:
            try:
                cols = [r[1] for r in c.execute(f"PRAGMA table_info({table})")]
                if "key" in cols and "value" in cols:
                    for key, val in c.execute(f"SELECT key, value FROM {table}"):
                        s = val if isinstance(val, str) else val.decode("utf-8", "ignore")
                        kl = key.lower() if isinstance(key, str) else ""
                        if "rule" in kl or any(n.lower() in s[:8000].lower() for n in NEEDLES):
                            if len(s) < 500000:
                                print(f"\n{db_path.name} [{table}] {key[:80]} len={len(s)}")
                                if "pr-review" in s or "Greptile al" in s:
                                    print("  >>> MATCH pr-review content")
            except sqlite3.Error:
                pass
        c.close()
    except sqlite3.Error as e:
        print(f"skip {db_path}: {e}")


def main() -> None:
    for db in CURSOR.rglob("state.vscdb"):
        scan_db(db)


if __name__ == "__main__":
    main()
