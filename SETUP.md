# EventFlow AI setup

The application is Python-only. It does not require npm, Node.js, Vite, or a frontend build step.

## 1. Google Cloud and Firebase

1. Create or select a Google Cloud project and enable Firestore, Cloud Storage, Cloud Run, and the Generative Language API.
2. Create a Firebase project for the same Google Cloud project.
3. In Firebase Authentication, enable Google sign-in and add the local/Cloud Run domains to authorized domains.
4. Create a Firestore database in production mode.
5. Create a Cloud Storage bucket. Grant the Cloud Run service account object read/write access to this bucket.
6. Deploy [firestore.rules](firestore.rules). The backend uses Admin SDK, so application authorization remains enforced by verified Firebase tokens and ownership checks.

## 2. Local Google credentials

Install the Google Cloud CLI, then run:

```powershell
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud auth application-default login
```

Do not create or commit a service-account JSON file.

## 3. Environment

Copy `backend/.env.example` to `backend/.env`. Set the Firebase web configuration values from Firebase Console and set `GOOGLE_CLOUD_PROJECT`. Set `GEMINI_API_KEY` for AI quiz generation. `EMAIL_API_KEY`, `EMAIL_FROM`, and `EMAIL_PROVIDER_URL` are required only when email delivery is enabled.

The `frontend/.env.example` file documents the original Firebase `VITE_*` names for migration compatibility. Jinja does not read those names; the running server reads `FIREBASE_*` values from `backend/.env` and safely injects only public Firebase web configuration into the page. Backend and email/Gemini secrets are never injected.

## 4. Local startup

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

Open `http://localhost:8000`. The browser loads Firebase’s official browser modules from `gstatic.com`; no npm tool is involved.

## 5. Cloud Run

Build and deploy from the repository root:

```powershell
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/eventflow-ai
gcloud run deploy eventflow-ai --image gcr.io/YOUR_PROJECT_ID/eventflow-ai --region REGION --allow-unauthenticated
```

Set backend environment variables with `--set-env-vars` or Secret Manager references. Attach a dedicated Cloud Run service account with Firestore access and the bucket object permissions it needs. Cloud Run supplies `PORT`; the container honors it.

## 6. Product workflow

Sign in with Google, create an event, validate and confirm a CSV import, save a PNG/JPG template and field-position JSON, preview and generate certificates, then generate/review/publish a Gemini quiz. Published quiz links submit answers to the backend, which calculates scores and stores response analytics.
