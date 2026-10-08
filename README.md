# VaultRAG: Secure Multi-Modal RAG with Access Control

Code Carnival Hackathon, Atmiya University (PS-01).

VaultRAG answers natural-language questions over PDFs, images (OCR) and database records.
Its access control is enforced **inside Postgres, on the same query that runs the vector search**.
The application code cannot leak a document the caller isn't authorised to see, because the
database never returns it.

## Quick start

```bash
cp .env.example .env          # then replace every change-me value
docker compose up -d --build  # Postgres 16 + pgvector, API on :8000 (runs migrations)
docker compose exec api python -m app.cli seed
docker compose exec api pytest -q
```

API docs: http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxies /api → :8000)
npm run build      # static build in frontend/dist
```

If the backend is unreachable, the UI switches to **demo mode** and runs an in-browser copy of the
pipeline. Its permission check (`frontend/src/lib/engine.ts → aclAllows`) mirrors `acl_check()` in
the migrations, so the UI behaves the same with or without the backend.

| Page | What it shows |
|---|---|
| Ask | Chat with streamed answers, a pipeline trace, a citation chip on every sentence, and a source viewer (PDF region / OCR box / DB row) |
| Compare users | The same question for 3 identities side by side, plus a presenter X-ray of RLS-filtered counts |
| Knowledge base | Only the sources you may see, ingestion pipeline, and the admin ACL editor with instant revocation |
| Records | Live DB rows with no `WHERE` on the user; RLS decides; salary masked by view |
| Security | pytest results, red-team table, recall@k under RLS, and the audit log (own rows unless admin) |

### Demo accounts (password `Demo@123` for all)

| Email | Roles | Dept scope | Clearance |
|---|---|---|---|
| aarav.student@atmiya.test | student | CSE | 0 public |
| diya.student@atmiya.test | student | MECH | 0 |
| prof.mehta@atmiya.test | faculty | CSE | 1 internal |
| hod.cse@atmiya.test | faculty, hod | CSE | 2 confidential |
| hod.mech@atmiya.test | faculty, hod | MECH | 2 |
| finance@atmiya.test | finance | all | 2 |
| hr@atmiya.test | hr | all | 3 restricted |
| admin@atmiya.test | admin | all | 3 |

All people and records are synthetic.

## How authorisation works

```
JWT (verified) ──► UserCtx ──► BEGIN READ ONLY
                               set_config('app.ctx',     {uid,tid,roles,depts,clr,exp}, true)
                               set_config('app.ctx_sig', HMAC-SHA256(ctx, secret),      true)
                               SELECT … FROM chunks ORDER BY embedding <=> $q LIMIT k
                                        └── RLS policy: acl_check((SELECT app_ctx()), …)
                               COMMIT  (context gone with the transaction)
```

1. **Least-privilege DB roles.** Every user query runs as `rag_reader`. It is not a superuser,
   has `NOBYPASSRLS`, gets SELECT only, and has no grant on base `employees`, `users` or
   `app_secrets`. Ingestion uses `rag_writer`. Migrations use the owner.
2. **Signed context.** Any SQL running as `rag_reader` can call `set_config`, including
   LLM-generated SQL. So `app_ctx()` trusts the context only if its HMAC verifies against a
   key stored in a table `rag_reader` can't read. A forged, tampered or expired context becomes
   `NULL`, and every policy then fails closed.
3. **Row-Level Security** is enabled and forced on every table. Document and chunk rule:
   same tenant AND (explicitly granted user OR (clearance ≥ classification AND role allowed
   AND department in scope)).
4. **ACL inheritance.** Chunks carry a denormalised copy of their document's ACL, so the
   vector scan filters in one pass. A trigger overwrites whatever ACL the writer sends, and a
   document ACL change is pushed to its chunks immediately (instant revocation).
5. **Column masking.** Employees are read only through the `employees_secure` view
   (`security_barrier`). Salary is visible to HR, Finance, Admin and the employee themself;
   appraisal only to HR, Admin and the employee themself.
6. **Read-only, transaction-local sessions.** `SET TRANSACTION READ ONLY` plus
   `set_config(…, true)`. Nothing survives into the next request on a pooled connection.

## Threat model (what the tests prove)

| Attack | Defence | Test |
|---|---|---|
| App code forgets a WHERE clause | RLS filters inside Postgres | `test_same_endpoint_different_rows` |
| Forged/tampered context | HMAC check in `app_ctx()` | `test_tampered_context_sees_nothing` |
| SQL rewrites its own context mid-transaction | signature no longer matches | `test_in_query_escalation_is_blocked` |
| Replay of an old context | `exp` checked in DB | `test_expired_context_sees_nothing` |
| Context bleeding between pooled requests | transaction-local settings + `RESET ALL` | `test_context_does_not_bleed_across_pooled_connections` |
| Reading salary/appraisal columns | security-barrier view, no base-table grant | `test_employee_column_masking` |
| Writes/DDL via the query path | read-only transaction + no grants | `test_reader_role_privileges` |
| Cross-tenant access | tenant bound in signed context | `test_chunk_visibility_matrix[outsider_admin]` |
| Stale ACL after revocation | propagation trigger | `test_acl_revocation_is_immediate` |

## Layout

```
backend/
  migrations/   schema, roles, signed-context functions, RLS policies, indexes
  app/          FastAPI: config, db (secure_session), security (JWT, HMAC), api/*
  seed/         deterministic synthetic Atmiya dataset
  tests/        RLS matrix, attack tests, API end-to-end
```
