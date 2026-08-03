-- 20260803163817_admin_cancel_registration_rpc
-- ricostruita da supabase_migrations.schema_migrations

-- RPC admin per annullare l'iscrizione di un socio a un evento.
-- Rimborsa credito/contanti/sumup se già saldato, tramite _process_event_unit_refund.
-- Cancella tutti i companion attivi rimborsandoli.
-- Marca la registration come 'cancelled' → trigger promo fa rollback bonus se applicato.
-- Diversamente da user_cancel_event_registration:
--   - permessa anche per eventi già iniziati (correzione errori)
--   - richiede ruolo admin
--   - accetta motivazione opzionale per audit

CREATE OR REPLACE FUNCTION public.admin_cancel_registration(
  p_admin_id uuid,
  p_registration_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb 
LANGUAGE plpgsql SECURITY DEFINER 
SET search_path='public','extensions' AS $$
DECLARE 
  v_reg record; 
  v_comp record; 
  v_refunds jsonb := '[]'::jsonb;
  v_self_refund jsonb; 
  v_comp_refund jsonb; 
  v_event_title text;
  v_reason_suffix text;
BEGIN
  -- Verifica admin
  IF NOT EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = p_admin_id AND role = 'admin' AND active = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Accesso negato');
  END IF;

  -- Carica registrazione (con dati evento)
  SELECT er.*, e.event_date, e.title, e.price INTO v_reg 
  FROM event_registrations er 
  JOIN events e ON e.id = er.event_id
  WHERE er.id = p_registration_id 
  AND er.status = 'confirmed';
  
  IF NOT FOUND THEN 
    RETURN jsonb_build_object('ok', false, 'error', 'Iscrizione non trovata o già annullata'); 
  END IF;

  v_event_title := v_reg.title;
  v_reason_suffix := CASE 
    WHEN p_reason IS NOT NULL AND length(trim(p_reason)) > 0 
    THEN ' (motivo: ' || trim(p_reason) || ')' 
    ELSE '' 
  END;

  -- Rimborsa self se incluso
  IF v_reg.self_included THEN
    v_self_refund := _process_event_unit_refund(
      v_reg.user_id, 
      v_reg.payment_status, 
      v_reg.amount, 
      'event_registration', 
      p_registration_id,
      'Annullo admin: ' || v_event_title || v_reason_suffix
    );
    v_refunds := v_refunds || jsonb_build_array(
      jsonb_build_object('who', 'self', 'refund', v_self_refund)
    );
  END IF;

  -- Rimborsa ogni companion attivo
  FOR v_comp IN 
    SELECT * FROM event_companions 
    WHERE registration_id = p_registration_id AND status = 'attivo' 
  LOOP
    v_comp_refund := _process_event_unit_refund(
      COALESCE(v_comp.paid_by, v_reg.user_id), 
      v_comp.payment_status, 
      v_reg.price,
      'event_companion', 
      v_comp.id,
      'Annullo admin: ' || v_event_title || ' — ' || v_comp.nome || ' ' || v_comp.cognome || v_reason_suffix
    );
    v_refunds := v_refunds || jsonb_build_array(
      jsonb_build_object(
        'who', 'companion', 
        'name', v_comp.nome || ' ' || v_comp.cognome, 
        'refund', v_comp_refund
      )
    );
    UPDATE event_companions SET status = 'annullato' WHERE id = v_comp.id;
  END LOOP;

  -- Marca registration cancellata + trigger rollback promo bonus se applicato
  UPDATE event_registrations 
    SET status = 'cancelled', 
        payment_status = 'annullato', 
        self_included = false
    WHERE id = p_registration_id;

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'cancelled_by_admin',
    'admin_id', p_admin_id,
    'refunds', v_refunds,
    'message', 'Iscrizione annullata dall''amministratore'
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_cancel_registration(uuid, uuid, text) TO anon, authenticated;
