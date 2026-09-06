# EventFlow AI

EventFlow AI is a Firebase-authenticated event operations platform for campus organizers. It imports participants, generates certificate PDFs, tracks delivery, and supports Gemini-powered quizzes and analytics.

## Architecture

The application is a Python-only FastAPI/Jinja2/HTML/CSS/vanilla JavaScript service. Firebase Authentication provides organizer identity; the backend verifies ID tokens and owns Firestore/Cloud Storage access. Gemini and the transactional email provider are server-side only.

## Local setup

1. Follow [SETUP.md](SETUP.md).
2. Copy `backend/.env.example` to `backend/.env` and set the Firebase public web configuration, `GOOGLE_CLOUD_PROJECT`, and server secrets. Use Application Default Credentials locally.
3. Install and run:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

The server serves the UI and API at `http://localhost:8000`; `/docs` contains the API documentation.

## Demo flow

Sign in, create an event, import a CSV with `name,email,college,registration_id`, upload/configure a certificate template, preview and generate certificates, then create and publish a quiz. Public quizzes are available at `/quiz/{quizId}`.

## Deployment

The root `Dockerfile` runs the Python service directly. Deploy the image to Cloud Run with a service account allowed to use Firestore and Cloud Storage. Set `PORT` through Cloud Run; the application honors it automatically.

Never commit `.env`, service-account JSON, or API keys.
