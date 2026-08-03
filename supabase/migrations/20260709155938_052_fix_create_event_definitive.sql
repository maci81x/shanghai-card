-- 20260709155938_052_fix_create_event_definitive
-- ricostruita da supabase_migrations.schema_migrations


-- ═══════════════════════════════════════════════════════
-- Migration 052: admin_create_event definitiva con p_admin_id
-- ═══════════════════════════════════════════════════════
SET search_path = public, extensions;

-- Drop tutte le versioni esistenti
DROP FUNCTION IF EXISTS admin_create_event(text, text, timestamptz, text, integer, numeric, boolean, text, text);
DROP FUNCTION IF EXISTS admin_create_event(uuid, text, text, timestamptz, text, integer, numeric, text, text, boolean);
DROP FUNCTION IF EXISTS admin_create_event(uuid, text, text, timestamptz, text, integer, numeric, boolean, text, text);

CREATE OR REPLACE FUNCTION admin_create_event(
  p_admin_id           uuid,
  p_title              text,
  p_description        text        DEFAULT NULL,
  p_event_date         timestamptz DEFAULT NULL,
  p_location           text        DEFAULT NULL,
  p_max_participants   integer     DEFAULT NULL,
  p_price              numeric     DEFAULT 0,
  p_sumup_link         text        DEFAULT NULL,
  p_slug               text        DEFAULT NULL,
  p_public_registration boolean    DEFAULT false
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id   uuid;
  v_slug text;
BEGIN
  -- Verifica admin
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_admin_id AND active = true AND role = 'admin'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'Non autorizzato');
  END IF;

  -- Genera slug
  v_slug := COALESCE(
    NULLIF(lower(trim(p_slug)), ''),
    lower(
      regexp_replace(
        regexp_replace(
          unaccent(p_title),
          '[^a-zA-Z0-9 ]', '', 'g'
        ),
        '\s+', '-', 'g'
      )
    )
  );
  IF v_slug = '' OR v_slug IS NULL THEN v_slug := 'evento'; END IF;
  -- Dedup slug se già esiste
  IF EXISTS (SELECT 1 FROM public.events WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || floor(random() * 9000 + 1000)::text;
  END IF;

  INSERT INTO public.events
    (title, description, event_date, location, max_participants,
     price, slug, public_registration, sumup_link, active, visible)
  VALUES
    (p_title, p_description, p_event_date, p_location, p_max_participants,
     p_price, v_slug, p_public_registration, p_sumup_link, true, true)
  RETURNING id INTO v_id;

  RETURN json_build_object(
    'ok',           true,
    'id',           v_id,
    'title',        p_title,
    'slug',         v_slug,
    'public_link',  CASE WHEN p_public_registration
                      THEN 'https://maci81x.github.io/shanghai-card/?event=' || v_slug
                      ELSE NULL END
  );
END;
$$;
