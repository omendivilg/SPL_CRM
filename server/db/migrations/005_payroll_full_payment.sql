-- Preserve the previous payroll state before its first v2 transaction.
CREATE TABLE IF NOT EXISTS weekly_payroll_backups (
  name text PRIMARY KEY,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
