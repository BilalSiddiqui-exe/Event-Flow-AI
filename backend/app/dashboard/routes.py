from fastapi import APIRouter, Depends
from app.auth.dependencies import current_user
from app.firestore.client import db

router = APIRouter(prefix="/api/summary", tags=["summary"])

SUBCOLLECTIONS = ("participants", "certificates", "quizzes")


def _count(ref):
    result = ref.count().get()
    return int(result[0][0].value)


@router.get("")
def summary(user=Depends(current_user)):
    events = list(db().collection("events").where("organizerId", "==", user["uid"]).stream())
    totals = {"events": len(events), "participants": 0, "certificates": 0, "quizzes": 0}
    for event in events:
        base = db().collection("events").document(event.id)
        for name in SUBCOLLECTIONS:
            totals[name] += _count(base.collection(name))
    return totals