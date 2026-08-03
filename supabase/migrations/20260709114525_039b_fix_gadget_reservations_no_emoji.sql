-- 20260709114525_039b_fix_gadget_reservations_no_emoji
-- ricostruita da supabase_migrations.schema_migrations


SET search_path = public, extensions;

-- Fix user_list_gadget_reservations: rimuovi emoji (colonna non esiste)
DROP FUNCTION IF EXISTS public.user_list_gadget_reservations(uuid);
CREATE OR REPLACE FUNCTION public.user_list_gadget_reservations(
  p_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'reservation_id', gr.id,
      'gadget_id',      gr.gadget_id,
      'gadget_name',    g.name,
      'gadget_desc',    g.description,
      'price_each',     g.price,
      'quantity',       gr.quantity,
      'total_price',    g.price * gr.quantity,
      'status',         gr.status,
      'created_at',     gr.created_at
    ) ORDER BY gr.created_at DESC), '[]'::jsonb)
    FROM gadget_reservations gr
    JOIN gadgets g ON g.id = gr.gadget_id
    WHERE gr.user_id = p_user_id AND gr.status != 'annullato'
  );
END;
$$;

-- Fix staff_list_gadget_reservations: rimuovi emoji
DROP FUNCTION IF EXISTS public.staff_list_gadget_reservations(uuid);
CREATE OR REPLACE FUNCTION public.staff_list_gadget_reservations(
  p_operator_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'reservation_id', gr.id,
      'card_id',        u.card_id,
      'display_name',   u.display_name,
      'gadget_name',    g.name,
      'gadget_desc',    g.description,
      'price_each',     g.price,
      'quantity',       gr.quantity,
      'total_price',    g.price * gr.quantity,
      'status',         gr.status,
      'created_at',     gr.created_at
    ) ORDER BY gr.created_at), '[]'::jsonb)
    FROM gadget_reservations gr
    JOIN users u ON u.id = gr.user_id
    JOIN gadgets g ON g.id = gr.gadget_id
    WHERE gr.status = 'prenotato'
  );
END;
$$;
