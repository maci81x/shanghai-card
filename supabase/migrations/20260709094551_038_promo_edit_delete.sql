-- 20260709094551_038_promo_edit_delete
-- ricostruita da supabase_migrations.schema_migrations


CREATE OR REPLACE FUNCTION public.admin_update_promo(
  p_admin_id    uuid,
  p_promo_id    uuid,
  p_code        text,
  p_description text DEFAULT NULL,
  p_type        text DEFAULT 'percent',
  p_value       numeric DEFAULT 10,
  p_valid_until date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_admin_id AND active = true;
  IF NOT FOUND OR v_user.role NOT IN ('admin','staff') THEN
    RETURN json_build_object('ok',false,'error','Accesso negato');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.promos WHERE id = p_promo_id) THEN
    RETURN json_build_object('ok',false,'error','Promo non trovata');
  END IF;
  UPDATE public.promos SET
    code           = upper(trim(p_code)),
    description    = p_description,
    discount_type  = p_type,
    discount_value = p_value,
    valid_until    = p_valid_until
  WHERE id = p_promo_id;
  RETURN json_build_object('ok',true,'message','Promo aggiornata');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_promo(
  p_admin_id uuid,
  p_promo_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_admin_id AND active = true;
  IF NOT FOUND OR v_user.role NOT IN ('admin','staff') THEN
    RETURN json_build_object('ok',false,'error','Accesso negato');
  END IF;
  DELETE FROM public.promos WHERE id = p_promo_id;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'error','Promo non trovata'); END IF;
  RETURN json_build_object('ok',true,'message','Promo eliminata');
END;
$$;
