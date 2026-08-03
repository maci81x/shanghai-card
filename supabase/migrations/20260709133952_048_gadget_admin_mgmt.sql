-- 20260709133952_048_gadget_admin_mgmt
-- ricostruita da supabase_migrations.schema_migrations


SET search_path = public, extensions;

-- admin_update_gadget
DROP FUNCTION IF EXISTS public.admin_update_gadget(uuid, uuid, text, numeric, text, int);
CREATE OR REPLACE FUNCTION public.admin_update_gadget(
  p_admin_id   UUID,
  p_gadget_id  UUID,
  p_name       TEXT,
  p_price      NUMERIC,
  p_description TEXT DEFAULT NULL,
  p_stock      INT  DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = p_admin_id AND active = true;
  IF v_role != 'admin' THEN
    RETURN json_build_object('ok', false, 'error', 'Solo admin può modificare gadget');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gadgets WHERE id = p_gadget_id AND active = true) THEN
    RETURN json_build_object('ok', false, 'error', 'Gadget non trovato');
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN json_build_object('ok', false, 'error', 'Nome obbligatorio');
  END IF;
  IF p_price IS NULL OR p_price <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'Prezzo non valido');
  END IF;
  UPDATE public.gadgets
  SET name        = trim(p_name),
      price       = p_price,
      description = p_description,
      stock       = COALESCE(p_stock, stock)
  WHERE id = p_gadget_id;
  RETURN json_build_object('ok', true);
END;
$$;

-- admin_delete_gadget (soft delete)
DROP FUNCTION IF EXISTS public.admin_delete_gadget(uuid, uuid);
CREATE OR REPLACE FUNCTION public.admin_delete_gadget(
  p_admin_id  UUID,
  p_gadget_id UUID
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = p_admin_id AND active = true;
  IF v_role != 'admin' THEN
    RETURN json_build_object('ok', false, 'error', 'Solo admin può eliminare gadget');
  END IF;
  UPDATE public.gadgets SET active = false WHERE id = p_gadget_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Gadget non trovato');
  END IF;
  RETURN json_build_object('ok', true);
END;
$$;

-- staff_gadget_reservation_summary
DROP FUNCTION IF EXISTS public.staff_gadget_reservation_summary();
CREATE OR REPLACE FUNCTION public.staff_gadget_reservation_summary()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN json_build_object(
    'ok', true,
    'gadgets', (
      SELECT COALESCE(json_agg(row_to_json(g)), '[]'::json)
      FROM (
        SELECT
          ga.id,
          ga.name,
          ga.price,
          ga.stock,
          ga.description,
          COALESCE(SUM(gr.quantity) FILTER (WHERE gr.status = 'prenotato'), 0) AS prenotati,
          COALESCE(
            json_agg(
              json_build_object(
                'reservation_id', gr.id,
                'card_id',        u.card_id,
                'display_name',   u.display_name,
                'quantity',       gr.quantity,
                'created_at',     gr.created_at
              )
            ) FILTER (WHERE gr.status = 'prenotato'),
            '[]'::json
          ) AS prenotazioni
        FROM public.gadgets ga
        LEFT JOIN public.gadget_reservations gr ON gr.gadget_id = ga.id AND gr.status = 'prenotato'
        LEFT JOIN public.users u ON u.id = gr.user_id
        WHERE ga.active = true
        GROUP BY ga.id, ga.name, ga.price, ga.stock, ga.description
        ORDER BY ga.name
      ) g
    )
  );
END;
$$;
