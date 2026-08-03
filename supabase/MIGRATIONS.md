# Migration Supabase — shanghai-card

Le migration in `supabase/migrations/` sono la fonte di verità dello schema
DB per shanghai-card. Ogni file è nominato `TIMESTAMP_nome.sql`.

## Applicare una nuova migration

Preferito: via MCP Supabase in Claude chat con `Supabase:apply_migration`,
poi `supabase db pull` per rigenerare il file locale, quindi commit.

Alternativo: scrivere il file `.sql` in locale e `supabase db push`.

## Convenzioni

- Nome file: verbo + oggetto (es. `add_promo_group_column`)
- Prima di `CREATE OR REPLACE FUNCTION` con signature diversa: sempre
  `DROP FUNCTION IF EXISTS ...` esplicito
- Il nome della migration deve essere unico globalmente nel progetto

## Progetti separati sullo stesso DB Supabase

Il progetto Supabase `kbcrtwqtzuipcsfiyupu` è condiviso tra:
- shanghai-card (questo repo)
- rione-vibes (repo separato: ~/Progetti/rione-vibes/)

Le migration `vibes_*`, `create_vibes_*`, `fix_vibes_*` e `secure_admin_auth`
NON vanno in questo repo.

## Ricostruire i file dal DB

I 98 file attuali non sono stati creati a mano: sono stati ricostruiti dalla
tabella `supabase_migrations.schema_migrations` del progetto remoto, perché
fino ad oggi le migration venivano applicate in produzione via MCP senza
copia nel repo.

Lo script che li rigenera è `scripts/dump-migrations.sh`:

```bash
export SUPABASE_ACCESS_TOKEN="<PAT>"
bash scripts/dump-migrations.sh
```

Usa la Management API di Supabase (solo PAT, nessuna password DB) e riscrive
tutti i file in `supabase/migrations/`. Attenzione: rigenera anche le 20
migration di rione-vibes, che vanno poi rispostate nell'altro repo.

## Nota sulla migration history

La tabella remota contiene 118 migration, di cui 20 appartengono a
rione-vibes. Il repo locale non è allineato alla history remota: `supabase
db pull` fallisce con `LegacyDbPullMigrationConflictError` perché i file
locali non coprono l'intera storia remota. È una condizione nota e accettata
— questo repo tratta le migration come snapshot documentale, non come
history sincronizzata.
