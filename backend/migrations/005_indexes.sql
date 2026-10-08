-- ANN index. Filtered queries use hnsw.iterative_scan (pgvector >= 0.8) so the graph walk
-- continues until enough rows survive the RLS filter instead of returning a short top-k.
CREATE INDEX chunks_embedding_hnsw ON chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE INDEX chunks_tsv_gin          ON chunks USING gin (content_tsv);
CREATE INDEX chunks_roles_gin        ON chunks USING gin (allowed_roles);
CREATE INDEX chunks_tenant_class     ON chunks (tenant_id, classification);
CREATE INDEX chunks_document         ON chunks (document_id);
CREATE INDEX documents_tenant        ON documents (tenant_id, classification);
CREATE INDEX students_user           ON students (user_id);
CREATE INDEX students_department     ON students (tenant_id, department);
CREATE INDEX employees_department    ON employees (tenant_id, department);
CREATE INDEX fee_payments_student    ON fee_payments (student_id);
CREATE INDEX audit_log_tenant_time   ON audit_log (tenant_id, created_at DESC);
