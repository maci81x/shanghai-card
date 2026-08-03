-- 20260708162838_007_demo_data
-- ricostruita da supabase_migrations.schema_migrations


-- Admin: ADMIN / PIN 0000
INSERT INTO public.users (card_id, display_name, pin_hash, role, balance) VALUES
  ('ADMIN', 'Amministratore', crypt('0000', gen_salt('bf')), 'admin', 0);

-- Staff: STAFF-01/02/03 / PIN 1234
INSERT INTO public.users (card_id, display_name, pin_hash, role, balance) VALUES
  ('STAFF-01', 'Marco Cassa', crypt('1234', gen_salt('bf')), 'staff', 0),
  ('STAFF-02', 'Giulia Bar', crypt('1234', gen_salt('bf')), 'staff', 0),
  ('STAFF-03', 'Luca Gadget', crypt('1234', gen_salt('bf')), 'staff', 0);

-- Users: SH-001..004 / PIN 1111
INSERT INTO public.users (card_id, display_name, pin_hash, role, balance) VALUES
  ('SH-001', 'Roberto Macinai', crypt('1111', gen_salt('bf')), 'user', 2500),
  ('SH-002', 'Francesca Buffa', crypt('1111', gen_salt('bf')), 'user', 1500),
  ('SH-003', 'Paolo Rossi', crypt('1111', gen_salt('bf')), 'user', 800),
  ('SH-004', 'Anna Bianchi', crypt('1111', gen_salt('bf')), 'user', 3000);

-- 3 Events
INSERT INTO public.events (title, description, event_date, location, max_participants, price) VALUES
  ('Cena del Rione', 'Cena sociale annuale del Rione Shanghai', '2026-08-15 20:00:00+02', 'Piazza Castellina Scalo', 120, 1500),
  ('Tombola di Natale', 'Tombola benefica natalizia con premi', '2026-12-20 17:00:00+01', 'Circolo Shanghai', 80, 500),
  ('Shanghai X Run 2027', 'Corsa podistica benefica — terza edizione', '2027-05-10 09:00:00+02', 'Castellina Scalo', 500, 2000);

-- 4 Gadgets
INSERT INTO public.gadgets (name, description, price, stock) VALUES
  ('Maglietta Rione', 'T-shirt ufficiale Rione Shanghai — rosso/nero', 1200, 50),
  ('Cappellino Drago', 'Cappellino con logo drago ricamato', 800, 30),
  ('Borraccia Shanghai', 'Borraccia termica 500ml con stemma', 1000, 25),
  ('Sciarpa Rione', 'Sciarpa invernale rosso/nero con stemma', 1500, 20);

-- 2 Promos
INSERT INTO public.promos (code, description, discount_type, discount_value, valid_until, max_uses) VALUES
  ('DRAGO10', 'Sconto 10% su gadget', 'percent', 10, '2026-12-31 23:59:59+01', 50),
  ('BENVENUTO', 'Sconto benvenuto €2 su primo acquisto', 'fixed', 200, '2026-12-31 23:59:59+01', 100);

-- SumUp links
INSERT INTO public.sumup_links (label, amount, url) VALUES
  ('Ricarica €5', 500, 'https://pay.sumup.com/rione-shanghai-5'),
  ('Ricarica €10', 1000, 'https://pay.sumup.com/rione-shanghai-10'),
  ('Ricarica €20', 2000, 'https://pay.sumup.com/rione-shanghai-20'),
  ('Ricarica €50', 5000, 'https://pay.sumup.com/rione-shanghai-50');

-- Demo transactions: ricariche iniziali
INSERT INTO public.transactions (user_id, type, amount, balance_after, description, operator_id)
SELECT u.id, 'recharge', u.balance, u.balance, 'Ricarica iniziale', (SELECT id FROM public.users WHERE card_id = 'STAFF-01')
FROM public.users u WHERE u.role = 'user';

-- Acquisto SH-001: Maglietta Rione
INSERT INTO public.transactions (user_id, type, amount, balance_after, description)
SELECT u.id, 'purchase', -1200, u.balance - 1200, 'Acquisto: Maglietta Rione'
FROM public.users u WHERE u.card_id = 'SH-001';
UPDATE public.users SET balance = balance - 1200 WHERE card_id = 'SH-001';
UPDATE public.gadgets SET stock = stock - 1 WHERE name = 'Maglietta Rione';

-- Acquisto SH-002: Cappellino Drago
INSERT INTO public.transactions (user_id, type, amount, balance_after, description)
SELECT u.id, 'purchase', -800, u.balance - 800, 'Acquisto: Cappellino Drago'
FROM public.users u WHERE u.card_id = 'SH-002';
UPDATE public.users SET balance = balance - 800 WHERE card_id = 'SH-002';
UPDATE public.gadgets SET stock = stock - 1 WHERE name = 'Cappellino Drago';
