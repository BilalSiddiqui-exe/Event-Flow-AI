from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from app.auth.dependencies import current_user
from app.events.routes import _owned
from app.firestore.client import db
from app.firestore.delete import hard_delete
from app.gemini.service import generate_quiz

router = APIRouter(prefix="/api", tags=["quizzes"])


class QuizInput(BaseModel):
    title: str
    description: str = ""
    topic: str
    difficulty: str = "intermediate"
    duration: int = Field(ge=1, le=180)
    questions: list[dict] = []


class GenerateInput(BaseModel):
    topic: str
    question_count: int = Field(ge=1, le=50)
    difficulty: str = "intermediate"
    audience: str = "college students"


@router.post("/events/{event_id}/quizzes/generate")
async def generate(event_id: str, payload: GenerateInput, user=Depends(current_user)):
    _owned(event_id, user["uid"])
    return await generate_quiz(payload.topic, payload.question_count, payload.difficulty, payload.audience)


@router.post("/events/{event_id}/quizzes")
def create_quiz(event_id: str, payload: QuizInput, user=Depends(current_user)):
    _owned(event_id, user["uid"])
    ref = db().collection("events").document(event_id).collection("quizzes").document()
    data = payload.model_dump() | {"id": ref.id, "eventId": event_id, "status": "draft", "createdAt": datetime.now(timezone.utc)}
    ref.set(data)
    return data


@router.get("/events/{event_id}/quizzes")
def list_quizzes(event_id: str, user=Depends(current_user)):
    _owned(event_id, user["uid"])
    return [s.to_dict() for s in db().collection("events").document(event_id).collection("quizzes").stream()]


@router.get("/quizzes/{quiz_id}")
def public_quiz(quiz_id: str):
    for event in db().collection("events").stream():
        snap = event.reference.collection("quizzes").document(quiz_id).get()
        if snap.exists and snap.to_dict().get("status") == "published":
            data = snap.to_dict()
            data["questions"] = [{k: v for k, v in question.items() if k != "correctAnswer"} for question in data.get("questions", [])]
            data["startedAt"] = datetime.now(timezone.utc)
            return data
    raise HTTPException(404, "Quiz not found")


@router.post("/quizzes/{quiz_id}/publish")
def publish_quiz(quiz_id: str, user=Depends(current_user)):
    for event in db().collection("events").where("organizerId", "==", user["uid"]).stream():
        ref = event.reference.collection("quizzes").document(quiz_id)
        snap = ref.get()
        if snap.exists:
            questions = snap.to_dict().get("questions", [])
            if not questions: raise HTTPException(400, "Add at least one question before publishing")
            ref.update({"status": "published"})
            return {"published": True}
    raise HTTPException(404, "Quiz not found")


@router.delete("/quizzes/{quiz_id}")
def delete_quiz(quiz_id: str, user=Depends(current_user)):
    for event in db().collection("events").where("organizerId", "==", user["uid"]).stream():
        ref = event.reference.collection("quizzes").document(quiz_id)
        if ref.get().exists:
            hard_delete(ref)
            return {"ok": True}
    raise HTTPException(404, "Quiz not found")


@router.post("/quizzes/{quiz_id}/submit")
def submit_quiz(quiz_id: str, payload: dict):
    for event in db().collection("events").stream():
        snap = event.reference.collection("quizzes").document(quiz_id).get()
        if snap.exists:
            quiz = snap.to_dict()
            if quiz.get("status") != "published":
                raise HTTPException(403, "Quiz is not published")
            questions = quiz.get("questions", [])
            duration = quiz.get("duration", 0)
            started_at = payload.get("startedAt")
            if duration and started_at:
                try:
                    started = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
                    if started.tzinfo is None:
                        started = started.replace(tzinfo=timezone.utc)
                    if (datetime.now(timezone.utc) - started).total_seconds() > duration * 60 + 10:
                        raise HTTPException(410, "Time limit exceeded. This submission arrived after the quiz ended.")
                except ValueError:
                    pass
            answers = payload.get("answers", [])
            score = sum(1 for i, q in enumerate(questions) if i < len(answers) and answers[i] == q.get("correctAnswer"))
            response_ref = event.reference.collection("quizzes").document(quiz_id).collection("responses").document()
            response_ref.set({"id": response_ref.id, "quizId": quiz_id, "participantName": payload.get("participantName", ""), "participantEmail": payload.get("participantEmail", ""), "answers": answers, "score": score, "submittedAt": datetime.now(timezone.utc)})
            return {"score": score, "total": len(questions), "percentage": round(score / len(questions) * 100) if questions else 0}
    raise HTTPException(404, "Quiz not found")


@router.get("/quizzes/{quiz_id}/analytics")
def quiz_analytics(quiz_id: str, user=Depends(current_user)):
    for event in db().collection("events").where("organizerId", "==", user["uid"]).stream():
        quiz_ref = event.reference.collection("quizzes").document(quiz_id)
        snap = quiz_ref.get()
        if snap.exists:
            total_questions = len((snap.to_dict() or {}).get("questions", []))
            responses = [item.to_dict() for item in quiz_ref.collection("responses").stream()]
            scores = [item.get("score", 0) for item in responses]
            ordered = sorted(responses, key=lambda r: r.get("score", 0), reverse=True)
            leaderboard = []
            previous = None
            for position, response in enumerate(ordered, 1):
                score = response.get("score", 0)
                rank = position if score != previous else last_rank
                leaderboard.append({
                    "rank": rank,
                    "name": response.get("participantName", ""),
                    "email": response.get("participantEmail", ""),
                    "score": score,
                    "total": total_questions,
                    "percentage": round(score / total_questions * 100) if total_questions else 0,
                })
                previous = score
                last_rank = rank
            return {
                "responseCount": len(scores),
                "averageScore": round(sum(scores) / len(scores), 2) if scores else 0,
                "highestScore": max(scores, default=0),
                "lowestScore": min(scores, default=0),
                "totalQuestions": total_questions,
                "leaderboard": leaderboard,
            }
    raise HTTPException(404, "Quiz not found")
