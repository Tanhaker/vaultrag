-- Trust layer: everything here is enforced by Postgres, not by application code.
--
--   1. Account kill switch       app_ctx() returns NULL for a locked user, so a still-valid JWT reads nothing.
--   2. PII column masking        students_secure + column grants: rag_reader cannot select phone or email.
--   3. Aggregate-only salaries   salary_stats: department averages, suppressed below k = 5 employees.
--   4. Data version              kb_version also moves when structured rows change.
--   5. Shared answer cache       answer_cache, RLS-scoped to the user who asked.
--   6. Canary registry           lets the egress filter tell a forbidden canary from an allowed one.
--   7. Tamper-evident audit log  every row hashes the previous row; audit_chain_verify() walks the chain.
--   8. acl_explain()             the access decision broken down by condition, for the access matrix.
--   9. llm_calls_today()         tenant-wide AI usage as a single number, for the quota guard.

-- The migration role owns these tables. On managed Postgres it may be neither superuser nor
-- BYPASSRLS (see 006), so it gets explicit owner policies where its own functions read rows.

-- 1. Kill switch -------------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_reason text;
CREATE POLICY owner_read ON users FOR SELECT TO CURRENT_USER USING (true);

CREATE OR REPLACE FUNCTION app_ctx() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  payload text := current_setting('app.ctx', true);
  sig     text := current_setting('app.ctx_sig', true);
  secret  text;
  ctx     jsonb;
BEGIN
  IF coalesce(payload, '') = '' OR coalesce(sig, '') = '' THEN
    RETURN NULL;
  END IF;
  SELECT v INTO secret FROM app_secrets WHERE k = 'ctx_hmac';
  IF secret IS NULL OR encode(hmac(payload, secret, 'sha256'), 'hex') <> sig THEN
    RETURN NULL;
  END IF;
  ctx := payload::jsonb;
  IF (ctx->>'exp')::bigint < extract(epoch FROM now()) THEN
    RETURN NULL;
  END IF;
  -- A locked account loses access mid-session: its signed context stops resolving.
  IF EXISTS (SELECT 1 FROM users WHERE id = (ctx->>'uid')::uuid AND locked_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  RETURN ctx;
END $$;

-- 2. Student PII ------------------------------------------------------------------------------
-- rag_reader keeps every column except contact details on the base table; contact details are
-- only reachable through the masking view.
REVOKE SELECT ON students FROM rag_reader;
GRANT SELECT (id, tenant_id, user_id, enrollment_no, name, department, semester, cgpa, attendance_pct)
  ON students TO rag_reader;
CREATE POLICY owner_read ON students FOR SELECT TO CURRENT_USER USING (true);

CREATE VIEW students_secure WITH (security_barrier = true) AS
SELECT s.id, s.tenant_id, s.user_id, s.enrollment_no, s.name, s.department, s.semester, s.cgpa,
       s.attendance_pct,
       CASE WHEN s.user_id = (c.ctx->>'uid')::uuid
              OR (c.ctx->'roles') ?| ARRAY['faculty', 'hod', 'finance', 'admin']
            THEN s.email END AS email,
       CASE WHEN s.user_id = (c.ctx->>'uid')::uuid
              OR (c.ctx->'roles') ? 'admin'
            THEN s.phone END AS phone
  FROM students s
 CROSS JOIN (SELECT app_ctx() AS ctx) c
 WHERE student_row_visible(c.ctx, s.tenant_id, s.user_id, s.department);

GRANT SELECT ON students_secure TO rag_reader;

-- 3. Aggregate-only salary statistics ---------------------------------------------------------
-- Heads of department may see their department's average pay for planning, never an individual.
-- One fixed granularity (department) and k = 5: two overlapping groupings would let a caller
-- subtract one from the other (a differencing attack), and a small group is one person's salary.
CREATE VIEW salary_stats WITH (security_barrier = true) AS
SELECT e.department,
       count(*)::int AS employees,
       CASE WHEN count(*) >= 5 THEN round(avg(e.salary)) END AS avg_salary,
       count(*) < 5 AS suppressed
  FROM employees e
 CROSS JOIN (SELECT app_ctx() AS ctx) c
 WHERE c.ctx IS NOT NULL
   AND e.tenant_id = (c.ctx->>'tid')::uuid
   AND ((c.ctx->'roles') ?| ARRAY['hr', 'finance', 'admin']
        OR ((c.ctx->'roles') ? 'hod' AND ((c.ctx->'depts') ? e.department OR (c.ctx->'depts') ? '*')))
 GROUP BY e.department;

GRANT SELECT ON salary_stats TO rag_reader;

-- 4. Structured rows move the data version too ------------------------------------------------
CREATE TRIGGER students_kb_version AFTER INSERT OR UPDATE OR DELETE ON students
  FOR EACH ROW EXECUTE FUNCTION kb_bump();
CREATE TRIGGER fee_payments_kb_version AFTER INSERT OR UPDATE OR DELETE ON fee_payments
  FOR EACH ROW EXECUTE FUNCTION kb_bump();
CREATE TRIGGER employees_kb_version AFTER INSERT OR UPDATE OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION kb_bump();

-- 5. Answer cache shared by every server instance ---------------------------------------------
CREATE TABLE answer_cache (
  tenant_id  uuid NOT NULL,
  user_id    uuid NOT NULL,
  key        text NOT NULL,
  kb_version bigint NOT NULL,
  answer     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  hits       int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, key)
);

ALTER TABLE answer_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY reader_own ON answer_cache FOR ALL TO rag_reader
  USING (coalesce(tenant_id = ((SELECT app_ctx())->>'tid')::uuid
                  AND user_id = ((SELECT app_ctx())->>'uid')::uuid, false))
  WITH CHECK (coalesce(tenant_id = ((SELECT app_ctx())->>'tid')::uuid
                       AND user_id = ((SELECT app_ctx())->>'uid')::uuid, false));
CREATE POLICY writer_all ON answer_cache FOR ALL TO rag_writer USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON answer_cache TO rag_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON answer_cache TO rag_writer;

-- 6. Canary registry --------------------------------------------------------------------------
CREATE TABLE canaries (
  token       text PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE
);

ALTER TABLE canaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE canaries FORCE ROW LEVEL SECURITY;
-- A canary is visible exactly when its document is (the EXISTS runs under the documents policy).
CREATE POLICY reader_select ON canaries FOR SELECT TO rag_reader
  USING (EXISTS (SELECT 1 FROM documents d WHERE d.id = canaries.document_id));
CREATE POLICY writer_all ON canaries FOR ALL TO rag_writer USING (true) WITH CHECK (true);
GRANT SELECT ON canaries TO rag_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON canaries TO rag_writer;

-- 7. Tamper-evident audit log -----------------------------------------------------------------
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS row_hash text;
CREATE POLICY owner_all ON audit_log FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS audit_log_user_time ON audit_log (user_id, created_at DESC);

CREATE TABLE audit_chain_head (
  tenant_id uuid PRIMARY KEY,
  last_id   bigint NOT NULL,
  last_hash text NOT NULL
);
ALTER TABLE audit_chain_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_chain_head FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON audit_chain_head FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);

CREATE FUNCTION audit_row_hash(prev text, a audit_log) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT encode(digest(concat_ws('|', prev, a.id::text, a.tenant_id::text, a.user_id::text, a.action,
                                 coalesce(a.query, ''), array_to_string(a.retrieved_chunk_ids, ','),
                                 a.meta::text, coalesce(a.latency_ms::text, ''),
                                 to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')),
                       'sha256'), 'hex')
$$;

-- Runs as the owner so it can read the chain head, which no app role can see. The per-tenant
-- advisory lock serialises appends, and the id is drawn after the lock so id order = chain order.
CREATE FUNCTION audit_chain_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || NEW.tenant_id::text, 0));
  NEW.id := nextval('audit_log_id_seq');
  SELECT last_hash INTO prev FROM audit_chain_head WHERE tenant_id = NEW.tenant_id;
  NEW.prev_hash := coalesce(prev, repeat('0', 64));
  NEW.row_hash := audit_row_hash(NEW.prev_hash, NEW);
  INSERT INTO audit_chain_head AS h (tenant_id, last_id, last_hash) VALUES (NEW.tenant_id, NEW.id, NEW.row_hash)
  ON CONFLICT (tenant_id) DO UPDATE SET last_id = EXCLUDED.last_id, last_hash = EXCLUDED.last_hash;
  RETURN NEW;
END $$;

-- Link the rows written before this migration, in id order.
DO $$
DECLARE
  t    uuid;
  r    audit_log%ROWTYPE;
  prev text;
  h    text;
  last bigint;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM audit_log LOOP
    prev := repeat('0', 64);
    FOR r IN SELECT * FROM audit_log WHERE tenant_id = t ORDER BY id LOOP
      h := audit_row_hash(prev, r);
      UPDATE audit_log SET prev_hash = prev, row_hash = h WHERE id = r.id;
      prev := h;
      last := r.id;
    END LOOP;
    INSERT INTO audit_chain_head (tenant_id, last_id, last_hash) VALUES (t, last, prev)
    ON CONFLICT (tenant_id) DO UPDATE SET last_id = EXCLUDED.last_id, last_hash = EXCLUDED.last_hash;
  END LOOP;
END $$;

CREATE TRIGGER audit_chain BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_chain_link();

-- Admin-only: recompute every hash in order. Any edited, deleted or reordered row breaks the walk.
CREATE FUNCTION audit_chain_verify() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ctx  jsonb := app_ctx();
  r    audit_log%ROWTYPE;
  prev text := repeat('0', 64);
  n    bigint := 0;
  bad  bigint;
  head text;
BEGIN
  IF ctx IS NULL OR NOT (ctx->'roles') ? 'admin' THEN
    RETURN NULL;
  END IF;
  FOR r IN SELECT * FROM audit_log WHERE tenant_id = (ctx->>'tid')::uuid ORDER BY id LOOP
    IF r.prev_hash IS DISTINCT FROM prev OR r.row_hash IS DISTINCT FROM audit_row_hash(prev, r) THEN
      bad := r.id;
      EXIT;
    END IF;
    prev := r.row_hash;
    n := n + 1;
  END LOOP;
  SELECT last_hash INTO head FROM audit_chain_head WHERE tenant_id = (ctx->>'tid')::uuid;
  RETURN jsonb_build_object('entries', n, 'intact', bad IS NULL AND (head IS NULL OR head = prev),
                            'first_bad_id', bad, 'head', coalesce(head, prev), 'walked_to', prev);
END $$;

REVOKE ALL ON FUNCTION audit_chain_verify() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_chain_verify() TO rag_reader;

-- 8. Access decision, explained ---------------------------------------------------------------
-- 'allowed' comes from acl_check() itself, the function every RLS policy calls; the other keys
-- only explain which condition passed or failed.
CREATE FUNCTION acl_explain(ctx jsonb, p_tenant uuid, p_class int, p_dept text,
                            p_roles text[], p_users uuid[])
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'allowed',   acl_check(ctx, p_tenant, p_class, p_dept, p_roles, p_users),
    'tenant',    coalesce(p_tenant = (ctx->>'tid')::uuid, false),
    'grant',     coalesce((ctx->>'uid')::uuid = ANY (p_users), false),
    'clearance', coalesce(p_class <= (ctx->>'clr')::int, false),
    'role',      coalesce((ctx->'roles') ? 'admin' OR (ctx->'roles') ?| p_roles OR '*' = ANY (p_roles), false),
    'dept',      coalesce(p_dept IS NULL OR (ctx->'depts') ? p_dept OR (ctx->'depts') ? '*', false))
$$;

GRANT EXECUTE ON FUNCTION acl_explain(jsonb, uuid, int, text, text[], uuid[]) TO rag_writer;

-- 9. Tenant-wide AI usage, as one number ------------------------------------------------------
-- The quota guard needs today's total; the caller can only see their own audit rows, so this
-- returns the sum without exposing anyone's entries. Gemini quotas reset at midnight Pacific.
CREATE FUNCTION llm_calls_today() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum((meta->>'llm_calls')::int), 0)
    FROM audit_log
   WHERE tenant_id = ((SELECT app_ctx())->>'tid')::uuid
     AND created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles')
                        AT TIME ZONE 'America/Los_Angeles')
$$;

REVOKE ALL ON FUNCTION llm_calls_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION llm_calls_today() TO rag_reader;
