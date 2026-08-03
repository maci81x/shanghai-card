-- 20260709051306_028_event_dashboard_rpc
-- ricostruita da supabase_migrations.schema_migrations


CREATE OR REPLACE FUNCTION public.admin_event_dashboard(p_event_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_reg_total   INTEGER; v_reg_paid    INTEGER;
  v_reg_present INTEGER; v_reg_incasso NUMERIC;
  v_gst_total   INTEGER; v_gst_paid    INTEGER;
  v_gst_present INTEGER; v_gst_incasso NUMERIC;
BEGIN
  SELECT
    count(*)        FILTER (WHERE payment_status != 'annullato'),
    count(*)        FILTER (WHERE payment_status NOT IN ('annullato','da_saldare')),
    count(*)        FILTER (WHERE checked_in = true),
    coalesce(sum(amount) FILTER (WHERE payment_status NOT IN ('annullato','da_saldare')), 0)
  INTO v_reg_total, v_reg_paid, v_reg_present, v_reg_incasso
  FROM public.event_registrations WHERE event_id = p_event_id;

  SELECT
    count(*)        FILTER (WHERE payment_status != 'annullato'),
    count(*)        FILTER (WHERE payment_status NOT IN ('annullato','da_saldare')),
    count(*)        FILTER (WHERE checked_in = true),
    coalesce(sum(amount) FILTER (WHERE payment_status NOT IN ('annullato','da_saldare')), 0)
  INTO v_gst_total, v_gst_paid, v_gst_present, v_gst_incasso
  FROM public.event_guests WHERE event_id = p_event_id;

  RETURN json_build_object(
    'ok',            true,
    'total_iscritti', coalesce(v_reg_total,0) + coalesce(v_gst_total,0),
    'total_paganti',  coalesce(v_reg_paid,0)  + coalesce(v_gst_paid,0),
    'total_presenti', coalesce(v_reg_present,0)+ coalesce(v_gst_present,0),
    'incasso_totale', coalesce(v_reg_incasso,0)+ coalesce(v_gst_incasso,0)
  );
END; $$;
