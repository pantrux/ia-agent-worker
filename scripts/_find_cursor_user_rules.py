import json
import re
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
text = row[0] if isinstance(row[0], str) else row[0].decode("utf-8")
for needle in ("userRules", "globalRules", "rulesForAI", "cursorRules", "projectRules"):
    print(needle, text.find(needle))
data = json.loads(text)

def walk(obj, path=""):
    if isinstance(obj, dict):
        for k, val in obj.items():
            p = f"{path}.{k}" if path else k
            if re.search(r"rule", k, re.I):
                preview = val if isinstance(val, (str, int, bool)) else type(val).__name__
                print("KEY", p, "=>", str(preview)[:400])
            walk(val, p)
    elif isinstance(obj, list):
        for i, val in enumerate(obj):
            walk(val, f"{path}[{i}]")

walk(data)
c.close()
