-- 20260731095555_rpc_dashboard_fix_and_gadget_summary_by_size_v2
-- ricostruita da supabase_migrations.schema_migrations


DROP FUNCTION IF EXISTS public.staff_gadget_reservation_summary();

CREATE OR REPLACE FUNCTION public.admin_dashboard()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN json_build_object(
    'total_soci',         (SELECT count(*) FROM public.users WHERE role='user' AND active=true),
    'total_soci_staff',   (SELECT count(*) FROM public.users WHERE role='user' AND active=true AND is_staff=true),
    'total_users',        (SELECT count(*) FROM public.users WHERE role='user' AND active=true),
    'total_staff',        (SELECT count(*) FROM public.users WHERE role='user' AND active=true AND is_staff=true),
    'total_balance',      (SELECT coalesce(sum(balance),0) FROM public.users WHERE role='user' AND active=true),
    'total_recharges',    (SELECT coalesce(sum(amount),0) FROM public.transactions WHERE type='recharge'),
    'total_purchases',    (SELECT coalesce(sum(abs(amount)),0) FROM public.transactions WHERE type='purchase'),
    'total_events',       (SELECT count(*) FROM public.events WHERE active=true),
    'total_registrations',(SELECT count(*) FROM public.event_registrations WHERE status='confirmed'),
    'transactions_today', (SELECT count(*) FROM public.transactions WHERE created_at>=current_date),
    'pending_sumup_count',(SELECT (SELECT count(*) FROM event_registrations WHERE payment_status='sumup_in_attesa')
                                + (SELECT count(*) FROM event_companions    WHERE payment_status='sumup_in_attesa')),
    'pending_refund_count',(SELECT count(*) FROM public.refund_queue WHERE status='da_gestire'),
    'waitlist_count',      (SELECT count(*) FROM public.gadget_reservations WHERE status='attesa_ordine')
  );
END; $$;

CREATE OR REPLACE FUNCTION public.staff_gadget_reservation_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
BEGIN
  RETURN jsonb_build_object(
    'reserved', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT g.id AS gadget_id, g.name, gr.size,
               SUM(gr.quantity) AS qty, COUNT(*) AS n_orders
        FROM gadget_reservations gr JOIN gadgets g ON g.id=gr.gadget_id
        WHERE gr.status='prenotato'
        GROUP BY g.id, g.name, gr.size ORDER BY g.name, gr.size NULLS FIRST
      ) x
    ), '[]'::jsonb),
    'waitlist', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT g.id AS gadget_id, g.name, gr.size,
               SUM(gr.quantity) AS qty, COUNT(*) AS n_orders
        FROM gadget_reservations gr JOIN gadgets g ON g.id=gr.gadget_id
        WHERE gr.status='attesa_ordine'
        GROUP BY g.id, g.name, gr.size ORDER BY g.name, gr.size NULLS FIRST
      ) x
    ), '[]'::jsonb),
    'delivered_by_size', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT g.id AS gadget_id, g.name, gr.size,
               SUM(gr.quantity) AS qty, COUNT(*) AS n_orders
        FROM gadget_reservations gr JOIN gadgets g ON g.id=gr.gadget_id
        WHERE gr.status='consegnato'
        GROUP BY g.id, g.name, gr.size ORDER BY g.name, gr.size NULLS FIRST
      ) x
    ), '[]'::jsonb)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.admin_gadget_sales_stats(p_operator_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=p_operator_id AND active=true AND (role='admin' OR is_staff=true)) THEN
    RETURN jsonb_build_object('ok',false,'error','Non autorizzato');
  END IF;
  RETURN jsonb_build_object('ok',true,
    'by_gadget', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT g.id, g.name, COUNT(gr.id) AS orders, COALESCE(SUM(gr.quantity),0) AS total_qty,
               COALESCE(SUM(gr.payment_amount),0) AS revenue
        FROM gadgets g LEFT JOIN gadget_reservations gr ON gr.gadget_id=g.id AND gr.status='consegnato'
        GROUP BY g.id, g.name ORDER BY total_qty DESC
      ) x
    ), '[]'::jsonb),
    'by_size', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT g.name AS gadget_name, gr.size, COUNT(*) AS orders, SUM(gr.quantity) AS qty
        FROM gadget_reservations gr JOIN gadgets g ON g.id=gr.gadget_id
        WHERE gr.status='consegnato' AND gr.size IS NOT NULL
        GROUP BY g.name, gr.size ORDER BY g.name, gr.size
      ) x
    ), '[]'::jsonb),
    'stock_levels', COALESCE((
      SELECT jsonb_agg(row_to_json(x)) FROM (
        SELECT g.name AS gadget_name, gs.size, gs.stock
        FROM gadget_sizes gs JOIN gadgets g ON g.id=gs.gadget_id
        WHERE g.active=true ORDER BY g.name, gs.sort_order
      ) x
    ), '[]'::jsonb)
  );
END; $$;
