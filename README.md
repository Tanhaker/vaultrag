# VaultRAG: Secure Multi-Modal RAG with Access Control

Code Carnival 2026, Atmiya University · PS-01 · Team **FriendlyFire** (TXJ8): Bhakti Kareliya (team leader), Tanmay Gajjar.

**Live demo:** https://vaultrag-nine.vercel.app (fictional data; demo accounts below)

VaultRAG answers natural-language questions over PDFs, scanned pages, photographed notices and
database records. Access control is enforced **inside Postgres, on the same statement that runs the
vector search**, so application code cannot leak a document the caller isn't cleared for: the
database never returns it. Every sentence of every answer is cited to an exact page region, image
region, table row or live SQL result, and a verifier removes sentences the sources don't support.

## Quick start (local)

```bash
cp .env.example .env                     # replace every change-me value; add GEMINI_API_KEY for LLM mode
docker compose up -d --build             # Postgres 16 + pgvector 0.8, FastAPI on :8000 (runs migrations)
docker compose exec api python -m app.cli seed          # synthetic students, staff, fees, demo users
docker compose exec api python -m app.cli ingest-demo   # generate + ingest PDFs, scans, photos, record cards
docker compose exec api pytest -q                       # RLS matrix, attacks, red-team suite, units
cd frontend && npm install && npm run dev               # http://localhost:5173 (proxies /api → :8000)
```

Without a Gemini key the pipeline still runs end to end: deterministic hash embeddings, Tesseract
OCR and an extractive answer composer. With a key it uses `gemini-embedding-001` (768-d), Gemini
generation with JSON-schema citations, an LLM entailment verifier and Gemini vision OCR.

Generation walks a model chain (`LLM_MODEL`, then `LLM_FALLBACK_MODELS`, default
`gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-3.5-flash` → …). Free-tier quotas are per
model, so a 429 parks that model until Google's `retryDelay` and the next one answers. When every
model is out of quota the extractive composer takes over behind a stricter relevance gate
(calibrated with `python -m bench.relevance_probe`), so the answer degrades but never leaks.

### Demo accounts (password `Demo@123` for all, fictional data)

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

## Pipeline

```
upload ─► sha256 dedupe ─► PDF text blocks + ruled tables (PyMuPDF, pdfplumber)
                         └► scans / photos: Gemini vision or Tesseract OCR (+ caption)
        ─► heading-aware chunks with page + bbox ─► injection scan ─► embeddings ─► Postgres
           (each chunk inherits its document's ACL through a trigger)

question ─► JWT ─► read-only rag_reader txn + HMAC-signed context
          ├─ aggregate? ─► Text-to-SQL ─► sqlglot validation (one SELECT, whitelisted relations
          │                and functions) ─► run under RLS + masking view ─► cited summary
          └─ HNSW (iterative scan) + BM25, both under RLS ─► RRF ─► feature rerank
             ─► quarantine injected chunks ─► Gemini answer (JSON, cited) or extractive
             ─► verifier: citation validity + figures-in-source + LLM entailment
             ─► uniform refusal if nothing survives ─► audit log (RLS) ─► ACL-scoped cache
```

| Page | What it shows |
|---|---|
| Ask | Chat with the live pipeline trace, a citation on every sentence, and the source viewer (PDF region, real photo with OCR box, DB row, live SQL result) |
| Compare | One question as three identities side by side, plus a presenter X-ray of how many candidates RLS dropped |
| Knowledge base | Only the sources you may see, real upload + ingestion, record-card groups, admin ACL editor with instant revocation |
| Records | Live rows with no `WHERE` on the user; RLS decides; salary masked by the view |
| Security | pytest + red-team results, recall@k benchmark, and the audit log (own rows unless admin) |

If the backend is unreachable the UI switches to **demo mode** and runs an in-browser copy of the
pipeline whose permission check mirrors `acl_check()` in the migrations.

## How authorisation works

```
JWT (verified) ──► UserCtx ──► BEGIN READ ONLY
                               set_config('app.ctx',     {uid,tid,roles,depts,clr,exp}, true)
                               set_config('app.ctx_sig', HMAC-SHA256(ctx, secret),      true)
                               SELECT … FROM chunks ORDER BY embedding <=> $q LIMIT k
                                        └── RLS policy: acl_check((SELECT app_ctx()), …)
                               COMMIT  (context gone with the transaction)
```

1. **Least-privilege roles.** User queries run as `rag_reader`: `NOBYPASSRLS`, SELECT only, no grant
   on base `employees`, `users` or `app_secrets`. Ingestion and admin ACL changes use `rag_writer`.
2. **Signed context.** SQL running as `rag_reader` can call `set_config` (including LLM-written SQL),
   so `app_ctx()` trusts the context only if its HMAC verifies against a key the reader cannot read.
   Forged, tampered or expired contexts become `NULL` and every policy fails closed.
3. **RLS on every table**, forced. Documents and chunks: same tenant AND (explicit user grant OR
   (clearance ≥ classification AND role allowed AND department in scope)). Students, fees, audit log
   and image blobs have their own policies.
4. **ACL inheritance and instant revocation** through triggers on `chunks` and `documents`.
5. **Column masking** through the `employees_secure` security-barrier view.
6. **Transaction-local, read-only sessions**: safe behind Neon's PgBouncer in transaction mode.

## Measured (backend/eval/results, backend/bench/results)

| | Result |
|---|---|
| pytest | 100 passed: RLS matrix, forged/expired/escalated contexts, pooling, privileges, units |
| Red-team suite (end-to-end through the API) | 13/13 attacks blocked, 0 canaries leaked |
| Recall@10, public-only user, 10k vectors | 5% post-filter in app code · 17% RLS strict scan · **87% RLS + iterative scan** |
| p95 RLS-filtered HNSW query | 16 ms |

## Deployment (Vercel + Neon)

`vercel.json` builds the frontend to static files and serves `api/index.py` (FastAPI, mounted at
`/api`) as a Python function. The database is Neon Postgres with pgvector; the function connects
per request through Neon's pooler. Migrations, seeding and ingestion run from a workstation with
`DATABASE_URL` pointing at Neon's direct (unpooled) endpoint. `.env.neon` (gitignored) holds that owner URL
plus the same secrets the Vercel project has:

```bash
docker exec --env-file .env.neon vaultrag-api-1 python -m app.cli migrate
docker exec --env-file .env.neon vaultrag-api-1 python -m app.cli seed
docker exec -e EMBED_WAIT_SECONDS=900 --env-file .env.neon vaultrag-api-1 python -m app.cli ingest-demo
docker exec --env-file .env.neon vaultrag-api-1 python -m bench.live_check https://vaultrag-nine.vercel.app
```

Vercel needs `DATABASE_URL` (added by the Neon integration), `DB_READER_PASSWORD`,
`DB_WRITER_PASSWORD`, `JWT_SECRET`, `CTX_HMAC_SECRET` (the same values the migration used, since
`app_ctx()` verifies the HMAC with the key stored in Postgres), `GEMINI_API_KEY`, `DEMO_MODE` and
`MAX_UPLOAD_MB=4` (function request bodies are capped at 4.5 MB).

Managed-Postgres notes:
- Neon's owner role (`neondb_owner`) is not a superuser but has `BYPASSRLS`. Requests never use it:
  every query runs as `rag_reader`/`rag_writer`, which have neither. The `employees_secure` view
  does its own row scoping and column masking, so it is correct whoever owns it.
- Serverless instances share no memory, so the answer cache is keyed on a per-tenant
  knowledge-base version that a trigger bumps on every document change (`007_kb_version.sql`).
  Revoking access takes effect on the next request on every instance (red-team attack 13).

## Layout

```
api/index.py     Vercel entrypoint
backend/
  migrations/    schema, roles, signed-context functions, RLS policies, indexes, blobs
  app/ai/        Gemini client, embeddings (Gemini or offline hash), prompts
  app/ingest/    PDF, OCR, chunker, record cards, pipeline
  app/rag/       hybrid retrieval, Text-to-SQL, verifier, orchestration
  app/api/       auth, query, source, documents, ingest, ACL, audit, eval, records, xray
  seed/          synthetic dataset and demo document generator (fonts: OFL)
  tests/         RLS matrix, attacks, red-team suite, units
  bench/         filtered-ANN recall benchmark
frontend/        React 19 + TypeScript + Vite + Tailwind 4
```
