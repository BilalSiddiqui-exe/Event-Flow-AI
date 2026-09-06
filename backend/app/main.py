import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.templating import Jinja2Templates
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from app.config import firebase_web_config, get_settings
from app.auth.dependencies import find_service_account_key, _initialize
from app.firestore.client import db
from app.events.routes import router as events_router
from app.participants.routes import router as participants_router
from app.certificates.routes import router as certificates_router
from app.quizzes.routes import router as quizzes_router
from app.dashboard.routes import router as dashboard_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    key = find_service_account_key()
    if key:
        print(f"[EventFlow] Loaded Google Cloud credentials from: {key}")
        try:
            _initialize()
            db()
            print("[EventFlow] Firebase Admin & Firestore initialized successfully.")
        except Exception as err:
            print(f"[EventFlow] Warning initializing Firebase Admin / Firestore: {err}")
    else:
        print("[EventFlow] WARNING: No service account key found! Google Cloud services may fail.")
    yield


app = FastAPI(title="EventFlow AI API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[get_settings().frontend_origin], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(events_router)
app.include_router(participants_router)
app.include_router(certificates_router)
app.include_router(quizzes_router)
app.include_router(dashboard_router)
APP_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(APP_DIR / "templates"))


@app.get("/health")
def health():
    return {"status": "ok"}


app.mount("/static", StaticFiles(directory=str(APP_DIR / "static")), name="static")


@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/")
def home(request: Request):
    return templates.TemplateResponse("app.html", {"request": request, "firebase_config": firebase_web_config(), "public_quiz_id": None})


@app.get("/quiz/{quiz_id}")
def public_quiz_page(request: Request, quiz_id: str):
    return templates.TemplateResponse("app.html", {"request": request, "firebase_config": firebase_web_config(), "public_quiz_id": quiz_id})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
