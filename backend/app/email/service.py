import base64
import re
import httpx
from fastapi import HTTPException
from app.config import get_settings

BREVO_URL = "https://api.brevo.com/v3/smtp/email"
SENDER_RE = re.compile(r"^\s*(.*?)\s*<\s*([^<>]+@[^<>]+)\s*>\s*$")


class EmailDailyQuota(Exception):
    """Provider returned a daily sending-quota error; retry after the reset window."""


def _parse_sender(value: str | None):
    value = (value or "").strip()
    match = SENDER_RE.match(value)
    if match:
        return match.group(1).strip() or "EventFlow AI", match.group(2).strip()
    return "EventFlow AI", value


def _provider() -> str:
    provider = (get_settings().email_provider or "resend").strip().lower()
    return "brevo" if provider in {"brevo", "bravo"} else "resend"


async def _send_brevo(to: str, participant_name: str, event_name: str, pdf: bytes, filename: str) -> None:
    settings = get_settings()
    sender_name, sender_email = _parse_sender(settings.email_from)
    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"name": participant_name, "email": to}],
        "subject": f"Your Certificate - {event_name}",
        "textContent": f"Congratulations {participant_name}! Thank you for participating in {event_name}. Your certificate is attached.",
        "htmlContent": f"<p>Congratulations <strong>{participant_name}</strong>!</p><p>Thank you for participating in <strong>{event_name}</strong>.</p><p>Your certificate is attached to this email.</p>",
        "attachment": [{"name": filename, "content": base64.b64encode(pdf).decode("ascii")}],
    }
    headers = {"api-key": settings.email_api_key, "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(BREVO_URL, headers=headers, json=payload)
    if response.is_error:
        detail = ""
        try:
            detail = str(response.json())
        except Exception:
            detail = response.text[:200]
        if response.status_code == 429 or "daily_quota_exceeded" in detail or "quota" in detail.lower():
            raise EmailDailyQuota("Daily sending quota reached — resend after the reset.")
        raise HTTPException(502, f"Email provider rejected the certificate: {detail[:200]}")


async def send_certificate(to: str, participant_name: str, event_name: str, pdf: bytes, filename: str) -> None:
    settings = get_settings()
    if not settings.email_api_key or not settings.email_from:
        raise HTTPException(503, "Email is not configured. Set EMAIL_API_KEY, EMAIL_FROM, and EMAIL_PROVIDER in backend/.env")
    if _provider() == "brevo":
        return await _send_brevo(to, participant_name, event_name, pdf, filename)
    payload = {
        "from": settings.email_from,
        "to": to,
        "subject": f"Your Certificate - {event_name}",
        "text": f"Congratulations {participant_name}! Thank you for participating in {event_name}.",
        "attachments": [{"filename": filename, "content": base64.b64encode(pdf).decode("ascii")}],
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(settings.email_provider_url, headers={"Authorization": f"Bearer {settings.email_api_key}"}, json=payload)
    if response.is_error:
        raise HTTPException(502, "Email provider rejected the certificate")