import sqlite3
from pathlib import Path

db = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
c = sqlite3.connect(db)
needles = ("userRules", "globalUserRules", "rulesForAI", "cursorRules", "personalRules")
for needle in needles:
    rows = c.execute(
        "SELECT key, length(value) FROM cursorDiskKV WHERE key LIKE ? LIMIT 20",
        (f"%{needle}%",),
    ).fetchall()
    if rows:
        print(needle, rows[:10])

# Buscar valor que contenga texto de merge Greptile
row = c.execute(
    "SELECT key, substr(value,1,200) FROM cursorDiskKV WHERE value LIKE ? LIMIT 5",
    ("%Greptile al máximo%",),
).fetchall()
print("content hits:", row)
c.close()
