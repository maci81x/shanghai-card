-- 20260803163717_event_children_cascade_on_delete
-- ricostruita da supabase_migrations.schema_migrations

-- Uniforma la cascata di cancellazione per tutti i figli di events
-- Motivazione: event_price_tiers e sumup_links sono già CASCADE,
-- event_guests e event_registrations erano NO ACTION → incoerenza.
-- Ora cancellare un evento cancella tutte le sue iscrizioni/ospiti.
-- ⚠️ L'UI admin deve mostrare warning esplicito prima di eliminare eventi con iscrizioni.

ALTER TABLE public.event_guests 
  DROP CONSTRAINT event_guests_event_id_fkey,
  ADD CONSTRAINT event_guests_event_id_fkey 
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.event_registrations 
  DROP CONSTRAINT event_registrations_event_id_fkey,
  ADD CONSTRAINT event_registrations_event_id_fkey 
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;
