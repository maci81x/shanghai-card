-- 20260709125412_043_sumup_links_mgmt
-- ricostruita da supabase_migrations.schema_migrations


SET search_path = public, extensions;

-- Add sort_order column
ALTER TABLE public.sumup_links ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
-- Make amount nullable for custom links
ALTER TABLE public.sumup_links ALTER COLUMN amount DROP NOT NULL;

-- Drop existing versions if any
DROP FUNCTION IF EXISTS public.admin_add_sumup_link(uuid, text, text, numeric);
DROP FUNCTION IF EXISTS public.admin_update_sumup_link(uuid, uuid, text, text, numeric);
DROP FUNCTION IF EXISTS public.admin_delete_sumup_link(uuid, uuid);

-- admin_add_sumup_link
CREATE OR REPLACE FUNCTION public.admin_add_sumup_link(
  p_admin_id uuid,
  p_label    text,
  p_url      text,
  p_amount   numeric DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_admin public.users%ROWTYPE; v_sort INT;
BEGIN
  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id AND active = true;
  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN json_build_object('ok', false, 'error', 'Accesso negato');
  END IF;
  SELECT coalesce(max(sort_order), 0) + 10 INTO v_sort FROM public.sumup_links;
  INSERT INTO public.sumup_links (label, url, amount, sort_order, active)
  VALUES (trim(p_label), trim(p_url), p_amount, v_sort, true);
  RETURN json_build_object('ok', true, 'message', 'Link aggiunto');
END;
$$;

-- admin_update_sumup_link
CREATE OR REPLACE FUNCTION public.admin_update_sumup_link(
  p_admin_id uuid,
  p_link_id  uuid,
  p_label    text,
  p_url      text,
  p_amount   numeric DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_admin public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id AND active = true;
  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN json_build_object('ok', false, 'error', 'Accesso negato');
  END IF;
  UPDATE public.sumup_links SET label = trim(p_label), url = trim(p_url), amount = p_amount
  WHERE id = p_link_id;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Link non trovato'); END IF;
  RETURN json_build_object('ok', true, 'message', 'Link aggiornato');
END;
$$;

-- admin_delete_sumup_link
CREATE OR REPLACE FUNCTION public.admin_delete_sumup_link(
  p_admin_id uuid,
  p_link_id  uuid
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_admin public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id AND active = true;
  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN json_build_object('ok', false, 'error', 'Accesso negato');
  END IF;
  DELETE FROM public.sumup_links WHERE id = p_link_id;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Link non trovato'); END IF;
  RETURN json_build_object('ok', true, 'message', 'Link eliminato');
END;
$$;

-- Update get_catalog to order by sort_order
DROP FUNCTION IF EXISTS public.get_catalog();
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  RETURN json_build_object(
    'events', (
      SELECT coalesce(json_agg(row_to_json(e)),'[]'::json)
      FROM (
        SELECT id, title, description, event_date, location,
               max_participants, price, active, sumup_link, slug
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
        SELECT id, code, description, discount_type, discount_value, valid_from, valid_until
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
