-- 20260709051254_027_checkin_presenze
-- ricostruita da supabase_migrations.schema_migrations


-- Colonne check-in su event_registrations e event_guests
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS checked_in BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

ALTER TABLE public.event_guests
  ADD COLUMN IF NOT EXISTS checked_in BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

-- RPC: check-in socio (event_registrations) — idempotente
CREATE OR REPLACE FUNCTION public.staff_checkin_event(
  p_operator_id uuid,
  p_registration_id uuid
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE
  v_op   public.users%ROWTYPE;
  v_reg  public.event_registrations%ROWTYPE;
  v_usr  public.users%ROWTYPE;
  v_ev   public.events%ROWTYPE;
BEGIN
  SELECT * INTO v_op FROM public.users WHERE id = p_operator_id AND active = true;
  IF NOT FOUND OR v_op.role NOT IN ('staff','admin') THEN
    RETURN json_build_object('ok',false,'error','Operatore non autorizzato');
  END IF;

  SELECT * INTO v_reg FROM public.event_registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok',false,'error','Iscrizione non trovata');
  END IF;

  IF v_reg.checked_in THEN
    RETURN json_build_object('ok',true,'already_in',true,'message','Già registrata la presenza');
  END IF;

  SELECT * INTO v_usr FROM public.users WHERE id = v_reg.user_id;
  SELECT * INTO v_ev  FROM public.events WHERE id = v_reg.event_id;

  UPDATE public.event_registrations
    SET checked_in=true, checked_in_at=now() WHERE id=p_registration_id;

  RETURN json_build_object(
    'ok',true,'already_in',false,
    'display_name', coalesce(v_usr.display_name,''),
    'event', v_ev.title,
    'message', 'Presenza registrata: '||coalesce(v_usr.display_name,'')||' — '||v_ev.title
  );
END; $$;

-- RPC: check-in ospite esterno (event_guests) — idempotente
CREATE OR REPLACE FUNCTION public.staff_checkin_guest(
  p_operator_id uuid,
  p_guest_id uuid
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
DECLARE
  v_op    public.users%ROWTYPE;
  v_guest public.event_guests%ROWTYPE;
  v_ev    public.events%ROWTYPE;
BEGIN
  SELECT * INTO v_op FROM public.users WHERE id = p_operator_id AND active = true;
  IF NOT FOUND OR v_op.role NOT IN ('staff','admin') THEN
    RETURN json_build_object('ok',false,'error','Operatore non autorizzato');
  END IF;

  SELECT * INTO v_guest FROM public.event_guests WHERE id = p_guest_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok',false,'error','Ospite non trovato');
  END IF;

  IF v_guest.checked_in THEN
    RETURN json_build_object('ok',true,'already_in',true,'message','Già registrata la presenza');
  END IF;

  SELECT * INTO v_ev FROM public.events WHERE id = v_guest.event_id;

  UPDATE public.event_guests
    SET checked_in=true, checked_in_at=now() WHERE id=p_guest_id;

  RETURN json_build_object(
    'ok',true,'already_in',false,
    'display_name', coalesce(v_guest.nome||' '||v_guest.cognome,''),
    'event', v_ev.title,
    'message', 'Presenza registrata: '||coalesce(v_guest.nome||' '||v_guest.cognome,'')||' — '||v_ev.title
  );
END; $$;
