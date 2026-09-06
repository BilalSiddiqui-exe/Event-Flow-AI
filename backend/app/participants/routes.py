import csv
import io
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, File, UploadFile
from app.auth.dependencies import current_user
from app.events.routes import _owned
from app.firestore.client import db

router = APIRouter(prefix="/api/events/{event_id}/participants", tags=["participants"])
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@router.post("/import")
async def import_participants(event_id: str, file: UploadFile = File(...), user=Depends(current_user)):
    _owned(event_id, user["uid"])
    if not file.filename or not file.filename.lower().endswith(".csv"):
        return {"valid": [], "invalid": [{"row": 0, "message": "Upload a CSV file"}], "total": 0}
    rows = list(csv.DictReader(io.StringIO((await file.read()).decode("utf-8-sig"))))
    required = {"name", "email", "college", "registration_id"}
    if not rows or not required.issubset(rows[0].keys()):
        return {"valid": [], "invalid": [{"row": 1, "message": "Required columns: name,email,college,registration_id"}], "total": len(rows)}
    seen = set()
    valid, invalid = [], []
    for number, row in enumerate(rows, 2):
        email = row.get("email", "").strip().lower()
        messages = []
        if not row.get("name", "").strip(): messages.append("Name is required")
        if not EMAIL.match(email): messages.append("Invalid email")
        if email in seen: messages.append("Duplicate email")
        if not row.get("registration_id", "").strip(): messages.append("Registration ID is required")
        if messages: invalid.append({"row": number, "message": "; ".join(messages), "data": row})
        else:
            seen.add(email)
            valid.append({"name": row["name"].strip(), "email": email, "college": row.get("college", "").strip(), "registrationId": row["registration_id"].strip()})
    return {"valid": valid, "invalid": invalid, "total": len(rows)}


@router.post("/confirm")
def confirm_participants(event_id: str, participants: list[dict], user=Depends(current_user)):
    _owned(event_id, user["uid"])
    batch = db().batch()
    now = datetime.now(timezone.utc)
    for item in participants:
        ref = db().collection("events").document(event_id).collection("participants").document()
        batch.set(ref, item | {"id": ref.id, "createdAt": now, "attendance": True})
    batch.commit()
    return {"imported": len(participants)}


@router.get("")
def list_participants(event_id: str, user=Depends(current_user)):
    _owned(event_id, user["uid"])
    return [s.to_dict() for s in db().collection("events").document(event_id).collection("participants").stream()]
