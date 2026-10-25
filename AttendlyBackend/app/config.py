import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Attendly Mobile API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://lakshya@localhost:5432/attendly_mobile_db",
    )
    JWT_SECRET_KEY: str = os.getenv(
        "JWT_SECRET_KEY",
        "attendly-dev-secret-key-32-chars-long-abc123xyz!",
    )
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 60  # 60 days for mobile session

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
