-- 20260709051315_029_staff_user_transactions
-- ricostruita da supabase_migrations.schema_migrations


CREATE OR REPLACE FUNCTION public.staff_get_user_transactions(
  p_operator_id uuid,
  p_card_id text
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_op  public.users%ROWTYPE;
  v_usr public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_op FROM public.users WHERE id = p_operator_id AND active = true;
  IF NOT FOUND OR v_op.role NOT IN ('staff','admin') THEN
    RETURN json_build_object('ok',false,'error','Operatore non autorizzato');
  END IF;

  SELECT * INTO v_usr FROM public.users
    WHERE card_id = upper(trim(p_card_id)) AND active = true;
  IF NOT FOUND THEN
    RETURN json_build_object('ok',false,'error','Tessera non trovata');
  END IF;

  RETURN json_build_object(
    'ok',           true,
    'card_id',      v_usr.card_id,
    'display_name', v_usr.display_name,
    'transactions', (
      SELECT coalesce(json_agg(row_to_json(t)),'[]'::json)
      FROM (
        SELECT tx.id, tx.type, tx.amount, tx.balance_after,
               tx.description, tx.created_at,
               op.display_name AS operator_name
        FROM public.transactions tx
        LEFT JOIN public.users op ON op.id = tx.operator_id
        WHERE tx.user_id = v_usr.id
        ORDER BY tx.created_at DESC
        LIMIT 50
      ) t
    )
  );
END; $$;
