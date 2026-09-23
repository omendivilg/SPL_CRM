ALTER TABLE events ADD COLUMN deleted_at timestamptz;
ALTER TABLE customer_payments ADD COLUMN deleted_at timestamptz;
CREATE INDEX events_active_idx ON events (event_date) WHERE deleted_at IS NULL;
CREATE INDEX customer_payments_active_idx ON customer_payments (event_id) WHERE deleted_at IS NULL;
