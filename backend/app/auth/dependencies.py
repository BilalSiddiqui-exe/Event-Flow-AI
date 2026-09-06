import os
import tempfile
from pathlib import Path
import firebase_admin
from firebase_admin import auth, credentials
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.exceptions import DefaultCredentialsError

from app.config import get_settings

security = HTTPBearer()


def find_service_account_key() -> str | None:
    # 1. Environment variable if pointing to an existing file
    env_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if env_path and Path(env_path).is_file():
        return str(Path(env_path).resolve())

    # 1b. Inline credential JSON (for hosts without a metadata server,
    #     e.g. Render/Koyeb/Hugging Face Spaces: set SERVICE_ACCOUNT_JSON).
    inline = os.environ.get("SERVICE_ACCOUNT_JSON")
    if inline:
        try:
            import json as _json
            data = _json.loads(inline)
            if data.get("type") == "service_account":
                dst = os.path.join(tempfile.gettempdir(), "eventflow_service_account.json")
                Path(dst).write_text(_json.dumps(data), encoding="utf-8")
                os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = dst
                if data.get("project_id"):
                    os.environ.setdefault("GOOGLE_CLOUD_PROJECT", data["project_id"])
                return dst
        except Exception:
            pass

    # 2. Check settings
    settings = get_settings()
    if getattr(settings, "google_application_credentials", None):
        cfg_path = Path(settings.google_application_credentials)
        if cfg_path.is_file():
            resolved = str(cfg_path.resolve())
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = resolved
            return resolved

    backend_dir = Path(__file__).resolve().parent.parent.parent
    root_dir = backend_dir.parent

    # 3. Candidate files in backend, root, and cwd
    candidate_paths = [
        backend_dir / "serviceAccountKey.json",
        root_dir / "serviceAccountKey.json",
        Path.cwd() / "serviceAccountKey.json",
        *backend_dir.glob("*service*.json"),
        *root_dir.glob("*service*.json"),
        *backend_dir.glob("*.json"),
    ]

    ignored_names = {"requirements.txt", "package.json", "package-lock.json", "tsconfig.json", "firebase.json"}
    for candidate in candidate_paths:
        if candidate.is_file() and candidate.name not in ignored_names:
            try:
                import json
                data = json.loads(candidate.read_text(encoding="utf-8"))
                if data.get("type") == "service_account":
                    resolved = str(candidate.resolve())
                    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = resolved
                    if data.get("project_id"):
                        os.environ.setdefault("GOOGLE_CLOUD_PROJECT", data["project_id"])
                    return resolved
            except Exception:
                pass
    return None


def _initialize() -> None:
    settings = get_settings()
    key_path = find_service_account_key()
    project_id = settings.google_cloud_project
    if not project_id and key_path:
        try:
            import json
            data = json.loads(Path(key_path).read_text(encoding="utf-8"))
            project_id = data.get("project_id")
        except Exception:
            pass
    options = {"projectId": project_id} if project_id else None

    if firebase_admin._apps:
        default_app = firebase_admin.get_app()
        if key_path and getattr(default_app, "_custom_cert", False):
            return
        elif not key_path:
            return
        try:
            firebase_admin.delete_app(default_app)
        except Exception:
            pass

    if key_path:
        cred = credentials.Certificate(key_path)
        app = firebase_admin.initialize_app(cred, options)
        setattr(app, "_custom_cert", True)
    else:
        firebase_admin.initialize_app(credentials.ApplicationDefault(), options)



def current_user(token: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    try:
        _initialize()
        return auth.verify_id_token(token.credentials)
    except DefaultCredentialsError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google Cloud credentials not found on server. Please place 'serviceAccountKey.json' in backend/ directory."
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired authentication token: {exc}"
        ) from exc

