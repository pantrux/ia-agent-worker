import sqlite3
from pathlib import Path

db = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
c = sqlite3.connect(db)
prefixes = {}
for (key,) in c.execute(
    "SELECT key FROM cursorDiskKV WHERE key LIKE 'composer.%' OR key LIKE '%user%rule%' OR key LIKE '%UserRule%'"
):
    p = key.split(".")[0] if "." in key else key.split(":")[0]
    prefixes[p] = prefixes.get(p, 0) + 1
print("prefix counts:", dict(sorted(prefixes.items(), key=lambda x: -x[1])[:30]))
for (key,) in c.execute(
    "SELECT key FROM cursorDiskKV WHERE key LIKE 'composer.%' AND key NOT LIKE 'composer.content.%' LIMIT 80"
):
    print(key)
c.close()
