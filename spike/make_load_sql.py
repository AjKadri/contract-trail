# Throwaway: generate Postgres DDL + COPY for selected OCDS CSVs (all columns as text).
import csv, os, sys
csv.field_size_limit(10**9)
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
SETS = {
  "bpp":    [("csv_64/full/awards.csv", "bpp_awards"), ("csv_64/full/awards_suppliers.csv", "bpp_awards_suppliers")],
  "states": [("csv_118/full/awards.csv", "osun_awards"), ("csv_118/full/awards_suppliers.csv", "osun_awards_suppliers"),
             ("csv_106/full/main.csv", "oyo_main"), ("csv_106/full/tender_items.csv", "oyo_tender_items")],
}
for db, files in SETS.items():
    out = [f"-- load for database {db}"]
    for rel, table in files:
        with open(os.path.join(D, rel), newline="", encoding="utf-8", errors="replace") as f:
            cols = next(csv.reader(f))
        cols_sql = ", ".join('"%s" text' % c.replace('"', '') for c in cols)
        out += [f'DROP TABLE IF EXISTS {table};', f'CREATE TABLE {table} ({cols_sql});',
                f"COPY {table} FROM '/data/{rel}' WITH (FORMAT csv, HEADER true);",
                f"SELECT '{table}' AS t, count(*) FROM {table};"]
    open(os.path.join(D, f"load_{db}.sql"), "w").write("\n".join(out) + "\n")
    print("wrote", f"data/load_{db}.sql")
