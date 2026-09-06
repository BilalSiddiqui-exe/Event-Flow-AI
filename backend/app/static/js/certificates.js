import { api } from "./api.js";
import { uploadParticipants } from "./csv.js";
import { toast } from "./ui.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
const $ = (id) => document.getElementById(id);

export const certificatesModule = {
  event: null,
  valid: [],
  participants: [],
  template: null,
  drag: null,
  boxRect: null,
  editorBound: false,
  generating: false,

  open(event) {
    this.event = event;
    this.valid = [];
    this.participants = [];
    this.clearEditor();
    $("certificate-event-name").textContent = event.name;
    $("certificate-status").textContent = "Ready. Import participants below to continue.";
    $("certificate-workflow").classList.remove("hidden");
    $("certificate-back").classList.remove("hidden");
    $("certificate-send").classList.add("hidden");
    $("certificate-retry").classList.add("hidden");
    $("csv-result").innerHTML = "";
    $("confirm-row").classList.add("hidden");
    $("participant-count").textContent = "";
    $("generate-row").classList.add("hidden");
    $("generate-status").textContent = "";
    $("generate-progress").classList.add("hidden");
    $("csv-file").value = "";
    $("template-file").value = "";
    this.bindEditor();
    this.refresh();
  },

  clearEditor() {
    this.template = null;
    this.drag = null;
    this.boxRect = null;
    const canvas = $("template-canvas");
    if (canvas) canvas.getContext("2d").clearRect(0, 0, 842, 595);
    if (this.editorBound) $("template-editor").classList.add("hidden");
    $("template-status").textContent = "";
  },

  bindEditor() {
    if (this.editorBound) return;
    this.editorBound = true;
    const canvas = $("template-canvas");
    $("template-file").addEventListener("change", (event) => this.loadTemplate(event.target.files && event.target.files[0]));
    $("template-font").addEventListener("change", () => { if (this.template) { this.template.font = $("template-font").value; this.draw(); } });
    $("template-size").addEventListener("input", () => { if (this.template) { this.template.size = Math.max(10, Math.min(120, Number($("template-size").value) || 28)); this.draw(); } });
    $("template-x").addEventListener("input", () => { if (this.template) { this.template.pdfX = Math.max(0, Math.min(842, Number($("template-x").value) || 421)); this.draw(); } });
    $("template-y").addEventListener("input", () => { if (this.template) { this.template.pdfY = Math.max(0, Math.min(595, Number($("template-y").value) || 390)); this.draw(); } });
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Certificate template editor — click or drag to position the participant name");
    canvas.addEventListener("keydown", (event) => {
      if (!this.template) return;
      const step = event.shiftKey ? 10 : 1;
      let dx = 0, dy = 0;
      if (event.key === "ArrowLeft") dx = -step;
      else if (event.key === "ArrowRight") dx = step;
      else if (event.key === "ArrowUp") dy = step;
      else if (event.key === "ArrowDown") dy = -step;
      else return;
      event.preventDefault();
      this.template.pdfX = Math.max(0, Math.min(842, this.template.pdfX + dx));
      this.template.pdfY = Math.max(0, Math.min(595, this.template.pdfY + dy));
      this.syncInputs();
      this.draw();
    });
    canvas.addEventListener("pointerdown", (event) => {
      if (!this.template) return;
      const position = this.toCanvas(event);
      const inside = this.hitBox(position.x, position.y);
      this.drag = inside
        ? { offsetX: this.template.pdfX - position.x, offsetY: this.template.pdfY - (595 - position.y) }
        : { offsetX: 0, offsetY: 0 };
      if (!inside) { this.template.pdfX = position.x; this.template.pdfY = 595 - position.y; }
      canvas.setPointerCapture(event.pointerId);
      this.syncInputs();
      this.draw();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!this.template || !this.drag) return;
      const position = this.toCanvas(event);
      this.template.pdfX = Math.max(0, Math.min(842, position.x + this.drag.offsetX));
      this.template.pdfY = Math.max(0, Math.min(595, (595 - position.y) + this.drag.offsetY));
      this.syncInputs();
      this.draw();
    });
    canvas.addEventListener("pointerup", () => { this.drag = null; });
    canvas.addEventListener("pointercancel", () => { this.drag = null; });
  },

  toCanvas(event) {
    const rect = $("template-canvas").getBoundingClientRect();
    return { x: Math.max(0, Math.min(842, (event.clientX - rect.left) * 842 / rect.width)), y: Math.max(0, Math.min(595, (event.clientY - rect.top) * 595 / rect.height)) };
  },

  hitBox(x, y) {
    if (!this.boxRect) return false;
    return x >= this.boxRect.left - 8 && x <= this.boxRect.right + 8 && y >= this.boxRect.top - 8 && y <= this.boxRect.bottom + 8;
  },

  sampleName() {
    return (this.participants && this.participants[0] && this.participants[0].name) || "Participant Name";
  },

  cssFont() {
    const t = this.template;
    const family = /Helvetica/.test(t.font) ? "Helvetica, Arial, sans-serif" : /Times/.test(t.font) ? "Times New Roman, Times, serif" : "Courier New, monospace";
    const weight = /Bold/.test(t.font) ? "700" : "400";
    const style = /Oblique|Italic/.test(t.font) ? "italic" : "normal";
    return `${style} ${weight} ${t.size}px ${family}`;
  },

  draw() {
    const t = this.template;
    if (!t) return;
    const canvas = $("template-canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 842, 595);
    const img = t.img;
    const scale = Math.min(842 / img.naturalWidth, 595 / img.naturalHeight);
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    const dx = (842 - dw) / 2, dy = (595 - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.font = this.cssFont();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const cx = t.pdfX, cy = 595 - t.pdfY;
    const sample = this.sampleName();
    const metrics = ctx.measureText(sample);
    const height = Math.round(t.size * 1.3);
    const width = metrics.width;
    this.boxRect = { left: cx - width / 2 - 6, right: cx + width / 2 + 6, top: cy - t.size * 0.8 - 4, bottom: cy + height - t.size * 0.8 + 4 };
    ctx.fillStyle = "rgba(33,110,98,0.10)";
    ctx.fillRect(this.boxRect.left, this.boxRect.top, this.boxRect.right - this.boxRect.left, this.boxRect.bottom - this.boxRect.top);
    ctx.strokeStyle = "rgba(33,110,98,0.55)";
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(this.boxRect.left, this.boxRect.top, this.boxRect.right - this.boxRect.left, this.boxRect.bottom - this.boxRect.top);
    ctx.setLineDash([]);
    ctx.fillStyle = "#141a2b";
    ctx.fillText(sample, cx, cy);
  },

  syncInputs() {
    if (!this.template) return;
    $("template-x").value = Math.round(this.template.pdfX);
    $("template-y").value = Math.round(this.template.pdfY);
    $("template-size").value = Math.round(this.template.size);
    $("template-font").value = this.template.font;
  },

  async loadTemplate(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      $("template-status").textContent = "Template must be a PNG/JPG image.";
      return;
    }
    $("template-status").textContent = "Loading image…";
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      this.template = {
        img,
        font: $("template-font").value,
        size: Math.max(10, Math.min(120, Number($("template-size").value) || 28)),
        pdfX: Math.max(0, Math.min(842, Number($("template-x").value) || 421)),
        pdfY: Math.max(0, Math.min(595, Number($("template-y").value) || 390)),
      };
      $("template-editor").classList.remove("hidden");
      $("template-status").textContent = "Click or drag the box to position the name (arrow keys work too), then Save template.";
      this.draw();
      this.syncInputs();
    };
    img.onerror = () => { $("template-status").textContent = "Could not load that image."; };
    img.src = objectUrl;
  },

  async refresh() {
    if (!this.event) return;
    try {
      this.participants = await api.request(`/api/events/${this.event.id}/participants`);
      const certs = await api.request(`/api/events/${this.event.id}/certificates`);
      const unsent = certs.filter((c) => c.status && c.status !== "sent");
      const failed = certs.filter((c) => c.status === "failed");
      $("participant-count").textContent = `${this.participants.length} participant(s) saved.`;
      $("generate-row").classList.toggle("hidden", this.participants.length === 0);
      $("generate-status").textContent = certs.length ? `${certs.length} certificate(s) generated` : "";
      $("certificate-send").classList.toggle("hidden", unsent.length === 0 || this.participants.length === 0);
      $("certificate-retry").classList.toggle("hidden", failed.length === 0);
    } catch (error) {
      $("certificate-status").textContent = `Failed to load workflow: ${error.message}`;
    }
  },

  async importCsv(form) {
    const fileInput = $("csv-file");
    if (!fileInput.files || !fileInput.files[0]) {
      $("csv-result").innerHTML = `<p class="error">Choose a CSV file first.</p>`;
      return;
    }
    form.querySelector("button[type=submit]").disabled = true;
    $("csv-result").innerHTML = `<div class="csv-staged"><div class="stage active">Processing file…</div></div>`;
    try {
      const result = await uploadParticipants(this.event.id, fileInput.files[0]);
      this.valid = result.valid;
      const validRows = (result.valid || []).length;
      const invalidRows = result.invalid || [];
      const summary = `${validRows} valid, ${invalidRows.length} invalid of ${result.total} row(s).`;
      $("csv-result").innerHTML = `
        <div class="csv-staged">
          <div class="stage ok">File parsed</div><div class="stage ok">Validated</div><div class="stage ${validRows ? "ready" : ""}">Ready to import</div>
        </div>
        <p>${summary}</p>
        <ul class="csv-list">
          ${(result.valid || []).map((r) => `<li class="ok">${esc(r.email)}</li>`).join("")}
          ${invalidRows.map((r) => `<li class="bad">Row ${r.row}: ${esc(r.message)}</li>`).join("")}
        </ul>`;
      $("confirm-row").classList.toggle("hidden", validRows === 0);
    } catch (error) {
      $("csv-result").innerHTML = `<p class="error">${esc(error.message)}</p>`;
    } finally {
      form.querySelector("button[type=submit]").disabled = false;
    }
  },

  async confirm() {
    if (!this.valid.length) return;
    try {
      const button = $("confirm-participants");
      button.disabled = true;
      button.textContent = "Saving…";
      const result = await api.request(`/api/events/${this.event.id}/participants/confirm`, { method: "POST", body: JSON.stringify(this.valid) });
      $("confirm-row").classList.add("hidden");
      $("csv-result").innerHTML += `<p class="ok">Imported ${result.imported} participant(s).</p>`;
      this.valid = [];
      toast(`Imported ${result.imported} participant${result.imported === 1 ? "" : "s"}.`, "success");
      await this.refresh();
      button.disabled = false;
      button.textContent = "Confirm and save participants";
    } catch (error) {
      $("csv-result").innerHTML += `<p class="error">${esc(error.message)}</p>`;
    }
  },

  async saveTemplate() {
    const fileInput = $("template-file");
    if (!this.template || !fileInput.files || !fileInput.files[0]) {
      $("template-status").textContent = "Choose a template image first.";
      return;
    }
    const t = this.template;
    const button = $("template-save");
    button.disabled = true;
    button.textContent = "Saving…";
    $("template-status").textContent = "";
    try {
      const fd = new FormData();
      fd.append("file", fileInput.files[0]);
      fd.append("fields", JSON.stringify({
        name: {
          font: t.font,
          size: Math.round(t.size),
          x: Math.round(t.pdfX),
          y: Math.round(t.pdfY),
        },
      }));
      const res = await api.request(`/api/events/${this.event.id}/certificates/template`, { method: "POST", body: fd });
      $("template-status").textContent = `Template saved. Step 3 is now ready — generate certificates below.`;
      toast("Certificate template saved.", "success");
    } catch (error) {
      $("template-status").textContent = `Failed to save template: ${error.message}`;
    } finally {
      button.disabled = false;
      button.textContent = "Save template";
    }
  },

  async preview() {
    if (!this.participants.length) {
      $("generate-status").textContent = "No participants to preview.";
      return;
    }
    try {
      const participant = this.participants[0];
      const { token } = await import("./auth.js");
      const idToken = await token();
      const response = await fetch(`/api/events/${this.event.id}/certificates/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
        body: JSON.stringify(participant),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "Preview failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (error) {
      $("generate-status").textContent = `Preview failed: ${error.message}`;
    }
  },

  async generate() {
    if (this.generating) return;
    this.generating = true;
    const progress = $("generate-progress");
    progress.classList.remove("hidden");
    progress.querySelector(".progress-bar").setAttribute("aria-busy", "true");
    progress.querySelector(".progress-caption").textContent = "Generating certificates…";
    $("generate-certificates").disabled = true;
    try {
      const result = await api.request(`/api/events/${this.event.id}/certificates/generate`, { method: "POST" });
      progress.classList.add("hidden");
      $("generate-status").textContent = `Generated ${result.generated} certificate(s).`;
      toast(`Generated ${result.generated} certificate${result.generated === 1 ? "" : "s"}.`, "success");
      await this.refresh();
    } catch (error) {
      progress.classList.add("hidden");
      $("generate-status").textContent = `Generation failed: ${error.message}`;
      toast(`Generation failed: ${error.message}`, "error");
    } finally {
      this.generating = false;
      $("generate-certificates").disabled = false;
    }
  },

  async send() {
    const button = $("certificate-send");
    button.disabled = true;
    button.textContent = "Sending…";
    $("certificate-status").textContent = "Sending certificates…";
    try {
      const result = await api.request(`/api/events/${this.event.id}/certificates/send`, { method: "POST" });
      $("certificate-status").textContent = `Sent ${result.sent} of ${result.total} certificate(s).`;
      toast(`Sent ${result.sent} of ${result.total} certificate${result.total === 1 ? "" : "s"}.`, "success");
      await this.refresh();
    } catch (error) {
      $("certificate-status").textContent = `Send failed: ${error.message}`;
    } finally {
      button.disabled = false;
      button.textContent = "Send by email";
    }
  },

  async retry() {
    $("certificate-status").textContent = "Retrying failed certificates…";
    try {
      const result = await api.request(`/api/events/${this.event.id}/certificates/send`, { method: "POST" });
      $("certificate-status").textContent = `Sent ${result.sent} of ${result.total} certificate(s).`;
      toast(`Sent ${result.sent} of ${result.total} certificate${result.total === 1 ? "" : "s"}.`, "success");
      await this.refresh();
    } catch (error) {
      $("certificate-status").textContent = `Retry failed: ${error.message}`;
    }
  },
};