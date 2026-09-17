CREATE TABLE IF NOT EXISTS workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(160) NOT NULL,
  active boolean NOT NULL DEFAULT true, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS payroll_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(120) NOT NULL UNIQUE,
  employee_id uuid REFERENCES workers(id), base_cost numeric(14,2) NOT NULL CHECK (base_cost >= 0),
  additions numeric(14,2) NOT NULL DEFAULT 0 CHECK (additions >= 0), deductions numeric(14,2) NOT NULL DEFAULT 0 CHECK (deductions >= 0),
  allocations jsonb NOT NULL, created_by text NOT NULL, updated_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(allocations) = 'array')
);
