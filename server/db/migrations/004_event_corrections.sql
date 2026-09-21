ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
