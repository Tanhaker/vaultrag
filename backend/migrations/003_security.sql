-- Signed security context.
--
-- The API binds the caller's identity to each transaction with
--   set_config('app.ctx', <json>, true), set_config('app.ctx_sig', <hmac>, true)
-- Any SQL running as rag_reader can call set_config too (e.g. LLM-generated SQL), so the
-- context is only trusted when its HMAC verifies against a key the reader role cannot read.
-- A forged, tampered or expired context resolves to NULL and every policy fails closed.

CREATE TABLE app_secrets (
  k text PRIMARY KEY,
  v text NOT NULL
);
REVOKE ALL ON app_secrets FROM PUBLIC;

CREATE FUNCTION app_ctx() RETURNS jsonb
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
  RETURN ctx;
END $$;

REVOKE ALL ON FUNCTION app_ctx() FROM PUBLIC;

-- Document/chunk access rule (ABAC):
--   same tenant AND ( explicitly granted user
--                     OR ( clearance >= classification AND role allowed AND department in scope ) )
-- 'admin' satisfies the role check but is still bound by tenant and clearance.
CREATE FUNCTION acl_check(ctx jsonb, p_tenant uuid, p_class int, p_dept text,
                          p_roles text[], p_users uuid[])
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT coalesce(
    ctx IS NOT NULL
    AND p_tenant = (ctx->>'tid')::uuid
    AND (
      (ctx->>'uid')::uuid = ANY (p_users)
      OR (
        p_class <= (ctx->>'clr')::int
        AND ((ctx->'roles') ? 'admin' OR (ctx->'roles') ?| p_roles OR '*' = ANY (p_roles))
        AND (p_dept IS NULL OR (ctx->'depts') ? p_dept OR (ctx->'depts') ? '*')
      )
    ),
    false)
$$;

-- students: a student sees their own row, faculty/HOD see their department,
-- finance/hr/admin see everyone.
CREATE FUNCTION student_row_visible(ctx jsonb, p_tenant uuid, p_user uuid, p_dept text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT coalesce(
    ctx IS NOT NULL
    AND p_tenant = (ctx->>'tid')::uuid
    AND (
      p_user = (ctx->>'uid')::uuid
      OR (ctx->'roles') ?| ARRAY['admin', 'finance', 'hr']
      OR ((ctx->'roles') ?| ARRAY['faculty', 'hod']
          AND ((ctx->'depts') ? p_dept OR (ctx->'depts') ? '*'))
    ),
    false)
$$;

-- fee_payments: finance/admin see all; a student sees only their own fees.
-- The EXISTS runs as the caller, so it is itself filtered by the students policy.
CREATE FUNCTION fee_row_visible(ctx jsonb, p_tenant uuid, p_student uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(
    ctx IS NOT NULL
    AND p_tenant = (ctx->>'tid')::uuid
    AND (
      (ctx->'roles') ?| ARRAY['admin', 'finance']
      OR EXISTS (SELECT 1 FROM students s
                  WHERE s.id = p_student AND s.user_id = (ctx->>'uid')::uuid)
    ),
    false)
$$;

-- employees: rag_reader has no grant on the base table. The only path is this
-- security-barrier view, which applies row scope and masks compensation columns.
-- security_barrier stops a caller's leaky WHERE function from seeing masked values.
CREATE VIEW employees_secure WITH (security_barrier = true) AS
SELECT e.id, e.tenant_id, e.user_id, e.employee_code, e.name, e.department,
       e.designation, e.email, e.joined_on,
       CASE WHEN e.user_id = (c.ctx->>'uid')::uuid
              OR (c.ctx->'roles') ?| ARRAY['hr', 'finance', 'admin']
            THEN e.salary END            AS salary,
       CASE WHEN e.user_id = (c.ctx->>'uid')::uuid
              OR (c.ctx->'roles') ?| ARRAY['hr', 'admin']
            THEN e.appraisal_rating END  AS appraisal_rating,
       CASE WHEN e.user_id = (c.ctx->>'uid')::uuid
              OR (c.ctx->'roles') ?| ARRAY['hr', 'admin']
            THEN e.appraisal_remarks END AS appraisal_remarks
  FROM employees e
 CROSS JOIN (SELECT app_ctx() AS ctx) c
 WHERE c.ctx IS NOT NULL
   AND e.tenant_id = (c.ctx->>'tid')::uuid;

-- Grants. rag_reader: query-time role, SELECT only (plus writing its own audit rows).
-- rag_writer: ingestion/admin role.
GRANT USAGE ON SCHEMA public TO rag_reader, rag_writer;
GRANT EXECUTE ON FUNCTION app_ctx() TO rag_reader, rag_writer;

GRANT SELECT ON documents, chunks, students, fee_payments, employees_secure TO rag_reader;
GRANT SELECT, INSERT ON audit_log TO rag_reader;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO rag_reader;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON tenants, users, documents, chunks, students, employees, fee_payments, audit_log
  TO rag_writer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rag_writer;
