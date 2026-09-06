/* Reusable UI toolkit: toasts, modals, confirm dialogs, button states. */

export const toast = (message, type = "info", timeout) => {
  const zone = document.getElementById("toast-zone");
  if (!zone) return;
  const icons = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" };
  const item = document.createElement("div");
  item.className = `toast-item ${type}`;
  item.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><div class="toast-body">${message}</div><button class="toast-dismiss" aria-label="Dismiss notification">×</button>`;
  const dismiss = () => {
    item.classList.add("leaving");
    item.addEventListener("animationend", () => item.remove(), { once: true });
  };
  item.querySelector(".toast-dismiss").addEventListener("click", dismiss);
  zone.appendChild(item);
  const auto = timeout ?? (type === "error" ? 6000 : 4200);
  const timer = setTimeout(dismiss, auto);
  item.addEventListener("mouseenter", () => clearTimeout(timer));
  item.addEventListener("mouseleave", () => setTimeout(dismiss, auto));
};

export const setLoading = (button, loading, label) => {
  if (!button) return;
  if (loading) {
    button.dataset.originalLabel = button.textContent.trim();
    button.disabled = true;
    button.classList.add("is-loading");
    if (label) button.dataset.loadingLabel = label;
  } else {
    button.disabled = false;
    button.classList.remove("is-loading");
    const original = button.dataset.originalLabel;
    const loadingLabel = button.dataset.loadingLabel;
    if (!loadingLabel && original) button.textContent = original;
    if (loadingLabel) button.textContent = loadingLabel;
    button.dataset.loadingLabel = "";
  }
};

export const flashButton = (button, state, label, duration = 1600) => {
  if (!button) return;
  const original = button.dataset.originalLabel || button.textContent.trim();
  button.classList.add(state === "success" ? "is-success" : "is-error");
  button.textContent = label;
  button.disabled = true;
  setTimeout(() => {
    button.classList.remove("is-success", "is-error");
    button.textContent = original;
    button.disabled = false;
  }, duration);
};

export const openModal = (modal) => {
  modal.classList.remove("hidden");
  const first = modal.querySelector("input, button, select, textarea");
  if (first) setTimeout(() => first.focus(), 50);
};

export const closeModal = (modal) => modal.classList.add("hidden");

export const confirmDialog = (options) => {
  const {
    title = "Are you sure?",
    message = "",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    danger = false,
  } = options || {};
  const root = document.getElementById("modal-root");
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div class="modal-head"><h3 id="confirm-title">${title}</h3><button class="modal-close" aria-label="Close">×</button></div>
        <div class="modal-body"><p style="color:var(--text-2)">${message}</p></div>
        <div class="modal-foot">
          <button class="secondary" data-confirm="cancel">${cancelLabel}</button>
          <button class="${danger ? "danger" : ""}" data-confirm="ok">${confirmLabel}</button>
        </div>
      </div>`;
    const finish = (value) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onKey = (event) => { if (event.key === "Escape") finish(false); };
    backdrop.querySelector(".modal-close").addEventListener("click", () => finish(false));
    backdrop.addEventListener("pointerdown", (event) => { if (event.target === backdrop) finish(false); });
    backdrop.querySelector('[data-confirm="cancel"]').addEventListener("click", () => finish(false));
    backdrop.querySelector('[data-confirm="ok"]').addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKey, true);
    root.appendChild(backdrop);
  });
};

export const skeleton = (kind = "card", count = 3) => {
  const line = '<span class="skeleton skeleton-line"></span>';
  if (kind === "card") {
    return `<div class="card-list">${Array(count).fill('<div class="skeleton skeleton-card"></div>').join("")}</div>`;
  }
  return `<div>${Array(count).fill(line).join("")}</div>`;
};