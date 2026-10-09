"""Vercel entrypoint: the FastAPI app from backend/, served under /api.

On Vercel the function opens one database connection per request through Neon's pooler
(see app/db.py); the RLS context is transaction-local, so it is safe behind PgBouncer."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from fastapi import FastAPI  # noqa: E402

from app.main import app as core  # noqa: E402

app = FastAPI(title="VaultRAG", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api", core)
