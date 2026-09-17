CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name varchar(160) NOT NULL,
  password_hash text,
  role text NOT NULL CHECK (role IN ('admin', 'owner', 'coordinator')),
  business_unit text CHECK (business_unit IN ('SPL', '5to Elemento')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role IN ('admin', 'owner') AND business_unit IS NULL) OR (role = 'coordinator' AND business_unit = '5to Elemento'))
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_active_idx ON sessions (token_hash, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit text NOT NULL CHECK (business_unit IN ('SPL', '5to Elemento')),
  client_name varchar(160) NOT NULL,
  client_phone varchar(40),
  venue varchar(200) NOT NULL,
  event_date date NOT NULL,
  operational_status text NOT NULL DEFAULT 'Pendiente' CHECK (operational_status IN ('Pendiente', 'Confirmado', 'Completado', 'Cancelado')),
  operational_notes varchar(2000),
  financial_notes varchar(2000),
  agreed_price numeric(14,2) CHECK (agreed_price >= 0),
  payroll_budget numeric(14,2) NOT NULL DEFAULT 0 CHECK (payroll_budget >= 0),
  extra_expense_budget numeric(14,2) NOT NULL DEFAULT 0 CHECK (extra_expense_budget >= 0),
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_unit_date_idx ON events (business_unit, event_date);

CREATE TABLE customer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id),
  transaction_date date NOT NULL, amount numeric(14,2) NOT NULL CHECK (amount > 0),
  kind text NOT NULL CHECK (kind IN ('payment', 'refund')), idempotency_key varchar(100) NOT NULL UNIQUE,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid REFERENCES events(id),
  scope text NOT NULL DEFAULT 'event' CHECK (scope IN ('event', 'shared')),
  name varchar(200) NOT NULL, category varchar(100) NOT NULL, expense_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0), paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0 AND paid_amount <= amount),
  supplier varchar(200), notes varchar(2000), due_date date, version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'event' AND event_id IS NOT NULL) OR (scope = 'shared' AND event_id IS NULL))
);

CREATE TABLE expense_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), expense_id uuid NOT NULL REFERENCES expenses(id),
  payment_date date NOT NULL, amount numeric(14,2) NOT NULL CHECK (amount > 0),
  idempotency_key varchar(100) NOT NULL UNIQUE, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payroll_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_name varchar(160) NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL, base_cost numeric(14,2) NOT NULL CHECK (base_cost >= 0),
  additions numeric(14,2) NOT NULL DEFAULT 0, deductions numeric(14,2) NOT NULL DEFAULT 0,
  labor_cost numeric(14,2) NOT NULL CHECK (labor_cost >= 0), net_pay numeric(14,2) NOT NULL CHECK (net_pay >= 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0 AND paid_amount <= net_pay),
  version integer NOT NULL DEFAULT 1, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

CREATE TABLE payroll_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payroll_entry_id uuid NOT NULL REFERENCES payroll_entries(id),
  event_id uuid REFERENCES events(id), allocation_scope text NOT NULL CHECK (allocation_scope IN ('event', 'warehouse')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  CHECK ((allocation_scope = 'event' AND event_id IS NOT NULL) OR (allocation_scope = 'warehouse' AND event_id IS NULL))
);

CREATE TABLE payroll_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payroll_entry_id uuid NOT NULL REFERENCES payroll_entries(id),
  payment_date date NOT NULL, amount numeric(14,2) NOT NULL CHECK (amount > 0),
  idempotency_key varchar(100) NOT NULL UNIQUE, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(160) NOT NULL,
  active boolean NOT NULL DEFAULT true, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE TABLE payroll_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(120) NOT NULL UNIQUE,
  employee_id uuid REFERENCES workers(id), base_cost numeric(14,2) NOT NULL CHECK (base_cost >= 0),
  additions numeric(14,2) NOT NULL DEFAULT 0 CHECK (additions >= 0), deductions numeric(14,2) NOT NULL DEFAULT 0 CHECK (deductions >= 0),
  allocations jsonb NOT NULL, created_by text NOT NULL, updated_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(allocations) = 'array')
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, actor_user_id text NOT NULL, entity_type varchar(60) NOT NULL,
  entity_id text NOT NULL, action varchar(40) NOT NULL, old_values jsonb, new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
