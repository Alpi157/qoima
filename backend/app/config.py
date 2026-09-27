from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo root .env, shared with docker-compose.yml. Resolves regardless of cwd.
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    database_url: str
    test_database_url: str | None = None
    cookie_secure: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
