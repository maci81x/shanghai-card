-- 20260708194245_022_event_register_unpaid
-- ricostruita da supabase_migrations.schema_migrations


-- ── Iscrizione socio: crea registro da_saldare (non paga subito) ─────
CREATE OR REPLACE FUNCTION public.user_register_event(
  p_user_id UUID, p_event_id UUID,
  p_nome TEXT DEFAULT NULL, p_cognome TEXT DEFAULT NULL, p_telefono TEXT DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_user   public.users%ROWTYPE;
  v_event  public.events%ROWTYPE;
  v_count  INTEGER;
  v_reg_id UUID;
  v_nome   TEXT; v_cognome TEXT;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Utente non trovato'); END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Evento non trovato'); END IF;

  -- Già iscritto?
  IF EXISTS (SELECT 1 FROM public.event_registrations
             WHERE user_id = p_user_id AND event_id = p_event_id
               AND payment_status != 'annullato') THEN
    RETURN json_build_object('ok', false, 'error', 'Sei già iscritto a questo evento');
  END IF;

  -- Verifica posti disponibili
  IF v_event.max_participants IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.event_registrations
      WHERE event_id = p_event_id AND payment_status != 'annullato';
    IF v_count >= v_event.max_participants THEN
      RETURN json_build_object('ok', false, 'error', 'Evento al completo');
    END IF;
  END IF;

  -- Usa nome/cognome del profilo se non passati
  v_nome    := coalesce(p_nome, v_user.nome, split_part(v_user.display_name, ' ', 1));
  v_cognome := coalesce(p_cognome, v_user.cognome,
                        CASE WHEN strpos(v_user.display_name, ' ') > 0
                             THEN substr(v_user.display_name, strpos(v_user.display_name, ' ')+1)
                             ELSE '' END);

  INSERT INTO public.event_registrations
    (user_id, event_id, status, payment_status, amount, nome, cognome, telefono)
  VALUES
    (p_user_id, p_event_id, 'registered', 'da_saldare', v_event.price,
     v_nome, v_cognome, coalesce(p_telefono, v_user.telefono))
  RETURNING id INTO v_reg_id;

  RETURN json_build_object(
    'ok', true,
    'registration_id', v_reg_id,
    'event', v_event.title,
    'amount', v_event.price,
    'payment_status', 'da_saldare',
    'message', 'Iscrizione confermata. Puoi saldare in app o in cassa.'
  );
END; $$;

-- ── Iscrizione ospiti esterni: nome/cognome/telefono OBBLIGATORI ─────
CREATE OR REPLACE FUNCTION public.register_event_guests(
  p_event_id UUID,
  p_guests JSONB
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_event    public.events%ROWTYPE;
  v_registered INTEGER;
  v_guest    JSONB;
  v_count    INTEGER := 0;
  v_nome TEXT; v_cognome TEXT; v_tel TEXT;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Evento non trovato'); END IF;

  SELECT count(*) INTO v_registered FROM (
    SELECT user_id FROM public.event_registrations
      WHERE event_id = p_event_id AND payment_status != 'annullato'
    UNION ALL
    SELECT id FROM public.event_guests WHERE event_id = p_event_id
  ) sub;

  IF v_event.max_participants IS NOT NULL AND
     (v_registered + jsonb_array_length(p_guests)) > v_event.max_participants THEN
    RETURN json_build_object('ok', false, 'error', 'Posti insufficienti',
      'spots_left', v_event.max_participants - v_registered,
      'requested', jsonb_array_length(p_guests));
  END IF;

  FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
    v_nome    := trim(v_guest->>'nome');
    v_cognome := trim(v_guest->>'cognome');
    v_tel     := trim(v_guest->>'telefono');

    IF v_nome IS NULL OR v_nome = '' THEN
      RETURN json_build_object('ok', false, 'error', 'Nome obbligatorio per ogni partecipante');
    END IF;
    IF v_cognome IS NULL OR v_cognome = '' THEN
      RETURN json_build_object('ok', false, 'error', 'Cognome obbligatorio per ogni partecipante');
    END IF;
    IF v_tel IS NULL OR v_tel = '' THEN
      RETURN json_build_object('ok', false, 'error', 'Telefono obbligatorio per ogni partecipante');
    END IF;

    INSERT INTO public.event_guests
      (event_id, nome, cognome, email, telefono, payment_status, amount)
    VALUES
      (p_event_id, v_nome, v_cognome,
       nullif(trim(v_guest->>'email'),''), v_tel,
       'da_saldare', v_event.price);
    v_count := v_count + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'registered', v_count,
    'message', v_count || ' persone registrate per ' || v_event.title);
END; $$;
