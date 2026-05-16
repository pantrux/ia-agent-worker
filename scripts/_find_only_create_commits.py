import sqlite3
from pathlib import Path

db = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
c = sqlite3.connect(db)
needle = b"Only create commits"
for table in ("ItemTable", "cursorDiskKV"):
    for key, val in c.execute(f"SELECT key, value FROM {table}"):
        if val and needle in (val if isinstance(val, bytes) else val.encode()):
            print(table, key[:120])
c.close()
