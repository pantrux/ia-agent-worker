import json
import sqlite3
from pathlib import Path

db = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
c = sqlite3.connect(db)
row = c.execute(
    "SELECT value FROM ItemTable WHERE key=?",
    (
        "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser",
    ),
).fetchone()
data = json.loads(row[0])


def all_keys(obj, prefix=""):
    if isinstance(obj, dict):
        for k, val in obj.items():
            p = f"{prefix}.{k}" if prefix else k
            yield p
            yield from all_keys(val, p)

for k in sorted(all_keys(data)):
    print(k)
c.close()
