-- 20260709122922_042_cleanup_test_events
-- ricostruita da supabase_migrations.schema_migrations


DELETE FROM event_guests WHERE event_id IN (
  '4ff95f07-aa81-4122-87b7-c73f25c6bd63',
  '95eebe96-bbe8-4ba6-84ee-c4d4c3fa4ce9'
);
DELETE FROM events WHERE id IN (
  '4ff95f07-aa81-4122-87b7-c73f25c6bd63',
  '95eebe96-bbe8-4ba6-84ee-c4d4c3fa4ce9'
);
