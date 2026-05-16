import sqlite3
from pathlib import Path

db = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
c = sqlite3.connect(db)
rows = c.execute(
    "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composer.content.%' LIMIT 30"
).fetchall()
for key, val in rows:
    s = val if isinstance(val, str) else val.decode("utf-8", "ignore")
    print("---", key[-20:], "---")
    print(s[:800])
    print()
c.close()
