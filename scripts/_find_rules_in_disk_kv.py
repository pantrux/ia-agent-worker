import sqlite3
from pathlib import Path

db = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
c = sqlite3.connect(db)
patterns = ("%rule%", "%Rule%", "%userRule%", "%memories%")
for pat in patterns:
    rows = c.execute(
        "SELECT key FROM cursorDiskKV WHERE key LIKE ? LIMIT 30", (pat,)
    ).fetchall()
    if rows:
        print(f"\n=== LIKE {pat} ({len(rows)} shown) ===")
        for (k,) in rows:
            print(k[:150])
c.close()
