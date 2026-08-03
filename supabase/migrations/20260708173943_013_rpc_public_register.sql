-- 20260708173943_013_rpc_public_register
-- ricostruita da supabase_migrations.schema_migrations


CREATE OR REPLACE FUNCTION public.public_register(
  p_nome TEXT, p_cognome TEXT, p_codice_fiscale TEXT,
  p_email TEXT, p_telefono TEXT, p_pin TEXT,
  p_gdpr_trattamento BOOLEAN, p_gdpr_privacy BOOLEAN,
  p_gdpr_comunicazioni BOOLEAN DEFAULT false, p_gdpr_immagini BOOLEAN DEFAULT false
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_card_id TEXT;
  v_id UUID;
BEGIN
  IF NOT p_gdpr_trattamento OR NOT p_gdpr_privacy THEN
    RETURN json_build_object('ok', false, 'error', 'Consenso obbligatorio al trattamento dati e privacy');
  END IF;
  IF length(p_pin) < 4 OR length(p_pin) > 6 THEN
    RETURN json_build_object('ok', false, 'error', 'Il PIN deve essere di 4-6 cifre');
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE codice_fiscale = upper(trim(p_codice_fiscale))) THEN
    RETURN json_build_object('ok', false, 'error', 'Codice fiscale già registrato. Hai già una card?');
  END IF;

  v_card_id := 'SH-' || lpad(nextval('public.card_id_seq')::TEXT, 3, '0');

  INSERT INTO public.users (card_id, display_name, nome, cognome, codice_fiscale, email, telefono,
    pin_hash, role, balance,
    gdpr_trattamento, gdpr_privacy_letta, gdpr_comunicazioni, gdpr_immagini)
  VALUES (
    v_card_id,
    p_nome || ' ' || p_cognome,
    trim(p_nome), trim(p_cognome), upper(trim(p_codice_fiscale)),
    lower(trim(p_email)), trim(p_telefono),
    crypt(p_pin, gen_salt('bf')),
    'user', 0.00,
    p_gdpr_trattamento, p_gdpr_privacy, p_gdpr_comunicazioni, p_gdpr_immagini
  ) RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'card_id', v_card_id, 'id', v_id,
    'message', 'Tessera creata! Il tuo codice è ' || v_card_id);
END; $$;
