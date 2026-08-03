-- 20260709054250_034_staff_event_counts
-- ricostruita da supabase_migrations.schema_migrations


-- staff_list_pending_events: aggiunge total_registrations per ogni evento
CREATE OR REPLACE FUNCTION public.staff_list_pending_events(p_card_id text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions' AS $$
BEGIN
  RETURN (
    SELECT coalesce(json_agg(row_to_json(r)),'[]'::json)
    FROM (
      SELECT er.id AS registration_id,
             ev.title AS evento,
             ev.event_date,
             er.amount,
             er.payment_status,
             er.created_at AS iscritto_il,
             u.card_id,
             u.display_name,
             ev.sumup_link,
             (SELECT count(*) FROM public.event_registrations x
              WHERE x.event_id=er.event_id AND x.payment_status != 'annullato'
             )::int AS total_registrations
      FROM public.event_registrations er
      JOIN public.events ev ON ev.id=er.event_id
      JOIN public.users  u  ON u.id =er.user_id
      WHERE u.card_id=upper(trim(p_card_id))
        AND er.payment_status='da_saldare'
      ORDER BY ev.event_date
    ) r
  );
END; $$;
