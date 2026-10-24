#!/bin/bash
# Spike phase 1: download OCDS data (BPP federal, Osun, Oyo) and list contents. Throwaway.
set -e
cd "$(dirname "$0")"; mkdir -p data; cd data
B=https://data.open-contracting.org/en/publication
dl() { echo "-> $1/$2"; curl -sSL --fail -o "$1-$2" "$B/$1/download?name=$2"; ls -lh "$1-$2"; }
dl 64  full.csv.tar.gz      # BPP federal (May 2021 - Oct 2026)
dl 118 full.csv.tar.gz      # Osun (2019 - Jul 2026)
dl 106 full.csv.tar.gz      # Oyo (2019 - Jul 2022)
dl 106 full.jsonl.gz        # Oyo raw JSON (for notebook search)
for p in 64 118 106; do mkdir -p "csv_$p"; tar -xzf "$p-full.csv.tar.gz" -C "csv_$p"; done
echo; echo "== files"; find . -name "*.csv" | sort | while read f; do echo "$f  rows=$(($(wc -l <"$f")-1))"; done
echo; echo "== done. Tell Claude 'phase 1 done'."
