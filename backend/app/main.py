from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .api import auth, records, xray
from .config import get_settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.open_pools()
    yield
    await db.close_pools()


app = FastAPI(title="VaultRAG", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth.router)
app.include_router(records.router)
app.include_router(xray.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
