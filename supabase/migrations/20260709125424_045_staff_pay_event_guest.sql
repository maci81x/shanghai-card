-- 20260709125424_045_staff_pay_event_guest
-- ricostruita da supabase_migrations.schema_migrations


SET search_path = public, extensions;

DROP FUNCTION IF EXISTS public.staff_pay_event_guest(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.staff_pay_event_guest(
  p_operator_id uuid,
  p_guest_id    uuid,
  p_method      text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_operator public.users%ROWTYPE;
  v_guest    public.event_guests%ROWTYPE;
  v_event    public.events%ROWTYPE;
  v_status   TEXT;
BEGIN
  SELECT * INTO v_operator FROM public.users WHERE id = p_operator_id AND active = true;
  IF NOT FOUND OR v_operator.role NOT IN ('staff','admin') THEN
    RETURN json_build_object('ok', false, 'error', 'Operatore non autorizzato');
  END IF;

  SELECT * INTO v_guest FROM public.event_guests WHERE id = p_guest_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Ospite non trovato');
  END IF;
  IF v_guest.payment_status != 'da_saldare' THEN
    RETURN json_build_object('ok', false, 'error', 'Già saldato (' || v_guest.payment_status || ')');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_guest.event_id;

  IF p_method = 'sumup' THEN
    v_status := 'saldato_sumup';
  ELSIF p_method = 'contanti' THEN
    v_status := 'saldato_contanti';
  ELSE
    RETURN json_build_object('ok', false, 'error', 'Metodo non valido: sumup | contanti');
  END IF;

  UPDATE public.event_guests
    SET payment_status = v_status, paid_at = now(), paid_by = p_operator_id, paid = true
  WHERE id = p_guest_id;

  RETURN json_build_object(
    'ok', true,
    'nome', v_guest.nome,
    'cognome', v_guest.cognome,
    'event', v_event.title,
    'method', p_method,
    'amount', v_guest.amount,
    'message', 'Pagamento ospite: ' || v_guest.nome || ' ' || v_guest.cognome || ' (' || p_method || ')'
  );
END;
$$;
