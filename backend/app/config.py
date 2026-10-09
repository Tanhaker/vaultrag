from functools import lru_cache
from uuid import UUID

from psycopg.conninfo import conninfo_to_dict
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Either a full owner URL (managed Postgres such as Neon) or discrete host settings (Docker).
    database_url: str | None = None
    db_host: str = "localhost"
    db_port: int = 5433
    db_name: str = "vaultrag"
    db_sslmode: str = "prefer"
    db_owner_user: str = "vault"
    db_owner_password: str = ""
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
    max_upload_mb: int = 8

    # AI. Provider "auto" uses Gemini when a key is present and falls back to local/extractive paths.
    gemini_api_key: str = ""
    llm_model: str = "gemini-3.5-flash-lite"
    # Tried in order when the previous model is rate limited or unavailable (quotas are per model).
    llm_fallback_models: str = "gemini-3.1-flash-lite,gemini-3.5-flash,gemini-3-flash-preview,gemini-2.5-flash"
    embedding_model: str = "gemini-embedding-001"
    embedding_provider: str = "auto"  # auto | gemini | hash
    embedding_dim: int = 768
    # How long ingestion may wait out embedding rate limits (uploads stay inside the 60 s function cap;
    # the CLI raises it for bulk re-ingestion).
    embed_wait_seconds: float = 30.0
    llm_mode: str = "auto"  # auto | off

    # Vercel sets VERCEL=1; serverless functions open a connection per request instead of pooling.
    vercel: str | None = None

    @field_validator("llm_model", "embedding_model")
    @classmethod
    def _bare_model_name(cls, v: str) -> str:
        # Accept LiteLLM-style "gemini/<model>" names; the REST API wants just "<model>".
        return v.removeprefix("gemini/").removeprefix("models/")

    @property
    def serverless(self) -> bool:
        return bool(self.vercel)

    def db_params(self) -> dict:
        if self.database_url:
            d = conninfo_to_dict(self.database_url.replace("postgres://", "postgresql://", 1))
            return {"host": d.get("host"), "port": int(d.get("port") or 5432), "dbname": d.get("dbname"),
                    "sslmode": d.get("sslmode", "require")}
        return {"host": self.db_host, "port": self.db_port, "dbname": self.db_name, "sslmode": self.db_sslmode}

    def owner_credentials(self) -> tuple[str, str]:
        if self.database_url:
            d = conninfo_to_dict(self.database_url.replace("postgres://", "postgresql://", 1))
            return d["user"], d.get("password", "")
        return self.db_owner_user, self.db_owner_password

    @property
    def llm_enabled(self) -> bool:
        return self.llm_mode != "off" and bool(self.gemini_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
