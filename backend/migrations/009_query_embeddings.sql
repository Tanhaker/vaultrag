-- 009: question-embedding cache and the answer explanation.
--
-- 1. query_embeddings: the vector for a question, stored once so repeated and demo questions spend no
--    embedding quota. Rows are scoped to the user who asked (RLS on the signed context), so one person's
--    question vectors are never readable by another. Only the hash of the question is stored, not its text.
CREATE TABLE query_embeddings (
  tenant_id  uuid NOT NULL,
  user_id    uuid NOT NULL,
  key        text NOT NULL,
  model      text NOT NULL,
  embedding  vector(768) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key, model)
);

ALTER TABLE query_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_embeddings FORCE ROW LEVEL SECURITY;
CREATE POLICY reader_own ON query_embeddings FOR ALL TO rag_reader
  USING (coalesce(tenant_id = ((SELECT app_ctx())->>'tid')::uuid
                  AND user_id = ((SELECT app_ctx())->>'uid')::uuid, false))
  WITH CHECK (coalesce(tenant_id = ((SELECT app_ctx())->>'tid')::uuid
                       AND user_id = ((SELECT app_ctx())->>'uid')::uuid, false));
CREATE POLICY writer_all ON query_embeddings FOR ALL TO rag_writer USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON query_embeddings TO rag_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON query_embeddings TO rag_writer;

-- 2. "Why am I seeing this?": the reader may explain its own access decisions. acl_explain() is pure
--    and only ever receives app_ctx(), the caller's own signed context, so this reveals nothing new.
GRANT EXECUTE ON FUNCTION acl_explain(jsonb, uuid, int, text, text[], uuid[]) TO rag_reader;
