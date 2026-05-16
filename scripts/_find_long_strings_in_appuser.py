import json
import sqlite3
from pathlib import Path

db = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
c = sqlite3.connect(db)
key = (
    "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl"
    ".persistentStorage.applicationUser"
)
data = json.loads(c.execute("SELECT value FROM ItemTable WHERE key=?", (key,)).fetchone()[0])


def walk(obj, path=""):
    if isinstance(obj, str) and len(obj) > 400:
        if any(x in obj for x in ("commit", "Greptile", "pull request", "merge")):
            print(f"STR {path} len={len(obj)}")
            print(obj[:400])
            print("---")
    elif isinstance(obj, dict):
        for k, v in obj.items():
            walk(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            walk(v, f"{path}[{i}]")


walk(data)
c.close()
