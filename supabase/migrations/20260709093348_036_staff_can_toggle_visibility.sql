-- 20260709093348_036_staff_can_toggle_visibility
-- ricostruita da supabase_migrations.schema_migrations


DROP FUNCTION IF EXISTS public.admin_toggle_event_visibility(uuid, uuid);

CREATE OR REPLACE FUNCTION public.admin_toggle_event_visibility(p_admin_id uuid, p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user  public.users%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_new   BOOLEAN;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_admin_id AND active = true;
  IF NOT FOUND OR v_user.role NOT IN ('admin','staff') THEN
    RETURN json_build_object('ok',false,'error','Accesso negato');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'error','Evento non trovato'); END IF;

  v_new := NOT coalesce(v_event.visible, TRUE);
  UPDATE public.events SET visible = v_new WHERE id = p_event_id;

  RETURN json_build_object(
    'ok', true, 'event_id', p_event_id, 'visible', v_new,
    'message', CASE WHEN v_new THEN 'Evento ora visibile nel catalogo'
                               ELSE 'Evento nascosto dal catalogo' END
  );
END;
$$;
