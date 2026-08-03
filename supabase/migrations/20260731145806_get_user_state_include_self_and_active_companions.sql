-- 20260731145806_get_user_state_include_self_and_active_companions
-- ricostruita da supabase_migrations.schema_migrations

CREATE OR REPLACE FUNCTION public.get_user_state(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE u public.users; tx_result json; ev_result json; gd_result json;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = p_user_id;
  IF u.id IS NULL THEN RETURN json_build_object('error','not_found'); END IF;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO tx_result
  FROM (SELECT tx.id, tx.type, tx.amount, tx.balance_after, tx.description,
               tx.created_at, tx.category, tx.payment_method,
               op.display_name AS operator_name
        FROM public.transactions tx
        LEFT JOIN public.users op ON op.id = tx.operator_id
        WHERE tx.user_id = u.id
        ORDER BY tx.created_at DESC LIMIT 30) t;

  SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) INTO ev_result
  FROM (
    SELECT er.id AS registration_id, er.event_id, er.status, er.payment_status,
           er.payment_method, er.self_included,
           er.amount, er.party_size, er.checked_in,
           e.title AS event_title, e.event_date, e.price AS event_price,
           e.sumup_link AS event_sumup_link,
           (e.event_date > now()) AS can_edit,
           COALESCE((
             SELECT json_agg(json_build_object(
                      'id', ec.id,'nome', ec.nome,'cognome', ec.cognome,
                      'payment_status', ec.payment_status,
                      'payment_method', ec.payment_method,
                      'checked_in', ec.checked_in,
                      'status', ec.status
                    ) ORDER BY ec.created_at)
             FROM public.event_companions ec
             WHERE ec.registration_id = er.id AND ec.status='attivo'
           ), '[]'::json) AS companions,
           (CASE WHEN er.self_included AND er.payment_status = 'da_saldare' THEN 1 ELSE 0 END)
           + COALESCE((SELECT count(*) FROM public.event_companions ec2
                       WHERE ec2.registration_id = er.id 
                         AND ec2.status='attivo' AND ec2.payment_status='da_saldare'), 0) AS unpaid_count,
           (CASE WHEN er.self_included AND er.payment_status = 'sumup_in_attesa' THEN 1 ELSE 0 END)
           + COALESCE((SELECT count(*) FROM public.event_companions ec3
                       WHERE ec3.registration_id = er.id 
                         AND ec3.status='attivo' AND ec3.payment_status='sumup_in_attesa'), 0) AS sumup_pending_count,
           (CASE WHEN er.self_included AND er.payment_status = 'cassa_in_attesa' THEN 1 ELSE 0 END)
           + COALESCE((SELECT count(*) FROM public.event_companions ec4
                       WHERE ec4.registration_id = er.id 
                         AND ec4.status='attivo' AND ec4.payment_status='cassa_in_attesa'), 0) AS cassa_pending_count
    FROM public.event_registrations er
    JOIN public.events e ON e.id = er.event_id
    WHERE er.user_id = u.id AND er.status = 'confirmed'
    ORDER BY e.event_date DESC
  ) r;

  SELECT COALESCE(json_agg(row_to_json(g)), '[]'::json) INTO gd_result
  FROM (
    SELECT gr.id, gr.gadget_id, gr.quantity, gr.size, gr.status, gr.created_at,
           gr.payment_method, gr.payment_amount, gr.fulfilled_at,
           gd.name AS gadget_name, gd.price AS gadget_price, gd.has_sizes
    FROM public.gadget_reservations gr
    JOIN public.gadgets gd ON gd.id = gr.gadget_id
    WHERE gr.user_id = u.id
    ORDER BY gr.created_at DESC
  ) g;

  RETURN json_build_object('ok', true,
    'id', u.id, 'card_id', u.card_id, 'display_name', u.display_name,
    'nome', u.nome, 'cognome', u.cognome, 'email', u.email,
    'balance', u.balance, 'is_staff', u.is_staff,
    'transactions', tx_result,
    'event_registrations', ev_result,
    'gadget_reservations', gd_result);
END $function$;
