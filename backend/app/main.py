from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .ai.embeddings import provider
from .api import auth, documents, query, records, source, xray
from .config import get_settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.open_pools()
    yield
    await db.close_pools()


app = FastAPI(title="VaultRAG", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
for r in (auth.router, records.router, xray.router, query.router, source.router, documents.router):
    app.include_router(r)


@app.get("/health")
async def health() -> dict:
    s = get_settings()
    return {"status": "ok", "llm": s.llm_model if s.llm_enabled else "off", "embeddings": provider(),
            "runtime": "serverless" if s.serverless else "server"}
