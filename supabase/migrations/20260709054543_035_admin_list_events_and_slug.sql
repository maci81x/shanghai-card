-- 20260709054543_035_admin_list_events_and_slug
-- ricostruita da supabase_migrations.schema_migrations


-- admin_list_events: tutti gli eventi per admin (include hidden e inattivi)
CREATE OR REPLACE FUNCTION public.admin_list_events()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN (
    SELECT coalesce(json_agg(row_to_json(e)),'[]'::json)
    FROM (
      SELECT id, title, description, event_date, location,
             max_participants, price, active, visible, slug,
             public_registration, sumup_link, created_at
      FROM public.events
      ORDER BY event_date DESC NULLS LAST
    ) e
  );
END; $$;

-- admin_create_event: aggiunge p_slug opzionale
CREATE OR REPLACE FUNCTION public.admin_create_event(
  p_title             text,
  p_description       text    DEFAULT NULL,
  p_event_date        timestamptz DEFAULT NULL,
  p_location          text    DEFAULT NULL,
  p_max_participants  integer DEFAULT NULL,
  p_price             numeric DEFAULT 0,
  p_public_registration boolean DEFAULT false,
  p_sumup_link        text    DEFAULT NULL,
  p_slug              text    DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE v_id UUID; v_slug TEXT;
BEGIN
  v_slug := coalesce(
    nullif(lower(trim(p_slug)),''),
    lower(regexp_replace(regexp_replace(p_title,'[^a-zA-Z0-9 ]','','g'),'\s+','-','g'))
  );
  IF v_slug = '' OR v_slug IS NULL THEN v_slug := 'evento'; END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE slug=v_slug) THEN
    v_slug := v_slug || '-' || floor(random()*9000+1000)::text;
  END IF;

  INSERT INTO public.events
    (title, description, event_date, location, max_participants,
     price, slug, public_registration, sumup_link, active, visible)
  VALUES
    (p_title, p_description, p_event_date, p_location, p_max_participants,
     p_price, v_slug, p_public_registration, p_sumup_link, true, true)
  RETURNING id INTO v_id;

  RETURN json_build_object(
    'ok',true, 'id',v_id, 'title',p_title, 'slug',v_slug,
    'public_link', CASE WHEN p_public_registration
      THEN 'https://maci81x.github.io/shanghai-card/?event='||v_slug ELSE NULL END
  );
END; $$;
