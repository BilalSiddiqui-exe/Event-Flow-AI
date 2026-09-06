import { generateQuiz, createQuiz, listQuizzes, publishQuiz, quizAnalytics, deleteQuiz } from "./quiz.js";
import { renderAnalytics } from "./analytics.js";
import { confirmDialog, toast } from "./ui.js";
import { eventsModule } from "./events.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
const $ = (id) => document.getElementById(id);

export const quizzesModule = {
  event: null,
  generated: [],
  quizzes: [],
  generating: false,

  open(event) {
    this.event = event;
    this.generated = [];
    this.hidePicker();
    $("quiz-event-name").textContent = event.name;
    $("quiz-status").textContent = "Ready. Generate questions below, review, save, then publish.";
    $("quiz-workflow").classList.remove("hidden");
    $("quiz-back").classList.remove("hidden");
    $("quiz-review-panel").classList.add("hidden");
    $("quiz-analytics-panel").classList.add("hidden");
    $("quiz-generate-status").textContent = "";
    $("quiz-save-status").textContent = "";
    $("quiz-review-list").innerHTML = "";
    $("quiz-analytics").innerHTML = "";
    this.refresh();
  },

  hidePicker() {
    const panel = $("quiz-picker");
    if (panel) panel.classList.add("hidden");
  },

  async showPicker() {
    if (this.event) return;
    const panel = $("quiz-picker");
    if (!panel) return;
    $("quiz-workflow").classList.add("hidden");
    $("quiz-back").classList.add("hidden");
    $("quiz-review-panel").classList.add("hidden");
    $("quiz-analytics-panel").classList.add("hidden");
    const events = eventsModule.events || [];
    if (!events.length) {
      try { await eventsModule.load(); } catch (error) { /* best effort */ }
    }
    const loaded = eventsModule.events || [];
    if (!loaded.length) {
      panel.innerHTML = `<h3>Choose an event</h3><p class="muted">No events yet. Create one from the Events section first.</p>`;
      panel.classList.remove("hidden");
      return;
    }
    panel.innerHTML = `<h3>Choose an event</h3>
      <div class="card-list">
        ${loaded.map((e) => `<article class="card event-card" data-event-id="${esc(e.id)}"><h4>${esc(e.name)}</h4><p class="muted">${esc(e.date || "")} · ${esc(e.location || "Location not set")}</p><p class="muted" data-quiz-summary></p><div class="card-actions"><button class="secondary" data-quiz-pick="${esc(e.id)}">Open quizzes</button></div></article>`).join("")}
      </div>`;
    panel.classList.remove("hidden");
    loaded.forEach(async (e) => {
      try {
        const quizzes = await listQuizzes(e.id);
        const published = quizzes.filter((q) => q.status === "published").length;
        const summary = panel.querySelector(`[data-event-id="${e.id}"] [data-quiz-summary]`);
        if (summary) summary.textContent = `${quizzes.length} quiz(zes) · ${published} published`;
      } catch (error) { /* keep card as-is */ }
    });
  },

  back() {
    this.event = null;
    this.generated = [];
    $("quiz-event-name").textContent = "Quizzes";
    this.showPicker();
  },

  async refresh() {
    if (!this.event) return;
    try {
      this.quizzes = await listQuizzes(this.event.id);
      $("quiz-list").innerHTML = this.quizzes.length
        ? `<div class="card-list">${this.quizzes.map((quiz) => this._card(quiz)).join("")}</div>`
        : `<div class="empty-state"><div class="empty-icon">🧠</div><h4>No quizzes yet</h4><p>Generate a quiz with Gemini and publish it for your participants.</p></div>`;
    } catch (error) {
      $("quiz-status").textContent = `Failed to load quizzes: ${error.message}`;
    }
  },

  _card(quiz) {
    const isPublished = quiz.status === "published";
    const btns = [
      isPublished
        ? `<button data-quiz-action="copy" data-quiz-id="${esc(quiz.id)}" class="secondary">Copy link</button>`
        : `<button data-quiz-action="publish" data-quiz-id="${esc(quiz.id)}" class="secondary" ${quiz.questions && quiz.questions.length ? "" : "disabled"}>Publish</button>`,
      isPublished ? `<button data-quiz-action="analytics" data-quiz-id="${esc(quiz.id)}" class="secondary">Analytics</button>` : "",
      `<button data-quiz-action="delete" data-quiz-id="${esc(quiz.id)}" class="secondary danger">Delete</button>`,
    ].join("");
    return `<article class="card"><h4>${esc(quiz.title)}</h4><p class="muted">${esc(quiz.topic || "")} · ${quiz.questions ? quiz.questions.length : 0} questions · ${quiz.duration ? quiz.duration + " min" : "no limit"}</p><span class="badge">${esc(quiz.status)}</span><div class="card-actions">${btns}</div></article>`;
  },

  async generate(form) {
    if (this.generating) return;
    const data = Object.fromEntries(new FormData(form));
    this.generating = true;
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    submit.textContent = "Generating…";
    const progress = $("quiz-generate-progress");
    progress.classList.remove("hidden");
    progress.querySelector(".progress-caption").textContent = "Asking Gemini to draft questions…";
    $("quiz-generate-status").textContent = "Generating with Gemini (may take a few seconds)…";
    try {
      const config = {
        topic: data.topic,
        question_count: Number(data.question_count || 5),
        difficulty: data.difficulty,
        audience: data.audience || "",
      };
      const result = await generateQuiz(this.event.id, config);
      this.generated = result.questions || [];
      progress.querySelector(".progress-caption").textContent = "Draft complete";
      $("quiz-review-list").innerHTML = this._renderReviewer({ title: data.title || data.topic, topic: data.topic, difficulty: data.difficulty, questions: this.generated });
      $("quiz-review-panel").classList.remove("hidden");
      $("quiz-generate-status").textContent = `Generated ${this.generated.length} question(s). Review, edit, then save as a draft.`;
      $("quiz-review-panel").scrollIntoView({ behavior: "smooth", block: "start" });
      toast(`Generated ${this.generated.length} question${this.generated.length === 1 ? "" : "s"}.`, "success");
    } catch (error) {
      $("quiz-generate-status").textContent = `Generation failed: ${error.message}. The model may be busy; retry in a few seconds.`;
      toast(`Generation failed: ${error.message}`, "error");
    } finally {
      progress.classList.add("hidden");
      this.generating = false;
      submit.disabled = false;
      submit.textContent = "Generate questions";
    }
  },

  _renderReviewer(quiz) {
    const rows = quiz.questions.map((q, index) => `
      <fieldset class="quiz-q">
        <legend>Question ${index + 1}</legend>
        <label>Question<textarea name="q-${index}" class="review-q">${esc(q.question)}</textarea></label>
        ${(q.options || []).map((option, oi) => `<label>Option ${String.fromCharCode(65 + oi)}<input name="o-${index}-${oi}" class="review-opt" value="${esc(option)}"></label>`).join("")}
        <label>Correct answer<select name="a-${index}" class="review-ans">${(q.options || []).map((_, oi) => `<option value="${oi}" ${oi === q.correctAnswer ? "selected" : ""}>${String.fromCharCode(65 + oi)}</option>`).join("")}</select></label>
      </fieldset>`).join("");
    return `<p class="muted">Quiz title: <strong>${esc(quiz.title)}</strong></p>${rows}`;
  },

  _readDuration() {
    const durationInput = $("quiz-generate-form") ? $("quiz-generate-form").querySelector("input[name=duration]") : null;
    return durationInput ? Math.min(180, Math.max(1, Number(durationInput.value))) : 10;
  },

  async saveDraft() {
    if (!this.generated.length) return;
    const form = $("quiz-generate-form");
    const titleInput = form.querySelector("input[name=title]");
    const topicInput = form.querySelector("input[name=topic]");
    const difficultyInput = form.querySelector("select[name=difficulty]");
    const questions = Array.from(document.querySelectorAll(".quiz-q")).map((fieldset, index) => {
      const options = Array.from(fieldset.querySelectorAll(".review-opt")).map((input) => input.value.trim());
      return {
        question: fieldset.querySelector(".review-q").value.trim(),
        options,
        correctAnswer: Number(fieldset.querySelector(".review-ans").value),
      };
    });
    const payload = {
      title: (titleInput && titleInput.value.trim()) || (topicInput && topicInput.value.trim()) || "Untitled quiz",
      description: "",
      topic: (topicInput && topicInput.value.trim()) || "",
      difficulty: (difficultyInput && difficultyInput.value) || "intermediate",
      duration: this._readDuration(),
      questions,
    };
    const button = $("quiz-save-draft");
    button.disabled = true;
    button.textContent = "Saving…";
    $("quiz-save-status").textContent = "";
    try {
      await createQuiz(this.event.id, payload);
      $("quiz-save-status").textContent = "Draft saved.";
      $("quiz-review-panel").classList.add("hidden");
      $("quiz-review-list").innerHTML = "";
      this.generated = [];
      toast("Quiz saved as a draft.", "success");
      await this.refresh();
    } catch (error) {
      $("quiz-save-status").textContent = `Failed to save: ${error.message}`;
      toast(`Failed to save: ${error.message}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Save quiz (draft)";
    }
  },

  async onAction(action, quizId) {
    if (action === "publish") {
      try {
        await publishQuiz(quizId);
        toast("Quiz published.", "success");
        await this.refresh();
      } catch (error) {
        toast(`Publish failed: ${error.message}`, "error");
        $("quiz-status").textContent = `Publish failed: ${error.message}`;
      }
    } else if (action === "copy") {
      const { origin } = window.location;
      const href = `${origin}/quiz/${quizId}`;
      try {
        await navigator.clipboard.writeText(href);
        toast("Public link copied to clipboard.");
        $("quiz-status").textContent = `Public link copied: ${href}`;
      } catch (error) {
        $("quiz-status").textContent = `Public link: ${href}`;
      }
    } else if (action === "analytics") {
      try {
        const result = await quizAnalytics(quizId);
        $("quiz-analytics-panel").classList.remove("hidden");
        renderAnalytics($("quiz-analytics"), result);
        $("quiz-analytics-panel").scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        $("quiz-status").textContent = `Analytics failed: ${error.message}`;
      }
    } else if (action === "delete") {
      const confirmed = await confirmDialog({
        title: "Delete quiz?",
        message: "Delete this quiz permanently? Its link will stop working and submitted responses will be removed. This cannot be undone.",
        confirmLabel: "Delete quiz",
        danger: true,
      });
      if (!confirmed) return;
      try {
        await deleteQuiz(quizId);
        toast("Quiz deleted.", "success");
        await this.refresh();
      } catch (error) {
        $("quiz-status").textContent = `Delete failed: ${error.message}`;
        toast(`Delete failed: ${error.message}`, "error");
      }
    }
  },
};

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-quiz-action]");
  if (button && quizzesModule && quizzesModule.onAction) {
    quizzesModule.onAction(button.dataset.quizAction, button.dataset.quizId);
  }
});