import sqlite3
from pathlib import Path

db = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
c = sqlite3.connect(db)
needle = b"Only create commits"
for table in ("ItemTable", "cursorDiskKV"):
    for key, val in c.execute(f"SELECT key, value FROM {table}"):
        if val is None:
            continue
        blob = val if isinstance(val, bytes) else val.encode("utf-8", "ignore")
        if needle in blob:
            print(f"HIT {table} key={key[:120]} len={len(blob)}")
c.close()
