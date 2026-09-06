from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from app.auth.dependencies import current_user
from app.firestore.client import db
from app.firestore.delete import hard_delete
from app.utils.errors import forbidden, not_found

router = APIRouter(prefix="/api/events", tags=["events"])


class EventInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    date: str
    location: str = ""
    organizer_name: str = ""
    status: str = "draft"


def _owned(event_id: str, uid: str):
    snap = db().collection("events").document(event_id).get()
    if not snap.exists:
        raise not_found("Event not found")
    event = snap.to_dict()
    if event.get("organizerId") != uid:
        raise forbidden()
    return event


@router.post("")
def create_event(payload: EventInput, user=Depends(current_user)):
    now = datetime.now(timezone.utc)
    ref = db().collection("events").document()
    data = payload.model_dump(by_alias=False) | {"id": ref.id, "organizerId": user["uid"], "createdAt": now, "updatedAt": now}
    ref.set(data)
    return data


@router.get("")
def list_events(user=Depends(current_user)):
    return [snap.to_dict() for snap in db().collection("events").where("organizerId", "==", user["uid"]).stream()]


@router.get("/{event_id}")
def get_event(event_id: str, user=Depends(current_user)):
    return _owned(event_id, user["uid"])


@router.put("/{event_id}")
def update_event(event_id: str, payload: EventInput, user=Depends(current_user)):
    _owned(event_id, user["uid"])
    data = payload.model_dump() | {"updatedAt": datetime.now(timezone.utc)}
    db().collection("events").document(event_id).update(data)
    return get_event(event_id, user)


@router.delete("/{event_id}")
def delete_event(event_id: str, user=Depends(current_user)):
    _owned(event_id, user["uid"])
    hard_delete(db().collection("events").document(event_id))
    return {"ok": True}
