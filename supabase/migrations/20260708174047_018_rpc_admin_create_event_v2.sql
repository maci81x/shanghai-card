-- 20260708174047_018_rpc_admin_create_event_v2
-- ricostruita da supabase_migrations.schema_migrations


DROP FUNCTION IF EXISTS public.admin_create_event(TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, NUMERIC);
DROP FUNCTION IF EXISTS public.admin_create_event(TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.admin_create_event(
  p_title TEXT, p_description TEXT DEFAULT NULL,
  p_event_date TIMESTAMPTZ DEFAULT NULL, p_location TEXT DEFAULT NULL,
  p_max_participants INTEGER DEFAULT NULL, p_price NUMERIC DEFAULT 0,
  p_public_registration BOOLEAN DEFAULT false, p_sumup_link TEXT DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_id UUID; v_slug TEXT;
BEGIN
  v_slug := lower(regexp_replace(regexp_replace(p_title, '[^a-zA-Z0-9 ]', '', 'g'), '\s+', '-', 'g'));
  IF EXISTS (SELECT 1 FROM public.events WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || floor(random()*1000)::text;
  END IF;

  INSERT INTO public.events (title, description, event_date, location, max_participants, price,
    slug, public_registration, sumup_link)
  VALUES (p_title, p_description, p_event_date, p_location, p_max_participants, p_price,
    v_slug, p_public_registration, p_sumup_link)
  RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'id', v_id, 'title', p_title, 'slug', v_slug,
    'public_link', CASE WHEN p_public_registration THEN
      'https://maci81x.github.io/shanghai-card/?event=' || v_slug ELSE NULL END);
END; $$;
