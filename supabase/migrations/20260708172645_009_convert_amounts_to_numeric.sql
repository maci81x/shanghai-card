-- 20260708172645_009_convert_amounts_to_numeric
-- ricostruita da supabase_migrations.schema_migrations


-- Convert all amount columns from INTEGER (centesimi) to NUMERIC(10,2) EUR

ALTER TABLE public.users
  ALTER COLUMN balance TYPE NUMERIC(10,2) USING balance/100.0;

ALTER TABLE public.transactions
  ALTER COLUMN amount TYPE NUMERIC(10,2) USING amount/100.0,
  ALTER COLUMN balance_after TYPE NUMERIC(10,2) USING balance_after/100.0;

ALTER TABLE public.events
  ALTER COLUMN price TYPE NUMERIC(10,2) USING price/100.0;

ALTER TABLE public.gadgets
  ALTER COLUMN price TYPE NUMERIC(10,2) USING price/100.0;

ALTER TABLE public.promos
  ALTER COLUMN discount_value TYPE NUMERIC(10,2)
    USING CASE WHEN discount_type='fixed' THEN discount_value/100.0 ELSE discount_value::NUMERIC END;

ALTER TABLE public.sumup_links
  ALTER COLUMN amount TYPE NUMERIC(10,2) USING amount/100.0;
