-- 20260718181309_transactions_type_check_add_transfer
-- ricostruita da supabase_migrations.schema_migrations


alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type = any (array[
    'recharge'::text,
    'purchase'::text,
    'event_fee'::text,
    'refund'::text,
    'transfer_out'::text,
    'transfer_in'::text
  ]));
