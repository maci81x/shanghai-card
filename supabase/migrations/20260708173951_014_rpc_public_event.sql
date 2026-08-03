-- 20260708173951_014_rpc_public_event
-- ricostruita da supabase_migrations.schema_migrations


CREATE OR REPLACE FUNCTION public.get_public_event(p_slug TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_registered INTEGER;
BEGIN
  SELECT * INTO v_event FROM public.events
    WHERE slug = lower(trim(p_slug)) AND active = true AND public_registration = true;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Evento non trovato');
  END IF;

  SELECT count(*) INTO v_registered FROM (
    SELECT user_id FROM public.event_registrations WHERE event_id = v_event.id AND status = 'confirmed'
    UNION ALL
    SELECT id FROM public.event_guests WHERE event_id = v_event.id
  ) sub;

  RETURN json_build_object('ok', true,
    'event', json_build_object(
      'id', v_event.id, 'title', v_event.title, 'description', v_event.description,
      'event_date', v_event.event_date, 'location', v_event.location,
      'price', v_event.price, 'max_participants', v_event.max_participants,
      'spots_left', CASE WHEN v_event.max_participants IS NOT NULL
                         THEN v_event.max_participants - v_registered ELSE NULL END,
      'sumup_link', v_event.sumup_link
    ));
END; $$;

CREATE OR REPLACE FUNCTION public.register_event_guests(
  p_event_id UUID,
  p_guests JSONB
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_registered INTEGER;
  v_guest JSONB;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Evento non trovato'); END IF;

  SELECT count(*) INTO v_registered FROM (
    SELECT user_id FROM public.event_registrations WHERE event_id = p_event_id AND status = 'confirmed'
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
    INSERT INTO public.event_guests (event_id, nome, cognome, email, telefono)
    VALUES (p_event_id, v_guest->>'nome', v_guest->>'cognome',
            v_guest->>'email', v_guest->>'telefono');
    v_count := v_count + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'registered', v_count,
    'message', v_count || ' persone registrate per ' || v_event.title);
END; $$;
