CREATE TABLE IF NOT EXISTS weekly_payroll_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
