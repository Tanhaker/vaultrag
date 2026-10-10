-- 010: private chat attachments.
--
-- A file attached in the chat becomes a document readable only by its owner: no role is granted
-- (allowed_roles = '{}') and the owner is the single entry in allowed_users, so acl_check() admits the
-- owner through the per-user grant and nobody else by role (admins excepted, as everywhere).
--
-- Such a document cannot change what anyone else may read, so it must not bump kb_version: that would
-- invalidate every user's cached answers. The upload endpoint clears the owner's own cache instead.
CREATE FUNCTION documents_kb_bump() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  private_old boolean := TG_OP <> 'INSERT' AND OLD.allowed_roles = '{}' AND cardinality(OLD.allowed_users) = 1;
  private_new boolean := TG_OP <> 'DELETE' AND NEW.allowed_roles = '{}' AND cardinality(NEW.allowed_users) = 1;
BEGIN
  IF (TG_OP = 'INSERT' AND private_new) OR (TG_OP = 'DELETE' AND private_old)
     OR (TG_OP = 'UPDATE' AND private_old AND private_new AND OLD.allowed_users = NEW.allowed_users) THEN
    RETURN NULL;
  END IF;
  INSERT INTO kb_version AS k (tenant_id, version) VALUES (coalesce(NEW.tenant_id, OLD.tenant_id), 1)
  ON CONFLICT (tenant_id) DO UPDATE SET version = k.version + 1;
  RETURN NULL;
END $$;

DROP TRIGGER documents_kb_version ON documents;
CREATE TRIGGER documents_kb_version
  AFTER INSERT OR UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_kb_bump();
