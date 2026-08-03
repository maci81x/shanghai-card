-- 20260802154312_promo_bonus_list_groups_rpc
-- ricostruita da supabase_migrations.schema_migrations

DROP FUNCTION IF EXISTS list_promo_groups();
CREATE OR REPLACE FUNCTION list_promo_groups()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.promo_group), '[]'::jsonb) INTO v_result
  FROM (
    SELECT promo_group,
           MAX(label) as label,
           jsonb_agg(jsonb_build_object('position',position,'bonus_pct',bonus_pct) ORDER BY position) as thresholds
    FROM promo_bonus_config
    GROUP BY promo_group
  ) t;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION list_promo_groups() TO anon, authenticated;
