# Throwaway: run one Zetaris SQL statement per argument via REST, print result. Reads ../.env
import os, sys, uuid, json, time, requests
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))
URL = os.environ["ZETARIS_REST_URL"].rstrip("/") + "/sql-editor/sqls/run"
H = {"Authorization": "Bearer " + os.environ["ZETARIS_API_KEY"], "X-Org-ID": os.environ["ZETARIS_ORG_ID"]}
for sql in sys.argv[1:]:
    t = time.time()
    r = requests.post(URL, headers={**H, "X-Request-ID": str(uuid.uuid4())},
                      json={"queryId": str(uuid.uuid4()), "sql": sql, "source": "SqlEditor", "limit": 50}, timeout=300)
    print(f"\n### {sql[:110]}\n### HTTP {r.status_code} in {time.time()-t:.1f}s")
    try:
        j = r.json(); cols = j.get("columns") or j.get("schema") or ""
        if cols: print("columns:", json.dumps(cols)[:400])
        data = j.get("data")
        if isinstance(data, list):
            print(f"rows: {len(data)}")
            for row in data[:20]: print("  ", json.dumps(row)[:220])
        else: print(json.dumps(j)[:1500])
    except Exception: print(r.text[:1500])
