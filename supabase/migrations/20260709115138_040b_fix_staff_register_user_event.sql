-- 20260709115138_040b_fix_staff_register_user_event
-- ricostruita da supabase_migrations.schema_migrations


SET search_path = public, extensions;

DROP FUNCTION IF EXISTS public.staff_register_user_event(uuid, text, uuid);
CREATE OR REPLACE FUNCTION public.staff_register_user_event(
  p_operator_id uuid,
  p_card_id     text,
  p_event_id    uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_user     RECORD;
  v_event    RECORD;
  v_existing RECORD;
  v_reg_id   uuid;
BEGIN
  SELECT * INTO v_user FROM users WHERE card_id = p_card_id AND active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Tessera non trovata'); END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id AND active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Evento non trovato'); END IF;

  -- Se già iscritto, ritorna l'iscrizione esistente senza duplicare
  SELECT * INTO v_existing FROM event_registrations
  WHERE user_id = v_user.id AND event_id = p_event_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_registered', true,
      'registration_id', v_existing.id,
      'card_id', p_card_id,
      'display_name', v_user.display_name,
      'event_title', v_event.title,
      'payment_status', v_existing.payment_status,
      'amount', v_existing.amount
    );
  END IF;

  INSERT INTO event_registrations (user_id, event_id, payment_status, amount, operator_id)
  VALUES (v_user.id, p_event_id, 'da_saldare', v_event.price, p_operator_id)
  RETURNING id INTO v_reg_id;

  RETURN jsonb_build_object(
    'ok', true,
    'already_registered', false,
    'registration_id', v_reg_id,
    'card_id', p_card_id,
    'display_name', v_user.display_name,
    'event_title', v_event.title,
    'payment_status', 'da_saldare',
    'amount', v_event.price
  );
END;
$$;
