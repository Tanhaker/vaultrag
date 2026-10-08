from functools import lru_cache
from uuid import UUID

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    db_host: str = "localhost"
    db_port: int = 5433
    db_name: str = "vaultrag"
    db_owner_user: str = "vault"
    db_owner_password: str
    db_reader_password: str
    db_writer_password: str

    jwt_secret: str
    jwt_expire_minutes: int = 480
    ctx_hmac_secret: str
    ctx_ttl_seconds: int = 300

    demo_mode: bool = True
    tenant_id: UUID = UUID("a7a1e5c0-0000-4000-8000-000000000001")
    data_dir: str = "/data"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    llm_model: str = "gemini/gemini-2.5-flash"
    embedding_model: str = "gemini/gemini-embedding-001"
    embedding_dim: int = 768


@lru_cache
def get_settings() -> Settings:
    return Settings()
