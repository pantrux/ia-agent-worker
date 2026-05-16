import sqlite3
from pathlib import Path

db = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
c = sqlite3.connect(db)
tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("tables:", tables)
for table in tables:
    cols = [r[1] for r in c.execute(f"PRAGMA table_info({table})")]
    print(table, cols)
    if table == "cursorDiskKV":
        count = c.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  rows: {count}")
        for row in c.execute(f"SELECT key FROM {table} LIMIT 50"):
            k = row[0]
            if k and ("rule" in k.lower() or "user" in k.lower() or "memory" in k.lower()):
                print("  key:", k[:120])
c.close()
