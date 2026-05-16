import sqlite3
from pathlib import Path

db = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
c = sqlite3.connect(db)
for key, val in c.execute("SELECT key, value FROM ItemTable"):
    s = val if isinstance(val, str) else val.decode("utf-8", "ignore")
    if "rule" in key.lower() or "rule" in s[:5000].lower():
        if "cursor.feature" not in key and "glass/" not in key:
            print("KEY:", key[:120], "len", len(s))
c.close()
