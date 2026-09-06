from functools import lru_cache
import os
from google.cloud import firestore, storage
from google.oauth2 import service_account
from app.config import get_settings
from app.auth.dependencies import find_service_account_key


def _get_credentials():
    key_path = find_service_account_key()
    if key_path and os.path.isfile(key_path):
        try:
            return service_account.Credentials.from_service_account_file(key_path)
        except Exception:
            pass
    return None


@lru_cache
def db() -> firestore.Client:
    creds = _get_credentials()
    project = get_settings().google_cloud_project or (creds.project_id if creds else None)
    if creds:
        return firestore.Client(project=project, credentials=creds)
    return firestore.Client(project=project)


@lru_cache
def bucket():
    creds = _get_credentials()
    project = get_settings().google_cloud_project or (creds.project_id if creds else None)
    if creds:
        client = storage.Client(project=project, credentials=creds)
    else:
        client = storage.Client(project=project)
    bucket_name = get_settings().firebase_storage_bucket or client.project
    return client.bucket(bucket_name)

