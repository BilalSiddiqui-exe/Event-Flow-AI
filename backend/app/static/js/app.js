import { watchAuth, signIn, logOut } from "./auth.js";
import { eventsModule } from "./events.js";
import { certificatesModule } from "./certificates.js";
import { quizzesModule } from "./quizzes.js";
import { submitQuiz } from "./quiz.js";
import { api } from "./api.js";

const $ = (selector) => document.querySelector(selector);
const setView = (id) => {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("hidden", view.id !== id));
  document.querySelectorAll(".sidebar nav a").forEach((link) => {
    const matches = link.hash === `#${id}`;
    link.classList.toggle("active", matches);
    if (matches) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  $("#page-title").textContent = id[0].toUpperCase() + id.slice(1);
  const view = document.getElementById(id);
  if (view) {
    view.classList.remove("view-enter");
    void view.offsetWidth;
    view.classList.add("view-enter");
  }
  if (id === "events") eventsModule.load();
  if (id === "dashboard") loadMetrics();
};

const loadMetrics = async () => {
  try {
    const data = await api.request("/api/summary");
    if ($("#metric-participants")) $("#metric-participants").textContent = data.participants;
    if ($("#metric-certificates")) $("#metric-certificates").textContent = data.certificates;
    if ($("#metric-quizzes")) $("#metric-quizzes").textContent = data.quizzes;
  } catch (error) { /* keep current values */ }
};

/* ---------- auth ---------- */
window.addEventListener("error", (event) => {
  if (event.message && event.message.includes("cancelled-popup-request")) event.preventDefault();
});
$("#google-sign-in")?.addEventListener("click", async () => {
  const btn = $("#google-sign-in");
  btn.disabled = true;
  $("#auth-error").textContent = "";
  try {
    await signIn();
  } catch (error) {
    if (error.code !== "auth/cancelled-popup-request" && error.code !== "auth/popup-closed-by-user") {
      $("#auth-error").textContent = error.message;
    }
  } finally {
    btn.disabled = false;
  }
});
$("#sign-out")?.addEventListener("click", () => logOut());
const navLinks = document.querySelectorAll(".sidebar nav a");
navLinks.forEach((link) => link.addEventListener("click", () => setView(link.hash.slice(1))));

/* ---------- event modal ---------- */
$("#show-event-form")?.addEventListener("click", () => {
  const modal = $("#event-modal");
  modal.classList.remove("hidden");
  setTimeout(() => modal.querySelector("input[name=name]").focus(), 50);
});
$("#event-modal-close")?.addEventListener("click", () => $("#event-modal").classList.add("hidden"));
$("#cancel-event")?.addEventListener("click", () => $("#event-modal").classList.add("hidden"));
$("#event-modal")?.addEventListener("pointerdown", (event) => { if (event.target.id === "event-modal") $("#event-modal").classList.add("hidden"); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") $("#event-modal").classList.add("hidden");
});
$("#event-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.target.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Creating…";
  try {
    await eventsModule.create(event.target);
    $("#event-modal").classList.add("hidden");
  } catch (error) {
    $("#auth-error").textContent = "";
    import("./ui.js").then(({ toast }) => toast(`Could not create event: ${error.message}`, "error"));
  } finally {
    button.disabled = false;
    button.textContent = "Create event";
  }
});
$("#settings-sign-out")?.addEventListener("click", () => logOut());

/* ---------- module wiring ---------- */
eventsModule.onOpen = (event) => { certificatesModule.open(event); setView("certificates"); };
eventsModule.onOpenQuizzes = (event) => { quizzesModule.open(event); setView("quizzes"); };
eventsModule.onError = (message) => import("./ui.js").then(({ toast }) => toast(message, "error"));
$("#certificate-back")?.addEventListener("click", () => setView("events"));
$("#quiz-back")?.addEventListener("click", () => setView("events"));
$("#certificate-send")?.addEventListener("click", () => certificatesModule.send());
$("#certificate-retry")?.addEventListener("click", () => certificatesModule.retry());
$("#csv-form")?.addEventListener("submit", (event) => { event.preventDefault(); certificatesModule.importCsv(event.target); });
$("#confirm-participants")?.addEventListener("click", () => certificatesModule.confirm());
$("#template-save")?.addEventListener("click", () => certificatesModule.saveTemplate());
$("#preview-certificate")?.addEventListener("click", () => certificatesModule.preview());
$("#generate-certificates")?.addEventListener("click", () => certificatesModule.generate());
$("#quiz-generate-form")?.addEventListener("submit", (event) => { event.preventDefault(); quizzesModule.generate(event.target); });
$("#quiz-save-draft")?.addEventListener("click", () => quizzesModule.saveDraft());

watchAuth(async (user) => {
  const authenticated = Boolean(user);
  $("#login-view")?.classList.toggle("hidden", authenticated);
  $("#app-view")?.classList.toggle("hidden", !authenticated);
  $("#sign-out")?.classList.toggle("hidden", !authenticated);
  if (user) {
    if ($("#user-label")) {
      $("#user-label").textContent = user.email || "";
      $("#settings-user-email").value = user.email || "";
    }
    setView("dashboard");
    try {
      await eventsModule.load();
    } catch (err) {
      import("./ui.js").then(({ toast }) => toast("Failed to load events.", "error"));
    }
    loadMetrics();
  }
});

/* ============================================================
   Participant quiz — focused, one question at a time
   ============================================================ */
if (window.EVENTFLOW_PUBLIC_QUIZ_ID) {
  document.querySelector(".shell").innerHTML = `
    <main class="content" style="padding-top:32px"><section class="panel quiz-public">
      <div id="quiz-start"></div>
      <div id="quiz-running" class="hidden">
        <div class="quiz-header">
          <div><h2 id="public-quiz-title"></h2><p id="public-quiz-description" class="muted"></p></div>
          <p id="quiz-timer" class="quiz-timer" hidden></p>
        </div>
        <div class="quiz-progress">
          <p id="quiz-q-counter" class="quiz-progress-caption"></p>
          <div id="quiz-dots" class="quiz-dots"></div>
        </div>
        <div id="quiz-q-card"></div>
        <div class="quiz-actions">
          <button id="q-prev" class="secondary hidden">Previous</button>
          <div class="btn-span">
            <button id="q-next" class="secondary">Next</button>
            <button id="q-submit" class="hidden">Submit quiz</button>
          </div>
        </div>
      </div>
      <p id="quiz-result-line" class="status-line" aria-live="polite"></p>
    </section></main>`;
  const quizId = window.EVENTFLOW_PUBLIC_QUIZ_ID;
  fetch(`/api/quizzes/${quizId}`)
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error("This quiz is unavailable."))))
    .then((quiz) => {
      const minutes = Math.max(0, Number(quiz.duration) || 0);
      const timer = $("#quiz-timer");
      const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      let remaining = minutes * 60;
      let interval;
      let submitted = false;
      let index = 0;
      let running = false;

      $("#public-quiz-title").textContent = quiz.title;
      $("#public-quiz-description").textContent = quiz.description || "";
      $("#quiz-start").innerHTML =
        (minutes > 0 ? `<p class="muted">Time limit: <strong>${minutes} minute${minutes === 1 ? "" : "s"}</strong>. The clock starts when you begin.</p>` : "") +
        '<form id="quiz-info-form" class="info-form"><label>Your name<input name="participantName" required maxlength="80"></label><label>Email<input name="participantEmail" type="email" required></label><button>Start quiz</button></form>';

      const submit = async (info, startedAt) => {
        if (submitted) return;
        submitted = true;
        submitButton.disabled = true;
        submitButton.textContent = "Submitting…";
        const answers = (quiz.questions || []).map((_, qi) => answersArray[qi]);
        try {
          const result = await submitQuiz(quizId, answers, info.name, info.email, startedAt);
          clearInterval(interval);
          timer.hidden = true;
          $("#quiz-running").classList.add("hidden");
          $("#quiz-result-line").innerHTML = `
            <div class="quiz-result-card">
              <div class="score-ring">${result.percentage}%</div>
              <h3>Quiz completed</h3>
              <p class="muted" style="margin-bottom:4px">Your score is ${result.score} / ${result.total}.</p>
              <p class="muted">Thank you, ${info.name || ""}.</p>
            </div>`;
        } catch (error) {
          if (error.message && error.message.startsWith("Time limit exceeded")) return;
          submitted = false;
          submitButton.disabled = false;
          submitButton.textContent = "Submit quiz";
          $("#quiz-result-line").textContent = error.message || "Submission failed";
        }
      };

      const answersArray = (quiz.questions || []).map(() => null);
      const quizCard = $("#quiz-q-card");
      const submitButton = $("#q-submit");
      const renderQuestion = () => {
        if (!running) return;
        const question = quiz.questions[index];
        quizCard.classList.remove("quiz-q-card");
        void quizCard.offsetWidth;
        quizCard.classList.add("quiz-q-card");
        $("#quiz-q-counter").textContent = `Question ${index + 1} of ${quiz.questions.length}`;
        $("#quiz-dots").innerHTML = quiz.questions.map((_, qi) => `<span class="${qi === index ? "active" : answersArray[qi] !== null ? "done" : ""}"></span>`).join("");
        quizCard.innerHTML = `
          <h3>${index + 1}. ${question.question}</h3>
          <div class="quiz-options">
            ${question.options.map((option, oi) => `
              <label class="quiz-option ${answersArray[index] === oi ? "selected" : ""}">
                <input type="radio" name="q" value="${oi}" ${answersArray[index] === oi ? "checked" : ""}>
                <span class="quiz-option-label">${option}</span>
              </label>`).join("")}
          </div>`;
        quizCard.querySelectorAll(".quiz-option input").forEach((input) => {
          input.addEventListener("change", () => {
            answersArray[index] = Number(input.value);
            quizCard.querySelectorAll(".quiz-option").forEach((option, oi) => option.classList.toggle("selected", oi === Number(input.value)));
            $("#quiz-dots").querySelectorAll("span").forEach((dot, qi) => dot.classList.toggle("done", answersArray[qi] !== null && qi !== index));
          });
        });
        $("#q-prev").hidden = index === 0;
        $("#q-next").hidden = index === quiz.questions.length - 1;
        $("#q-submit").hidden = index !== quiz.questions.length - 1;
      };

      $("#q-prev").addEventListener("click", () => { if (index > 0) { index -= 1; renderQuestion(); } });
      $("#q-next").addEventListener("click", () => { if (index < quiz.questions.length - 1) { index += 1; renderQuestion(); } });
      $("#q-submit").addEventListener("click", () => submit(infoState, startedAtState));

      let infoState = { name: "", email: "" };
      let startedAtState = "";

      const begin = async (info) => {
        infoState = info;
        running = true;
        $("#quiz-start").style.display = "none";
        $("#quiz-running").classList.remove("hidden");
        timer.removeAttribute("hidden");
        startedAtState = new Date().toISOString();
        try {
          const fresh = await (await fetch(`/api/quizzes/${quizId}`)).json();
          if (fresh && fresh.startedAt) startedAtState = fresh.startedAt;
        } catch (error) { /* fall back to client clock */ }
        renderQuestion();
        if (remaining > 0) {
          const tick = () => {
            if (remaining <= 0) {
              clearInterval(interval);
              timer.textContent = "Time's up — submitting your answers";
              timer.classList.add("expired");
              const answersNow = (quiz.questions || []).map((_, qi) => answersArray[qi]);
              emptySubmit(answersNow);
              return;
            }
            timer.textContent = `${formatTime(remaining)} remaining`;
            remaining -= 1;
          };
          tick();
          interval = setInterval(tick, 1000);
        } else {
          timer.hidden = true;
        }
      };

      const emptySubmit = async (answers) => {
        if (submitted) return;
        submitted = true;
        submitButton.disabled = true;
        submitButton.textContent = "Submitting…";
        try {
          const result = await submitQuiz(quizId, answers, infoState.name, infoState.email, startedAtState);
          clearInterval(interval);
          $("#quiz-running").classList.add("hidden");
          $("#quiz-result-line").innerHTML = `<div class="quiz-result-card"><div class="score-ring">${result.percentage}%</div><h3>Quiz completed</h3><p class="muted">Your score is ${result.score} / ${result.total}.</p></div>`;
        } catch (error) {
          submitted = false;
          $("#quiz-result-line").textContent = error.message || "Submission failed";
        }
      };

      $("#quiz-info-form").addEventListener("submit", (event) => {
        event.preventDefault();
        const form = new FormData(event.target);
        begin({ name: String(form.get("participantName") || "").trim(), email: String(form.get("participantEmail") || "").trim() });
      });
    })
    .catch((error) => {
      document.querySelector(".shell").innerHTML = `<main class="content"><section class="panel"><h2>Quiz unavailable</h2><p class="muted">${error.message}</p></section></main>`;
    });
}