#!/bin/bash
# Spike phase 2: Postgres with OCDS data on Zetaris's network, register in Zetaris, run cross-publisher queries. Throwaway.
set -e
cd "$(dirname "$0")"
API=$(docker ps --format '{{.Names}}' | grep -E '(^|[-_])api([-_]|$)' | head -1)
NET=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$API" | awk '{print $1}')
echo "Zetaris api container: $API  network: $NET"
python3 make_load_sql.py
docker rm -f ct-pg >/dev/null 2>&1 || true
docker run -d --name ct-pg --network "$NET" -e POSTGRES_PASSWORD=spikepass -v "$PWD/data":/data:ro postgres:16-alpine >/dev/null
echo -n "waiting for postgres"; sleep 3; until docker exec ct-pg psql -U postgres -tAc "select 1" 2>/dev/null | grep -q 1; do echo -n .; sleep 2; done; sleep 2; echo " ready"
docker exec ct-pg psql -U postgres -qc "CREATE DATABASE bpp;" -c "CREATE DATABASE states;"
docker exec ct-pg psql -U postgres -d bpp -q -f /data/load_bpp.sql
docker exec ct-pg psql -U postgres -d states -q -f /data/load_states.sql
source ../.venv/bin/activate
python zsql.py \
 "CREATE DATASOURCE bpp_pg DESCRIBE BY 'BPP federal OCDS' OPTIONS (jdbcdriver 'org.postgresql.Driver', jdbcurl 'jdbc:postgresql://ct-pg:5432/bpp', username 'postgres', password 'spikepass', fetchsize '1000')" \
 "REGISTER DATASOURCE TABLES FROM bpp_pg" \
 "CREATE DATASOURCE states_pg DESCRIBE BY 'Osun and Oyo OCDS' OPTIONS (jdbcdriver 'org.postgresql.Driver', jdbcurl 'jdbc:postgresql://ct-pg:5432/states', username 'postgres', password 'spikepass', fetchsize '1000')" \
 "REGISTER DATASOURCE TABLES FROM states_pg" \
 "SHOW DATASOURCE TABLES bpp_pg" \
 "SHOW DATASOURCE TABLES states_pg" \
 "SELECT 'BPP' AS src, title, CAST(value_amount AS DOUBLE) AS amount FROM bpp_pg.bpp_awards WHERE lower(title) LIKE '%exercise book%' OR lower(title) LIKE '%note book%' OR lower(title) LIKE '%notebook%' UNION ALL SELECT 'OYO' AS src, tender_title, CAST(tender_value_amount AS DOUBLE) FROM states_pg.oyo_main WHERE lower(tender_title) LIKE '%exercise book%'" \
 "SELECT b.name AS supplier, count(DISTINCT b.main_ocid) AS bpp_awards, count(DISTINCT o.main_ocid) AS osun_awards FROM bpp_pg.bpp_awards_suppliers b JOIN states_pg.osun_awards_suppliers o ON upper(trim(b.name)) = upper(trim(o.name)) GROUP BY b.name ORDER BY bpp_awards DESC" \
 2>&1 | tee data/phase2_output.txt
echo; echo "== done. Tell Claude 'phase 2 done' (output saved to spike/data/phase2_output.txt)"
