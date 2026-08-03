#!/usr/bin/env bash
# Ricostruisce i file .sql delle migration leggendo la tabella
# supabase_migrations.schema_migrations del progetto remoto.
#
# Usa la Management API di Supabase (solo PAT, nessuna password DB).
# Richiede SUPABASE_ACCESS_TOKEN in ambiente.
#
#   PROJECT_REF=kbcrtwqtzuipcsfiyupu bash scripts/dump-migrations.sh
#
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN (PAT Supabase)}"
PROJECT_REF="${PROJECT_REF:-kbcrtwqtzuipcsfiyupu}"
OUT="${OUT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/supabase/migrations}"

mkdir -p "$OUT"
echo "Leggo schema_migrations da $PROJECT_REF..."

curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"select version, name, statements from supabase_migrations.schema_migrations order by version;"}' \
| OUT_DIR="$OUT" python3 -c '
import json, os, sys, re

out = os.environ["OUT_DIR"]
data = json.load(sys.stdin)

if isinstance(data, dict) and data.get("error"):
    sys.exit("Errore API: %s" % data["error"])

written = 0
for row in data:
    version = row["version"]
    name = row["name"] or "unnamed"
    stmts = row["statements"] or []
    if isinstance(stmts, str):
        stmts = [stmts]

    # nome file safe: solo [a-z0-9_]
    safe = re.sub(r"[^A-Za-z0-9_]", "_", name)
    path = os.path.join(out, f"{version}_{safe}.sql")

    body = "\n\n".join(s.rstrip().rstrip(";") + ";" for s in stmts if s.strip())
    header = f"-- {version}_{safe}\n-- ricostruita da supabase_migrations.schema_migrations\n\n"
    with open(path, "w") as f:
        f.write(header + body + "\n")
    written += 1

print(f"  {written} file scritti in {out}")
'

echo "Fatto: $(ls -1 "$OUT"/*.sql 2>/dev/null | wc -l | tr -d ' ') file totali"
