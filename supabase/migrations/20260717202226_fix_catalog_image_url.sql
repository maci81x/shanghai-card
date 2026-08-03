-- 20260717202226_fix_catalog_image_url
-- ricostruita da supabase_migrations.schema_migrations


create or replace function public.get_catalog()
returns json language plpgsql security definer set search_path = public, extensions
as $$
BEGIN
  RETURN json_build_object(
    'events', (
      SELECT coalesce(json_agg(row_to_json(e)),'[]'::json)
      FROM (
        SELECT id, title, description, event_date, location,
               max_participants, price, active, sumup_link, slug, image_url
        FROM public.events WHERE active=true AND visible=true ORDER BY event_date
      ) e
    ),
    'gadgets', (
      SELECT coalesce(json_agg(row_to_json(g)),'[]'::json)
      FROM (
        SELECT id, name, description, price, stock, image_url, active
        FROM public.gadgets WHERE active=true AND stock>0 ORDER BY name
      ) g
    ),
    'promos', (
      SELECT coalesce(json_agg(row_to_json(p)),'[]'::json)
      FROM (
        SELECT id, code, description, discount_type, discount_value, 
               valid_from, valid_until, image_url
        FROM public.promos WHERE active=true AND (valid_until IS NULL OR valid_until>now()) ORDER BY valid_from
      ) p
    ),
    'sumup_links', (
      SELECT coalesce(json_agg(row_to_json(s)),'[]'::json)
      FROM (
        SELECT id, label, amount, url, sort_order
        FROM public.sumup_links WHERE active=true ORDER BY sort_order, amount NULLS LAST
      ) s
    )
  );
END;
$$;
