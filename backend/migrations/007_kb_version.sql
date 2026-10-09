-- Knowledge-base version per tenant, bumped by every insert, update or delete on documents.
-- Answer caches include it in their key, so an ACL change or a new upload invalidates cached
-- answers on every server instance at once. Serverless functions share no memory, so clearing
-- one process's cache is not enough to make revocation instant.
CREATE TABLE kb_version (
  tenant_id uuid PRIMARY KEY,  -- no FK: a tenant delete cascades to documents, whose trigger lands here
  version   bigint NOT NULL DEFAULT 0
);

ALTER TABLE kb_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_version FORCE ROW LEVEL SECURITY;

CREATE POLICY reader_select ON kb_version FOR SELECT TO rag_reader
  USING (tenant_id = ((SELECT app_ctx()) ->> 'tid')::uuid);
CREATE POLICY writer_all ON kb_version FOR ALL TO rag_writer USING (true) WITH CHECK (true);
-- The migration role may also touch documents (tests, maintenance); see 006 for why it needs a policy.
CREATE POLICY owner_all ON kb_version FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);

GRANT SELECT ON kb_version TO rag_reader;
GRANT SELECT, INSERT, UPDATE ON kb_version TO rag_writer;

CREATE FUNCTION kb_bump() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  t uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    t := OLD.tenant_id;
  ELSE
    t := NEW.tenant_id;
  END IF;
  INSERT INTO kb_version AS k (tenant_id, version) VALUES (t, 1)
  ON CONFLICT (tenant_id) DO UPDATE SET version = k.version + 1;
  RETURN NULL;
END $$;

CREATE TRIGGER documents_kb_version
  AFTER INSERT OR UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION kb_bump();

INSERT INTO kb_version (tenant_id, version) SELECT id, 1 FROM tenants ON CONFLICT DO NOTHING;
