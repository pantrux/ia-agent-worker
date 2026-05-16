import sqlite3
from pathlib import Path

db = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
c = sqlite3.connect(db)
for (key,) in c.execute(
    "SELECT key FROM cursorDiskKV WHERE key LIKE '%Rule%' OR key LIKE '%rule%' LIMIT 200"
):
    if "ofsContent" not in key and "bubbleId" not in key:
        print(key)
c.close()
