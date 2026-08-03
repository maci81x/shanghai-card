-- 20260718180513_enrich_get_user_state_event_companions
-- ricostruita da supabase_migrations.schema_migrations


create or replace function public.get_user_state(p_user_id uuid)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare u public.users; tx_result json; ev_result json; gd_result json;
begin
  select * into u from public.users where id = p_user_id;
  if u.id is null then return json_build_object('error','not_found'); end if;

  select coalesce(json_agg(row_to_json(t)), '[]'::json) into tx_result
  from (select tx.id, tx.type, tx.amount, tx.balance_after, tx.description,
               tx.created_at, tx.category, tx.payment_method,
               op.display_name as operator_name
        from public.transactions tx
        left join public.users op on op.id = tx.operator_id
        where tx.user_id = u.id
        order by tx.created_at desc limit 30) t;

  select coalesce(json_agg(row_to_json(r)), '[]'::json) into ev_result
  from (
    select er.id as registration_id, er.event_id, er.status, er.payment_status,
           er.amount, er.party_size, er.checked_in,
           e.title as event_title, e.event_date, e.price as event_price,
           e.sumup_link as event_sumup_link,
           -- lista accompagnatori con stato pagamento e check-in
           coalesce((
             select json_agg(json_build_object(
                      'id', ec.id,
                      'nome', ec.nome,
                      'cognome', ec.cognome,
                      'payment_status', ec.payment_status,
                      'payment_method', ec.payment_method,
                      'checked_in', ec.checked_in
                    ) order by ec.created_at)
             from public.event_companions ec
             where ec.registration_id = er.id
           ), '[]'::json) as companions,
           -- quante persone restano da saldare (self + accompagnatori)
           (case when er.payment_status = 'da_saldare' then 1 else 0 end)
           + coalesce((
               select count(*) from public.event_companions ec2
               where ec2.registration_id = er.id and ec2.payment_status = 'da_saldare'
             ), 0) as unpaid_count
    from public.event_registrations er
    join public.events e on e.id = er.event_id
    where er.user_id = u.id and er.status = 'confirmed'
    order by e.event_date desc
  ) r;

  select coalesce(json_agg(row_to_json(g)), '[]'::json) into gd_result
  from (
    select gr.id, gr.gadget_id, gr.quantity, gr.status, gr.created_at,
           gd.name as gadget_name, gd.price as gadget_price
    from public.gadget_reservations gr
    join public.gadgets gd on gd.id = gr.gadget_id
    where gr.user_id = u.id
    order by gr.created_at desc
  ) g;

  return json_build_object('ok', true,
    'id', u.id, 'card_id', u.card_id, 'display_name', u.display_name,
    'nome', u.nome, 'cognome', u.cognome, 'email', u.email,
    'balance', u.balance, 'is_staff', u.is_staff,
    'transactions', tx_result,
    'event_registrations', ev_result,
    'gadget_reservations', gd_result);
end $function$;
