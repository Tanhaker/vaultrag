-- Original images, kept so the source viewer can draw the OCR region on the real picture.
-- A blob is readable exactly when its document is: the EXISTS runs under the documents policy.
CREATE TABLE document_blobs (
  document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL,
  mime        text NOT NULL,
  width       int,
  height      int,
  data        bytea NOT NULL
);

ALTER TABLE document_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_blobs FORCE ROW LEVEL SECURITY;

CREATE POLICY writer_all ON document_blobs FOR ALL TO rag_writer USING (true) WITH CHECK (true);
CREATE POLICY reader_select ON document_blobs FOR SELECT TO rag_reader
  USING (EXISTS (SELECT 1 FROM documents d WHERE d.id = document_blobs.document_id));

GRANT SELECT ON document_blobs TO rag_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_blobs TO rag_writer;

-- On managed Postgres (Neon, Supabase, RDS) the migration role owns the tables but is not a
-- superuser, so FORCE ROW LEVEL SECURITY applies to it. employees_secure runs with its owner's
-- rights; give the owner a read policy so the view can see rows and apply its own scoping.
CREATE POLICY view_owner_read ON employees FOR SELECT TO CURRENT_USER USING (true);
