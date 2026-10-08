-- Row-Level Security. FORCE makes policies apply to the table owner too (superusers excepted).
-- Every reader policy calls (SELECT app_ctx()) so the signed context is verified once per
-- statement (InitPlan), not once per row.

ALTER TABLE tenants      ENABLE ROW LEVEL SECURITY;  ALTER TABLE tenants      FORCE ROW LEVEL SECURITY;
ALTER TABLE users        ENABLE ROW LEVEL SECURITY;  ALTER TABLE users        FORCE ROW LEVEL SECURITY;
ALTER TABLE documents    ENABLE ROW LEVEL SECURITY;  ALTER TABLE documents    FORCE ROW LEVEL SECURITY;
ALTER TABLE chunks       ENABLE ROW LEVEL SECURITY;  ALTER TABLE chunks       FORCE ROW LEVEL SECURITY;
ALTER TABLE students     ENABLE ROW LEVEL SECURITY;  ALTER TABLE students     FORCE ROW LEVEL SECURITY;
ALTER TABLE employees    ENABLE ROW LEVEL SECURITY;  ALTER TABLE employees    FORCE ROW LEVEL SECURITY;
ALTER TABLE fee_payments ENABLE ROW LEVEL SECURITY;  ALTER TABLE fee_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log    ENABLE ROW LEVEL SECURITY;  ALTER TABLE audit_log    FORCE ROW LEVEL SECURITY;

-- rag_writer is the trusted ingestion service; it is never used to answer user queries.
CREATE POLICY writer_all ON tenants      FOR ALL TO rag_writer USING (true) WITH CHECK (true);
CREATE POLICY writer_all ON users        FOR ALL TO rag_writer USING (true) WITH CHECK (true);
CREATE POLICY writer_all ON documents    FOR ALL TO rag_writer USING (true) WITH CHECK (true);
CREATE POLICY writer_all ON chunks       FOR ALL TO rag_writer USING (true) WITH CHECK (true);
CREATE POLICY writer_all ON students     FOR ALL TO rag_writer USING (true) WITH CHECK (true);
CREATE POLICY writer_all ON employees    FOR ALL TO rag_writer USING (true) WITH CHECK (true);
CREATE POLICY writer_all ON fee_payments FOR ALL TO rag_writer USING (true) WITH CHECK (true);
CREATE POLICY writer_all ON audit_log    FOR ALL TO rag_writer USING (true) WITH CHECK (true);

CREATE POLICY reader_select ON documents FOR SELECT TO rag_reader
  USING (acl_check((SELECT app_ctx()), tenant_id, classification, department,
                   allowed_roles, allowed_users));

CREATE POLICY reader_select ON chunks FOR SELECT TO rag_reader
  USING (acl_check((SELECT app_ctx()), tenant_id, classification, department,
                   allowed_roles, allowed_users));

CREATE POLICY reader_select ON students FOR SELECT TO rag_reader
  USING (student_row_visible((SELECT app_ctx()), tenant_id, user_id, department));

CREATE POLICY reader_select ON fee_payments FOR SELECT TO rag_reader
  USING (fee_row_visible((SELECT app_ctx()), tenant_id, student_id));

CREATE POLICY reader_insert ON audit_log FOR INSERT TO rag_reader
  WITH CHECK (coalesce(
    tenant_id = ((SELECT app_ctx())->>'tid')::uuid
    AND user_id = ((SELECT app_ctx())->>'uid')::uuid, false));

CREATE POLICY reader_select ON audit_log FOR SELECT TO rag_reader
  USING (coalesce(
    tenant_id = ((SELECT app_ctx())->>'tid')::uuid
    AND (user_id = ((SELECT app_ctx())->>'uid')::uuid
         OR ((SELECT app_ctx())->'roles') ? 'admin'), false));
