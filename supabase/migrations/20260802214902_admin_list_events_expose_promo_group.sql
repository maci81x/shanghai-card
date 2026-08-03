-- 20260802214902_admin_list_events_expose_promo_group
-- ricostruita da supabase_migrations.schema_migrations

CREATE OR REPLACE FUNCTION public.admin_list_events()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE result json;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json) INTO result FROM (
    SELECT e.id, e.title, e.description, e.event_date, e.location,
           e.max_participants, e.price, e.active, e.visible, e.slug,
           e.sumup_link, e.public_registration, e.image_url, e.created_at,
           e.promo_group,
           (SELECT count(*) FROM public.event_registrations r
            WHERE r.event_id = e.id AND r.status = 'confirmed') AS registered_count
    FROM public.events e
    ORDER BY e.event_date DESC
  ) x;
  RETURN result;
END; $$;
