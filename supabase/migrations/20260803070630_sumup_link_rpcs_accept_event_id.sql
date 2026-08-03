-- 20260803070630_sumup_link_rpcs_accept_event_id
-- ricostruita da supabase_migrations.schema_migrations

-- Add p_event_id in coda (retrocompat: DEFAULT NULL)
CREATE OR REPLACE FUNCTION public.admin_add_sumup_link(
  p_admin_id uuid, 
  p_label text, 
  p_url text, 
  p_amount numeric DEFAULT NULL,
  p_event_id uuid DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE v_admin public.users%ROWTYPE; v_sort INT;
BEGIN
  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id AND active = true;
  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN json_build_object('ok', false, 'error', 'Accesso negato');
  END IF;

  -- Verifica evento esistente se p_event_id non NULL
  IF p_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RETURN json_build_object('ok', false, 'error', 'Evento non trovato');
  END IF;

  SELECT coalesce(max(sort_order), 0) + 10 INTO v_sort FROM public.sumup_links
    WHERE event_id IS NOT DISTINCT FROM p_event_id;

  INSERT INTO public.sumup_links (label, url, amount, sort_order, active, event_id)
  VALUES (trim(p_label), trim(p_url), p_amount, v_sort, true, p_event_id);

  RETURN json_build_object('ok', true, 'message', 'Link aggiunto', 'event_id', p_event_id);
END; $$;


-- Update: aggiunge p_event_id + p_clear_event_id (semantica come promo_group)
CREATE OR REPLACE FUNCTION public.admin_update_sumup_link(
  p_admin_id uuid, 
  p_link_id uuid, 
  p_label text, 
  p_url text, 
  p_amount numeric DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_clear_event_id boolean DEFAULT false
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions' AS $$
DECLARE v_admin public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_admin FROM public.users WHERE id = p_admin_id AND active = true;
  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN json_build_object('ok', false, 'error', 'Accesso negato');
  END IF;

  IF p_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RETURN json_build_object('ok', false, 'error', 'Evento non trovato');
  END IF;

  UPDATE public.sumup_links SET 
    label = trim(p_label), 
    url = trim(p_url), 
    amount = p_amount,
    event_id = CASE
                 WHEN p_clear_event_id THEN NULL
                 WHEN p_event_id IS NOT NULL THEN p_event_id
                 ELSE event_id
               END
  WHERE id = p_link_id;

  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Link non trovato'); END IF;
  RETURN json_build_object('ok', true, 'message', 'Link aggiornato');
END; $$;
