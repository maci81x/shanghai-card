-- 20260708215025_026_fix_user_register_event_flow
-- ricostruita da supabase_migrations.schema_migrations


-- user_register_event: registrazione senza addebito immediato
-- Il pagamento avviene in un secondo step (credito / SumUp / cassa)
CREATE OR REPLACE FUNCTION public.user_register_event(p_user_id uuid, p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_user    public.users%ROWTYPE;
  v_event   public.events%ROWTYPE;
  v_reg_id  UUID;
  v_count   INTEGER;
  v_pstatus TEXT;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id AND active = true;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Utente non trovato');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id AND active = true;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Evento non trovato');
  END IF;

  -- Già iscritto (ignora cancellati: possono re-iscriversi)
  IF EXISTS (
    SELECT 1 FROM public.event_registrations
    WHERE user_id = p_user_id
      AND event_id = p_event_id
      AND payment_status != 'annullato'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'Già iscritto a questo evento');
  END IF;

  -- Posti esauriti
  IF v_event.max_participants IS NOT NULL THEN
    SELECT count(*) INTO v_count
    FROM public.event_registrations
    WHERE event_id = p_event_id AND payment_status != 'annullato';
    IF v_count >= v_event.max_participants THEN
      RETURN json_build_object('ok', false, 'error', 'Evento al completo');
    END IF;
  END IF;

  -- Status pagamento: gratuito (prezzo 0) o da_saldare (prezzo > 0)
  v_pstatus := CASE WHEN coalesce(v_event.price, 0) = 0 THEN 'gratuito' ELSE 'da_saldare' END;

  -- Crea registrazione — nessuna detrazione saldo qui
  INSERT INTO public.event_registrations
    (user_id, event_id, status, payment_status, amount, nome, cognome, telefono)
  VALUES
    (p_user_id, p_event_id, 'confirmed', v_pstatus,
     coalesce(v_event.price, 0),
     v_user.nome, v_user.cognome, v_user.telefono)
  RETURNING id INTO v_reg_id;

  RETURN json_build_object(
    'ok',              true,
    'registration_id', v_reg_id,
    'event',           v_event.title,
    'amount',          coalesce(v_event.price, 0),
    'payment_status',  v_pstatus
  );
END;
$$;
