import sqlite3
from pathlib import Path

db = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
c = sqlite3.connect(db)
needles = [
    b"creating-pull-requests",
    b"committing-changes-with-git",
    b"<user_rules>",
    b"Rules for AI",
]
for table in ("ItemTable", "cursorDiskKV"):
    print(f"=== {table} ===")
    for key, val in c.execute(f"SELECT key, value FROM {table}"):
        if val is None:
            continue
        blob = val if isinstance(val, bytes) else val.encode("utf-8", "ignore")
        for n in needles:
            if n in blob and len(blob) < 200000:
                print(f"  {n.decode()!r} -> {key[:100]} len={len(blob)}")
                if table == "ItemTable":
                    s = blob.decode("utf-8", "ignore")
                    print(s[:600])
                break
c.close()
