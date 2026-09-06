import asyncio
import json
import httpx
from fastapi import HTTPException
from app.config import get_settings

FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest", "gemini-3.8-flash"]
MAX_ATTEMPTS = 4
BASE_DELAY = 2.0
RETRYABLE_CODES = {404, 429, 500, 503}


class _Retryable(Exception):
    pass


def _model_list(settings) -> list[str]:
    primary = settings.gemini_model
    return [primary, *[m for m in FALLBACK_MODELS if m != primary]]


async def _generate_text(settings, model: str, prompt: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseMimeType": "application/json"}}
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(url, params={"key": settings.gemini_api_key}, json=payload)
    if response.status_code in RETRYABLE_CODES:
        raise _Retryable(f"Gemini model {model} busy ({response.status_code})")
    if response.is_error:
        raise ValueError(f"Gemini returned {response.status_code}: {response.text[:200]}")
    try:
        return response.json()["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("Gemini returned an unexpected response shape") from exc


def validate_questions(data: dict, expected: int) -> dict:
    questions = data.get("questions")
    if not isinstance(questions, list) or len(questions) != expected:
        raise HTTPException(502, "Gemini returned an unexpected question count")
    seen = set()
    for item in questions:
        options = item.get("options")
        question = item.get("question", "").strip()
        answer = item.get("correctAnswer")
        if not question or question in seen or not isinstance(options, list) or len(options) != 4 or any(not str(x).strip() for x in options) or not isinstance(answer, int) or not 0 <= answer < 4:
            raise HTTPException(502, "Gemini returned invalid quiz content")
        seen.add(question)
    return data


async def generate_quiz(topic: str, count: int, difficulty: str, audience: str) -> dict:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise HTTPException(503, "Gemini is not configured. Set GEMINI_API_KEY in backend/.env")
    prompt = f"""Return only JSON with a questions array. Create exactly {count} multiple-choice questions about {topic} for {audience}, at {difficulty} difficulty. Each item must have question, exactly four options, correctAnswer as a zero-based integer, explanation, and difficulty."""
    models = _model_list(settings)
    for attempt in range(MAX_ATTEMPTS):
        for model in models:
            try:
                text = await _generate_text(settings, model, prompt)
                return validate_questions(json.loads(text), count)
            except _Retryable:
                continue
            except ValueError as exc:
                raise HTTPException(502, f"Gemini is temporarily unavailable: {exc}") from exc
        await asyncio.sleep(BASE_DELAY * (2 ** attempt))
    raise HTTPException(502, "Gemini is temporarily unavailable after multiple retries. Please try again later.")
