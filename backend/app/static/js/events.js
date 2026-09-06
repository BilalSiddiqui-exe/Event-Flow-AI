import { api } from "./api.js";
import { skeleton, confirmDialog, toast } from "./ui.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
export const eventsModule = {
  events: [],
  hasError: false,

  badge(status) {
    if (status === "archived") return '<span class="badge">archived</span>';
    return `<span class="badge">${esc(status)}</span>`;
  },

  async load() {
    const list = document.querySelector("#event-list");
    list.innerHTML = skeleton("card", 3);
    try {
      this.events = await api.request("/api/events");
      this.hasError = false;
      list.innerHTML = this.events.length
        ? this.events.map((event) => `<article class="card event-card" data-event-id="${esc(event.id)}"><h4>${esc(event.name)}</h4><p class="muted">${esc(event.date)} · ${esc(event.location || "Location not set")}</p>${this.badge(event.status)}<div class="card-actions"><button class="secondary" data-open-action="certificates">Certificates</button><button class="secondary" data-open-action="quizzes">Quizzes</button><button class="secondary danger" data-open-action="delete">Delete</button></div></article>`).join("")
        : `<div class="empty-state"><div class="empty-icon">🗓</div><h4>No events yet</h4><p>Create your first event to start managing participants and certificates.</p><button id="empty-create-event">Create event</button></div>`;
      document.querySelector("#empty-create-event")?.addEventListener("click", () => document.querySelector("#show-event-form").click());
      const recent = document.querySelector("#recent-events");
      if (this.events.length) {
        recent.className = "card-list";
        recent.innerHTML = this.events.slice(0, 5).map((event) => `<div class="card"><h4>${esc(event.name)}</h4><p class="muted">${esc(event.date)}</p></div>`).join("");
      } else {
        recent.className = "empty-state";
        recent.innerHTML = "<p>No events yet.</p>";
      }
      document.querySelector("#metric-events").textContent = this.events.length;
      this.bindClick();
    } catch (error) {
      this.hasError = true;
      list.innerHTML = `<div class="error-state"><h4>Unable to load your events.</h4><p>${esc(error.message)}</p><div class="error-actions"><button id="retry-events">Retry</button></div></div>`;
      document.querySelector("#retry-events")?.addEventListener("click", () => { if (document.querySelector("#event-list")) this.load(); });
    }
  },

  bindClick() {
    const list = document.querySelector("#event-list");
    const handle = (clickEvent) => {
      const deleteButton = clickEvent.target.closest("[data-open-action=delete]");
      const actionButton = clickEvent.target.closest("[data-open-action]");
      const card = clickEvent.target.closest(".event-card");
      if (!card) return;
      const id = card.dataset.eventId;
      const evt = this.events.find((e) => e.id === id);
      if (!evt) return;
      if (deleteButton) {
        this.delete(evt);
      } else if (actionButton) {
        clickEvent.stopPropagation();
        if (actionButton.dataset.openAction === "quizzes" && this.onOpenQuizzes) this.onOpenQuizzes(evt);
        else if (this.onOpen) this.onOpen(evt);
      } else if (this.onOpen) {
        this.onOpen(evt);
      }
    };
    if (this._bound !== handle) {
      list.removeEventListener("click", this._bound);
      list.addEventListener("click", handle);
      this._bound = handle;
    }
  },

  async delete(evt) {
    const confirmed = await confirmDialog({
      title: "Delete event?",
      message: `Delete "${evt.name}" permanently? Its quizzes, responses, participants and certificates will also be removed. This cannot be undone.`,
      confirmLabel: "Delete event",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.request(`/api/events/${evt.id}`, { method: "DELETE" });
      toast("Event deleted.", "success");
      this.load();
    } catch (error) {
      toast(`Could not delete event: ${error.message}`, "error");
      if (this.onError) this.onError(error.message);
    }
  },

  async create(form) {
    const data = Object.fromEntries(new FormData(form));
    await api.request("/api/events", { method: "POST", body: JSON.stringify(data) });
    form.reset();
    toast("Event created successfully.", "success");
    await this.load();
  }
};