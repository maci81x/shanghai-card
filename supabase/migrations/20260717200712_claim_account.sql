-- =====================================================================
-- Shanghai Card — RPC claim_account (17/07/2026)
-- =====================================================================
-- Permette ai 14 nuovi soci pre-caricati (SH-015 → SH-028) di reclamare
-- la propria tessera completando dati anagrafici + PIN + consensi GDPR.
-- Non tocca public_register (usato per nuove iscrizioni da zero).
-- =====================================================================

create or replace function public.claim_account(
  p_card_id text,
  p_nome text,
  p_cognome text,
  p_codice_fiscale text,
  p_email text default null,
  p_telefono text default null,
  p_pin text default null,
  p_gdpr_trattamento boolean default false,
  p_gdpr_privacy_letta boolean default false,
  p_gdpr_comunicazioni boolean default false,
  p_gdpr_immagini boolean default false
)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare u public.users;
begin
  select * into u from public.users where card_id = upper(trim(p_card_id));
  if u.id is null then
    return json_build_object('error', 'not_found',
      'message', 'Tessera non trovata');
  end if;

  if u.codice_fiscale is not null and u.codice_fiscale != '' then
    return json_build_object('error', 'already_claimed',
      'message', 'Questa tessera è già stata registrata');
  end if;

  update public.users set
    nome = trim(p_nome),
    cognome = trim(p_cognome),
    display_name = trim(p_nome) || ' ' || trim(p_cognome),
    codice_fiscale = upper(trim(p_codice_fiscale)),
    email = nullif(trim(coalesce(p_email, '')), ''),
    telefono = nullif(trim(coalesce(p_telefono, '')), ''),
    pin_hash = case
      when p_pin is not null and p_pin != ''
      then crypt(p_pin, gen_salt('bf'))
      else pin_hash
    end,
    gdpr_trattamento = p_gdpr_trattamento,
    gdpr_privacy_letta = p_gdpr_privacy_letta,
    gdpr_comunicazioni = p_gdpr_comunicazioni,
    gdpr_immagini = p_gdpr_immagini,
    registered_at = now(),
    updated_at = now()
  where id = u.id;

  return json_build_object('ok', true, 'card_id', u.card_id,
    'display_name', trim(p_nome) || ' ' || trim(p_cognome),
    'balance', u.balance);
end $$;

-- ---------------------------------------------------------------------
-- Helper: elenco card_id dei soci con registrazione incompleta
-- (codice_fiscale null/vuoto oppure gdpr_privacy_letta false).
-- Restituisce solo card_id per non esporre altri dati sensibili;
-- il frontend usa il set per mostrare un badge nella lista soci admin.
-- ---------------------------------------------------------------------
create or replace function public.admin_list_incomplete_users(p_admin_id uuid)
returns json language plpgsql security definer set search_path = public, extensions
as $$
declare result json;
begin
  if not exists (select 1 from public.users where id = p_admin_id and role = 'admin') then
    return json_build_object('error', 'not_admin');
  end if;
  select coalesce(json_agg(x), '[]'::json) into result from (
    select card_id,
           (codice_fiscale is null or codice_fiscale = '') as missing_cf,
           (coalesce(gdpr_privacy_letta, false) = false)   as missing_privacy
    from public.users
    where role = 'user'
      and ((codice_fiscale is null or codice_fiscale = '')
           or coalesce(gdpr_privacy_letta, false) = false)
  ) x;
  return result;
end $$;
