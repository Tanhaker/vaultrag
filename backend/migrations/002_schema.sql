-- Core schema: one Postgres holds documents, chunks (vectors + ACL), structured records and audit.

CREATE TABLE tenants (
  id   uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  roles         text[] NOT NULL,
  department    text,
  clearance     int  NOT NULL CHECK (clearance BETWEEN 0 AND 3),
  dept_scope    text[] NOT NULL DEFAULT '{}',   -- departments the user may see; '{*}' = all
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- classification: 0 public, 1 internal, 2 confidential, 3 restricted
CREATE TABLE documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title          text NOT NULL,
  source_type    text NOT NULL CHECK (source_type IN ('pdf', 'image', 'db_record', 'text')),
  uri            text,
  mime_type      text,
  sha256         text,
  owner_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  department     text,
  classification int  NOT NULL DEFAULT 1 CHECK (classification BETWEEN 0 AND 3),
  allowed_roles  text[] NOT NULL DEFAULT '{}',   -- '*' = any role
  allowed_users  uuid[] NOT NULL DEFAULT '{}',   -- explicit need-to-know grants
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error          text,
  meta           jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sha256)
);

CREATE TABLE chunks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord            int  NOT NULL DEFAULT 0,
  modality       text NOT NULL CHECK (modality IN ('text', 'table', 'ocr', 'caption', 'record')),
  content        text NOT NULL,
  content_tsv    tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding      vector(768),
  page           int,
  bbox           jsonb,          -- [x0, y0, x1, y1] in page/image coordinates
  row_ref        text,           -- db://table/id for structured records
  meta           jsonb NOT NULL DEFAULT '{}',
  -- ACL, denormalised from documents by trigger so the ANN scan can filter in one pass.
  -- Application code never sets these; chunks_inherit_acl() overwrites whatever is sent.
  tenant_id      uuid NOT NULL,
  department     text,
  classification int  NOT NULL,
  allowed_roles  text[] NOT NULL,
  allowed_users  uuid[] NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION chunks_inherit_acl() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT d.tenant_id, d.department, d.classification, d.allowed_roles, d.allowed_users
    INTO NEW.tenant_id, NEW.department, NEW.classification, NEW.allowed_roles, NEW.allowed_users
    FROM documents d
   WHERE d.id = NEW.document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document % not found for chunk', NEW.document_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER chunks_acl
  BEFORE INSERT OR UPDATE ON chunks
  FOR EACH ROW EXECUTE FUNCTION chunks_inherit_acl();

-- An ACL change on a document is pushed to its chunks immediately (revocation is instant).
CREATE FUNCTION documents_propagate_acl() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE chunks
     SET tenant_id = NEW.tenant_id,
         department = NEW.department,
         classification = NEW.classification,
         allowed_roles = NEW.allowed_roles,
         allowed_users = NEW.allowed_users
   WHERE document_id = NEW.id;
  RETURN NULL;
END $$;

CREATE TRIGGER documents_acl
  AFTER UPDATE OF tenant_id, department, classification, allowed_roles, allowed_users ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_propagate_acl();

CREATE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER documents_touch
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Structured records (the "DB" modality). Each table carries its own row-level policy.

CREATE TABLE students (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  enrollment_no  text NOT NULL,
  name           text NOT NULL,
  department     text NOT NULL,
  semester       int  NOT NULL,
  cgpa           numeric(4, 2),
  attendance_pct numeric(5, 2),
  email          text,
  phone          text,
  UNIQUE (tenant_id, enrollment_no)
);

CREATE TABLE employees (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  employee_code     text NOT NULL,
  name              text NOT NULL,
  department        text NOT NULL,
  designation       text NOT NULL,
  email             text,
  phone             text,
  joined_on         date,
  salary            numeric(12, 2),   -- annual CTC, INR
  appraisal_rating  int,
  appraisal_remarks text,
  UNIQUE (tenant_id, employee_code)
);

CREATE TABLE fee_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year   text NOT NULL,
  amount_due      numeric(12, 2) NOT NULL,
  amount_paid     numeric(12, 2) NOT NULL DEFAULT 0,
  due_date        date NOT NULL,
  status          text NOT NULL CHECK (status IN ('paid', 'partial', 'pending', 'overdue')),
  last_payment_on date
);

CREATE TABLE audit_log (
  id                  bigserial PRIMARY KEY,
  tenant_id           uuid NOT NULL,
  user_id             uuid NOT NULL,
  action              text NOT NULL,
  query               text,
  retrieved_chunk_ids uuid[] NOT NULL DEFAULT '{}',
  meta                jsonb NOT NULL DEFAULT '{}',
  latency_ms          int,
  created_at          timestamptz NOT NULL DEFAULT now()
);
