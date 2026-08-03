-- 20260802181300_admin_event_rpcs_accept_promo_group
-- ricostruita da supabase_migrations.schema_migrations

-- Estende admin_create_event con p_promo_group in coda (retrocompat: DEFAULT NULL)
CREATE OR REPLACE FUNCTION public.admin_create_event(
  p_admin_id uuid,
  p_title text,
  p_description text DEFAULT NULL,
  p_event_date timestamp with time zone DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_max_participants integer DEFAULT NULL,
  p_price numeric DEFAULT 0,
  p_sumup_link text DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_public_registration boolean DEFAULT false,
  p_promo_group text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE v_id uuid; v_slug text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=p_admin_id AND active=true AND role='admin') THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;

  v_slug := COALESCE(
    NULLIF(lower(trim(p_slug)), ''),
    lower(regexp_replace(regexp_replace(p_title, '[^a-zA-Z0-9 ]', '', 'g'), '\s+', '-', 'g'))
  );
  IF v_slug IS NULL OR v_slug='' OR v_slug='-' THEN v_slug := 'evento'; END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE slug=v_slug) THEN
    v_slug := v_slug || '-' || floor(random()*9000+1000)::text;
  END IF;

  -- Verifica promo_group esiste in config (o è NULL)
  IF p_promo_group IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.promo_bonus_config WHERE promo_group = p_promo_group
  ) THEN
    RETURN jsonb_build_object('ok',false,'error','Gruppo promo non riconosciuto: '||p_promo_group);
  END IF;

  INSERT INTO public.events
    (title, description, event_date, location, max_participants,
     price, slug, public_registration, sumup_link, active, visible, promo_group)
  VALUES
    (p_title, p_description, p_event_date, p_location, p_max_participants,
     p_price, v_slug, p_public_registration, p_sumup_link, true, true, p_promo_group)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true, 'id', v_id, 'title', p_title, 'slug', v_slug,
    'promo_group', p_promo_group,
    'public_link', CASE WHEN p_public_registration
                     THEN 'https://maci81x.github.io/shanghai-card/?event='||v_slug
                     ELSE NULL END
  );
END; $$;


-- Estende admin_update_event con p_promo_group + p_clear_promo_group
-- Semantica:
--   p_clear_promo_group=true  → set NULL (rimuove associazione)
--   p_promo_group NOT NULL    → set a quel valore
--   entrambi NULL/false       → mantieni valore attuale
CREATE OR REPLACE FUNCTION public.admin_update_event(
  p_admin_id uuid,
  p_event_id uuid,
  p_title text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_event_date timestamp with time zone DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_max_participants integer DEFAULT NULL,
  p_price numeric DEFAULT NULL,
  p_sumup_link text DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_public_registration boolean DEFAULT NULL,
  p_visible boolean DEFAULT NULL,
  p_image_url text DEFAULT NULL,
  p_promo_group text DEFAULT NULL,
  p_clear_promo_group boolean DEFAULT false
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE e_updated public.events;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=p_admin_id AND role='admin') THEN
    RETURN json_build_object('error','not_admin');
  END IF;

  IF p_promo_group IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.promo_bonus_config WHERE promo_group = p_promo_group
  ) THEN
    RETURN json_build_object('error','unknown_promo_group','promo_group',p_promo_group);
  END IF;

  UPDATE public.events SET
    title               = COALESCE(p_title, title),
    description         = COALESCE(p_description, description),
    event_date          = COALESCE(p_event_date, event_date),
    location            = COALESCE(p_location, location),
    max_participants    = COALESCE(p_max_participants, max_participants),
    price               = COALESCE(p_price, price),
    sumup_link          = COALESCE(p_sumup_link, sumup_link),
    slug                = COALESCE(p_slug, slug),
    public_registration = COALESCE(p_public_registration, public_registration),
    visible             = COALESCE(p_visible, visible),
    image_url           = COALESCE(p_image_url, image_url),
    promo_group         = CASE
                            WHEN p_clear_promo_group THEN NULL
                            WHEN p_promo_group IS NOT NULL THEN p_promo_group
                            ELSE promo_group
                          END
  WHERE id=p_event_id
  RETURNING * INTO e_updated;

  IF NOT FOUND THEN RETURN json_build_object('error','not_found'); END IF;
  RETURN json_build_object('ok', true, 'id', e_updated.id, 'promo_group', e_updated.promo_group);
END; $$;
