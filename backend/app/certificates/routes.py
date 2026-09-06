import io
import json
import base64
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from app.auth.dependencies import current_user
from app.events.routes import _owned
from app.firestore.client import db, bucket
from app.email.service import send_certificate, EmailDailyQuota

router = APIRouter(prefix="/api/events/{event_id}/certificates", tags=["certificates"])

MAX_INLINE_BYTES = 900_000
EMAIL_BATCH_SIZE = 50
EMAIL_BATCH_PAUSE_SECONDS = 1.0

STANDARD_FONTS = {
    "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
    "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
    "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
    "Symbol", "ZapfDingbats",
}
DEFAULT_NAME_FONT = "Helvetica-Bold"


class TemplateInput(BaseModel):
    fields: dict[str, dict] = {}


def _template_reader(template: dict | None):
    if not template:
        return None
    if template.get("path"):
        try:
            return ImageReader(io.BytesIO(bucket().blob(template["path"]).download_as_bytes()))
        except Exception:
            return None
    if template.get("image"):
        return ImageReader(io.BytesIO(template["image"]))
    return None


def _fit_image(content: bytes, max_bytes: int = MAX_INLINE_BYTES) -> bytes | None:
    if len(content) <= max_bytes:
        return content
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(content))
        if img.mode != "RGB":
            img = img.convert("RGB")
        for scale in (0.75, 0.5, 0.35):
            resized = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
            for quality in (85, 70, 55, 40):
                buffer = io.BytesIO()
                resized.save(buffer, format="JPEG", quality=quality)
                if buffer.tell() <= max_bytes:
                    return buffer.getvalue()
        return None
    except Exception:
        return None


def _certificate_bytes(event_id: str, data: dict) -> bytes:
    if data.get("store") == "firestore":
        doc = db().collection("events").document(event_id).collection("certificates").document(data["participantId"]).collection("blob").document("data").get()
        return doc.to_dict()["content"]
    return bucket().blob(data["filePath"]).download_as_bytes()


def _name_config(template: dict | None) -> dict:
    config = {"font": DEFAULT_NAME_FONT, "size": 28, "x": 421, "y": 390}
    if template:
        fields = template.get("fields") or {}
        if isinstance(fields, str):
            try:
                fields = json.loads(fields)
            except json.JSONDecodeError:
                fields = {}
        name = (fields or {}).get("name") or {}
        font = str(name.get("font") or DEFAULT_NAME_FONT)
        config["font"] = font if font in STANDARD_FONTS else DEFAULT_NAME_FONT
        config["size"] = max(10, min(120, float(name.get("size") or 28)))
        config["x"] = max(0, min(842, float(name.get("x") or 421)))
        config["y"] = max(20, min(575, float(name.get("y") or 390)))
    return config


def _pdf(event: dict, participant: dict, template: dict | None = None, certificate_id: str | None = None) -> bytes:
    output = io.BytesIO()
    pdf = canvas.Canvas(output, pagesize=(842, 595))
    name = (participant.get("name") or "").strip()
    reader = _template_reader(template)
    if reader:
        pdf.drawImage(reader, 0, 0, width=842, height=595, preserveAspectRatio=True, mask="auto")
        config = _name_config(template)
        size = config["size"]
        pdf.setFont(config["font"], size)
        while size >= 12 and pdf.stringWidth(name, config["font"], size) > 720:
            size -= 1
            pdf.setFont(config["font"], size)
        pdf.drawCentredString(config["x"], config["y"], name)
    else:
        pdf.setFont("Helvetica-Bold", 28)
        pdf.drawCentredString(421, 470, "CERTIFICATE OF PARTICIPATION")
        pdf.setFont("Helvetica", 18)
        pdf.drawCentredString(421, 360, f"This certifies that {name}")
        pdf.drawCentredString(421, 320, f"participated in {event.get('name', '')}")
        pdf.drawCentredString(421, 280, f"on {event.get('date', '')}")
        pdf.drawCentredString(421, 70, certificate_id or "Preview")
    pdf.save()
    return output.getvalue()


@router.post("/template")
async def save_template(event_id: str, file: UploadFile | None = File(None), fields: str = Form("{}"), user=Depends(current_user)):
    _owned(event_id, user["uid"])
    try:
        fields_data = json.loads(fields.strip() or "{}")
    except json.JSONDecodeError:
        fields_data = {}
    ref = db().collection("events").document(event_id).collection("settings").document("certificate")
    current = ref.get().to_dict() or {}
    data = {"fields": fields_data, "updatedAt": datetime.now(timezone.utc)}
    if file:
        if file.content_type not in {"image/png", "image/jpeg"}:
            raise HTTPException(400, "Template must be a PNG/JPG image")
        content = await file.read()
        if len(content) > 5_000_000:
            raise HTTPException(400, "Template must be smaller than 5 MB")
        data["contentType"] = file.content_type
        data["filename"] = file.filename
        path = f"templates/{event_id}/{file.filename}"
        try:
            bucket().blob(path).upload_from_string(content, content_type=file.content_type)
            data["store"] = "storage"
            data["path"] = path
            data.pop("image", None)
        except Exception:
            fitted = _fit_image(content)
            if fitted is None:
                raise HTTPException(400, "Cloud Storage unavailable and this image is too large to store inline (max ~900 KB). Enable Cloud Storage or use a smaller image.")
            data["store"] = "firestore"
            data["path"] = None
            data["image"] = fitted
    else:
        for key in ("store", "path", "image", "contentType", "filename"):
            if current.get(key) is not None:
                data[key] = current[key]
    ref.set(data)
    return {"filename": data.get("filename"), "store": data.get("store", "none"), "fields": fields_data}


@router.get("/template")
def get_template(event_id: str, user=Depends(current_user)):
    _owned(event_id, user["uid"])
    data = db().collection("events").document(event_id).collection("settings").document("certificate").get().to_dict() or {}
    if not data.get("filename"):
        return {"exists": False}
    fields = data.get("fields") or {}
    if isinstance(fields, str):
        try:
            fields = json.loads(fields)
        except json.JSONDecodeError:
            fields = {}
    try:
        if data.get("store") == "firestore" or data.get("image"):
            image = data["image"]
        elif data.get("path"):
            image = bucket().blob(data["path"]).download_as_bytes()
        else:
            return {"exists": False}
    except Exception:
        return {"exists": False}
    return {
        "exists": True,
        "filename": data.get("filename"),
        "store": data.get("store", "none"),
        "contentType": data.get("contentType", "image/png"),
        "fields": fields,
        "imageBase64": base64.b64encode(image).decode("ascii"),
    }


@router.post("/preview")
def preview(event_id: str, participant: dict, user=Depends(current_user)):
    event = _owned(event_id, user["uid"])
    template = db().collection("events").document(event_id).collection("settings").document("certificate").get().to_dict()
    return StreamingResponse(io.BytesIO(_pdf(event, participant, template)), media_type="application/pdf", headers={"Content-Disposition": "inline; filename=preview.pdf"})


@router.post("/generate")
def generate(event_id: str, user=Depends(current_user)):
    event = _owned(event_id, user["uid"])
    participants = [s.to_dict() for s in db().collection("events").document(event_id).collection("participants").stream()]
    template = db().collection("events").document(event_id).collection("settings").document("certificate").get().to_dict()
    batch = db().batch()
    for number, participant in enumerate(participants, 1):
        certificate_id = f"EFAI-{datetime.now(timezone.utc).year}-{event_id[:4].upper()}-{number:04d}"
        content = _pdf(event, participant, template, certificate_id)
        path = f"certificates/{event_id}/{participant['id']}.pdf"
        ref = db().collection("events").document(event_id).collection("certificates").document(participant["id"])
        cert_data = {"id": participant["id"], "certificateId": certificate_id, "eventId": event_id, "participantId": participant["id"], "status": "generated", "generatedAt": datetime.now(timezone.utc)}
        try:
            bucket().blob(path).upload_from_string(content, content_type="application/pdf")
            cert_data["store"] = "storage"
            cert_data["filePath"] = path
        except Exception:
            cert_data["store"] = "firestore"
            batch.set(ref.collection("blob").document("data"), {"content": content})
        batch.set(ref, cert_data)
    batch.commit()
    return {"generated": len(participants)}


@router.get("")
def list_certificates(event_id: str, user=Depends(current_user)):
    _owned(event_id, user["uid"])
    return [s.to_dict() for s in db().collection("events").document(event_id).collection("certificates").stream()]


@router.post("/send")
async def send_certificates(event_id: str, user=Depends(current_user)):
    event = _owned(event_id, user["uid"])
    participants = {item.id: item.to_dict() for item in db().collection("events").document(event_id).collection("participants").stream()}
    certificates = list(db().collection("events").document(event_id).collection("certificates").stream())
    sent = 0
    failed = 0
    for index, certificate in enumerate(certificates, 1):
        data = certificate.to_dict()
        if data.get("status") == "sent":
            continue
        participant = participants.get(data.get("participantId"), {})
        try:
            pdf = _certificate_bytes(event_id, data)
            await send_certificate(participant["email"], participant.get("name", ""), event["name"], pdf, f"{data.get('certificateId', 'certificate')}.pdf")
            certificate.reference.update({"status": "sent", "sentAt": datetime.now(timezone.utc), "errorMessage": None})
            sent += 1
        except EmailDailyQuota as exc:
            certificate.reference.update({"status": "failed", "errorMessage": str(exc)})
            failed += 1
            break
        except HTTPException as exc:
            certificate.reference.update({"status": "failed", "errorMessage": exc.detail})
            failed += 1
        if index % EMAIL_BATCH_SIZE == 0 and index < len(certificates):
            await asyncio.sleep(EMAIL_BATCH_PAUSE_SECONDS)
    return {"sent": sent, "total": len(certificates), "failed": failed}


@router.post("/retry")
async def retry_failed_certificates(event_id: str, user=Depends(current_user)):
    _owned(event_id, user["uid"])
    return await send_certificates(event_id, user)
