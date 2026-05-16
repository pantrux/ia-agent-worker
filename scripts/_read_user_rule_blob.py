import sqlite3
from pathlib import Path

db = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
c = sqlite3.connect(db)
for key in (
    "composer.content.dbab859546c6f75589f2f2f3028321d96877a60be2f0bc8634a087ff68d2d1eb",
    "agentKv:blob:980d6c6cd3192dcb3900fec2f093a8788935895a1e0cdf5f53160a92538b3b31",
):
    row = c.execute("SELECT value FROM cursorDiskKV WHERE key=?", (key,)).fetchone()
    if not row:
        print(key, "NOT FOUND")
        continue
    text = row[0] if isinstance(row[0], str) else row[0].decode("utf-8", "ignore")
    print("===", key[:60], "len", len(text), "===")
    print(text[:2500])
    print()
c.close()
