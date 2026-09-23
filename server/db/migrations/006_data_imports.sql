CREATE TABLE IF NOT EXISTS data_imports (
  source_hash char(64) PRIMARY KEY,
  source_name text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  counts jsonb NOT NULL
);
