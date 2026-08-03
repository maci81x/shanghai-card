-- 20260718173447_fix_user_search_recipient_no_unaccent
-- ricostruita da supabase_migrations.schema_migrations


create or replace function public.user_search_recipient(
  p_query text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_results jsonb;
begin
  if p_query is null or length(trim(p_query)) < 2 then
    return jsonb_build_object('ok', true, 'results', '[]'::jsonb);
  end if;

  select jsonb_agg(jsonb_build_object(
      'card_id', card_id,
      'nome', nome,
      'cognome', cognome
    ))
    into v_results
  from (
    select card_id, nome, cognome
    from users
    where active = true
      and role = 'user'
      and (
        upper(card_id) = upper(trim(p_query))
        or lower(nome || ' ' || coalesce(cognome,'')) like lower('%' || trim(p_query) || '%')
      )
    order by nome, cognome
    limit 10
  ) t;

  return jsonb_build_object('ok', true, 'results', coalesce(v_results, '[]'::jsonb));
end;
$$;
