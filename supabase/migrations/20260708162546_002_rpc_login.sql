-- 20260708162546_002_rpc_login
-- ricostruita da supabase_migrations.schema_migrations


CREATE OR REPLACE FUNCTION public.login_user(p_card_id TEXT, p_pin TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE card_id = upper(trim(p_card_id)) AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Tessera non trovata'); END IF;
  IF v_user.pin_hash != public.crypt(p_pin, v_user.pin_hash) THEN RETURN json_build_object('ok', false, 'error', 'PIN errato'); END IF;
  IF v_user.role != 'user' THEN RETURN json_build_object('ok', false, 'error', 'Accesso non autorizzato per questo ruolo'); END IF;
  RETURN json_build_object('ok', true, 'user', json_build_object('id', v_user.id, 'card_id', v_user.card_id, 'display_name', v_user.display_name, 'role', v_user.role, 'balance', v_user.balance));
END; $$;

CREATE OR REPLACE FUNCTION public.login_staff(p_card_id TEXT, p_pin TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE card_id = upper(trim(p_card_id)) AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Badge non trovato'); END IF;
  IF v_user.pin_hash != public.crypt(p_pin, v_user.pin_hash) THEN RETURN json_build_object('ok', false, 'error', 'PIN errato'); END IF;
  IF v_user.role NOT IN ('staff', 'admin') THEN RETURN json_build_object('ok', false, 'error', 'Accesso riservato allo staff'); END IF;
  RETURN json_build_object('ok', true, 'user', json_build_object('id', v_user.id, 'card_id', v_user.card_id, 'display_name', v_user.display_name, 'role', v_user.role));
END; $$;

CREATE OR REPLACE FUNCTION public.login_admin(p_card_id TEXT, p_pin TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE card_id = upper(trim(p_card_id)) AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Badge non trovato'); END IF;
  IF v_user.pin_hash != public.crypt(p_pin, v_user.pin_hash) THEN RETURN json_build_object('ok', false, 'error', 'PIN errato'); END IF;
  IF v_user.role != 'admin' THEN RETURN json_build_object('ok', false, 'error', 'Accesso riservato agli admin'); END IF;
  RETURN json_build_object('ok', true, 'user', json_build_object('id', v_user.id, 'card_id', v_user.card_id, 'display_name', v_user.display_name, 'role', v_user.role));
END; $$;
