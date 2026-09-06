from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    google_application_credentials: str | None = None
    google_cloud_project: str | None = None
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-flash-latest"
    email_api_key: str | None = None
    email_from: str | None = None
    email_provider_url: str | None = None
    email_provider: str = "resend"
    frontend_origin: str = "http://localhost:5173"
    firebase_api_key: str | None = None
    firebase_auth_domain: str | None = None
    firebase_project_id: str | None = None
    firebase_storage_bucket: str | None = None
    firebase_messaging_sender_id: str | None = None
    firebase_app_id: str | None = None
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()


def firebase_web_config() -> dict[str, str]:
    settings = get_settings()
    return {
        "apiKey": settings.firebase_api_key or "",
        "authDomain": settings.firebase_auth_domain or "",
        "projectId": settings.firebase_project_id or settings.google_cloud_project or "",
        "storageBucket": settings.firebase_storage_bucket or "",
        "messagingSenderId": settings.firebase_messaging_sender_id or "",
        "appId": settings.firebase_app_id or "",
    }
