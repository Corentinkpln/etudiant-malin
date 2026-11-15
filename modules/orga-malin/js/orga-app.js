/**
 * Orga Malin V1.0 — Contrôleur UI, Minuteur Anti-Procrastination & Sync Cloud (orga-app.js)
 */
(function (global) {
  "use strict";

  const Engine = global.OrgaEngine;

  const FOCUS_MODES = {
    ignition: { label: "Règle des 5 min", seconds: 5 * 60, color: "#ff9500" },
    sprint25: { label: "Sprint Focus 25m", seconds: 25 * 60, color: "#0071e3" },
    sprint45: { label: "Deep Work 45m", seconds: 45 * 60, color: "#5856d6" },
    break: { label: "Pause récupération", seconds: 5 * 60, color: "#28a745" }
  };

  const RING_CIRCUMFERENCE = 2 * Math.PI * 54;

  const state = {
    currentUser: null,
    syncTimer: null,
    selectedWeekMonday: Engine.getMondayOfWeek(new Date()),
    backlogFilter: "all",
    tasks: [],
    events: [],
    completedSprints: 0,
    focus: {
      mode: "ignition",
      remainingSec: 5 * 60,
      totalSec: 5 * 60,
      isRunning: false,
      endTimestamp: null,
      intervalId: null,
      activeTaskId: null,
      distractions: 0
    }
  };

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setSyncIndicator(status, text) {
    const badge = document.getElementById("em-sync-status");
    if (!badge) return;
    badge.className = "em-sync-badge";
    if (status === "syncing") badge.classList.add("is-syncing");
    if (status === "error") badge.classList.add("is-error");
    badge.textContent = text;
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 3200);
  }

  /* --------------------------------------------------------------------------
     Sauvegarde Cloud Supabase avec Debounce (800ms)
     -------------------------------------------------------------------------- */
  function scheduleSync() {
    if (!state.currentUser || !global.EtudiantCore) return;
    setSyncIndicator("syncing", "Sauvegarde...");

    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(async () => {
      try {
        await global.EtudiantCore.saveModuleData("orga-malin", {
          tasks: state.tasks,
          events: state.events,
          completedSprints: state.completedSprints
        });
        setSyncIndicator("ok", "Synchronisé ✓");
      } catch (err) {
        console.error(err);
        setSyncIndicator("error", "Erreur sync");
      }
    }, 800);
  }

  async function loadFromCloud() {
    setSyncIndicator("syncing", "Chargement...");
    try {
      const data = await global.EtudiantCore.loadModuleData("orga-malin");
      if (data && typeof data === "object") {
        state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
        state.events = Array.isArray(data.events) ? data.events : [];
        state.completedSprints = Number(data.completedSprints) || 0;
      } else {
        const starter = Engine.createStarterWorkspace(state.selectedWeekMonday);
        state.tasks = starter.tasks;
        state.events = starter.events;
        state.completedSprints = 0;
      }
      setSyncIndicator("ok", "Synchronisé ✓");
    } catch (err) {
      console.error(err);
      setSyncIndicator("error", "Mode hors-ligne");
    }
  }

  /* --------------------------------------------------------------------------
     Moteur du Sas Anti-Procrastination & Chrono précis
     -------------------------------------------------------------------------- */
  function formatClock(sec) {
    const safe = Math.max(0, Math.ceil(sec));
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function renderFocusCockpit() {
    const cfg = FOCUS_MODES[state.focus.mode];
    const ratio = state.focus.totalSec > 0 ? state.focus.remainingSec / state.focus.totalSec : 1;
    const offset = RING_CIRCUMFERENCE * (1 - ratio);

    const ring = document.getElementById("focus-ring-progress");
    ring.style.stroke = cfg.color;
    ring.style.strokeDashoffset = offset.toFixed(2);

    document.getElementById("focus-clock-display").textContent = formatClock(state.focus.remainingSec);
    document.getElementById("focus-phase-label").textContent = cfg.label;
    document.getElementById("btn-focus-toggle").textContent = state.focus.isRunning ? "Pause" : "Démarrer";
    document.getElementById("distraction-count-label").textContent = state.focus.distractions;
    document.getElementById("focus-stats-label").textContent =
      `${state.completedSprints} sprint${state.completedSprints > 1 ? "s" : ""} validé${state.completedSprints > 1 ? "s" : ""}`;

    document.querySelectorAll("#focus-mode-pills button").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.focusMode === state.focus.mode);
    });

    const activeTask = state.tasks.find((t) => t.id === state.focus.activeTaskId);
    const titleEl = document.getElementById("focus-task-title");
    const stepInput = document.getElementById("focus-first-step-input");
    const completeBtn = document.getElementById("btn-focus-complete");

    if (activeTask) {
      titleEl.textContent = activeTask.title;
      if (document.activeElement !== stepInput) {
        stepInput.value = activeTask.firstStep || "";
      }
      completeBtn.classList.remove("hidden");
    } else {
      titleEl.textContent = "Choisis une tâche dans le backlog →";
      completeBtn.classList.add("hidden");
    }
  }

  function switchFocusMode(newMode) {
    stopFocusTimer();
    const cfg = FOCUS_MODES[newMode] || FOCUS_MODES.ignition;
    state.focus.mode = newMode;
    state.focus.totalSec = cfg.seconds;
    state.focus.remainingSec = cfg.seconds;
    renderFocusCockpit();
  }

  function stopFocusTimer() {
    state.focus.isRunning = false;
    state.focus.endTimestamp = null;
    if (state.focus.intervalId) {
      clearInterval(state.focus.intervalId);
      state.focus.intervalId = null;
    }
  }

  function startFocusTimer() {
    if (state.focus.isRunning) return;
    if (state.focus.remainingSec <= 0) {
      state.focus.remainingSec = state.focus.totalSec;
    }
    state.focus.isRunning = true;
    state.focus.endTimestamp = Date.now() + state.focus.remainingSec * 1000;

    state.focus.intervalId = setInterval(() => {
      const left = Math.max(0, (state.focus.endTimestamp - Date.now()) / 1000);
      state.focus.remainingSec = left;
      renderFocusCockpit();

      if (left <= 0) {
        stopFocusTimer();
        Engine.playCompletionChime();

        if (state.focus.mode === "ignition") {
          showToast("5 minutes franchies ! Bascule automatique en Sprint 25 min.");
          switchFocusMode("sprint25");
        } else if (state.focus.mode === "sprint25" || state.focus.mode === "sprint45") {
          state.completedSprints += 1;
          scheduleSync();
          showToast("Sprint validé ! Prends 5 min de pause.");
          switchFocusMode("break");
        } else {
          showToast("Pause terminée. Prêt pour un nouveau sprint ?");
          switchFocusMode("sprint25");
        }
      }
    }, 250);

    renderFocusCockpit();
  }

  /* --------------------------------------------------------------------------
     Rendu Backlog & Semainier
     -------------------------------------------------------------------------- */
  function renderBacklog() {
    const listEl = document.getElementById("backlog-list");
    const filter = state.backlogFilter;

    const priorityOrder = { p1: 1, p2: 2, p3: 3 };
    const priorityLabels = {
      p1: "P1 · Urgent",
      p2: "P2 · Planifier",
      p3: "P3 · Rapide"
    };

    const filtered = state.tasks
      .filter((t) => {
        if (filter === "done") return t.done;
        if (t.done) return false;
        if (filter === "all") return true;
        return t.priority === filter;
      })
      .sort((a, b) => (priorityOrder[a.priority] || 9) - (priorityOrder[b.priority] || 9));

    if (!filtered.length) {
      listEl.innerHTML = `<li style="font-size: 0.85rem; color: var(--text-secondary); padding: 14px 4px;">Aucune tâche dans cette vue.</li>`;
      return;
    }

    listEl.innerHTML = filtered
      .map(
        (task) => `
        <li class="task-row ${task.done ? "is-done" : ""}">
          <div class="task-row__left">
            <input type="checkbox" class="task-check" data-toggle-task="${task.id}" ${task.done ? "checked" : ""} />
            <div>
              <div class="task-row__title">${escapeHtml(task.title)}</div>
              <div class="task-row__meta">
                <span class="pill pill--${task.priority}">${priorityLabels[task.priority] || "P2"}</span>
                <span>⏱ ${task.durationMin || 30} min</span>
                ${task.firstStep ? `<span>· 🚀 <em>${escapeHtml(task.firstStep)}</em></span>` : ""}
              </div>
            </div>
          </div>
          <div class="task-row__actions">
            ${
              !task.done
                ? `
              <button type="button" class="btn btn--primary btn--xs" data-focus-task="${task.id}" title="Envoyer dans le Sas Anti-Procrastination">
                Démarrer
              </button>
              <button type="button" class="btn btn--subtle btn--xs" data-plan-task="${task.id}" title="Ajouter au semainier">
                Planifier
              </button>
            `
                : ""
            }
            <button type="button" class="btn--icon-danger" data-del-task="${task.id}" title="Supprimer">×</button>
          </div>
        </li>
      `
      )
      .join("");
  }

  function renderWeekGrid() {
    document.getElementById("current-week-label").textContent = Engine.formatWeekRangeLabel(state.selectedWeekMonday);
    const days = Engine.getWeekDays(state.selectedWeekMonday);
    const grid = document.getElementById("week-grid");

    grid.innerHTML = days
      .map((day) => {
        const dayEvents = state.events
          .filter((ev) => ev.date === day.iso)
          .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));

        const blocksHtml = dayEvents.length
          ? dayEvents
              .map(
                (ev) => `
              <div class="event-block event-block--${ev.category || "cours"}">
                <button type="button" class="event-block__del" data-del-event="${ev.id}" title="Retirer">×</button>
                <div class="event-block__time">${escapeHtml(ev.startTime)} – ${escapeHtml(ev.endTime || "")}</div>
                <div class="event-block__title">${escapeHtml(ev.title)}</div>
              </div>
            `
              )
              .join("")
          : `<div style="font-size: 0.74rem; color: var(--text-secondary); opacity: 0.65; margin-top: 6px;">Libre</div>`;

        return `
          <div class="day-col ${day.isToday ? "is-today" : ""}">
            <div class="day-col__head">
              <span class="day-col__name">${day.dayName}</span>
              <span class="day-col__date">${day.shortDate}</span>
            </div>
            ${blocksHtml}
          </div>
        `;
      })
      .join("");
  }

  function renderAll() {
    renderFocusCockpit();
    renderBacklog();
    renderWeekGrid();
  }

  /* --------------------------------------------------------------------------
     Modales d'ajout (Tâche Backlog / Créneau Agenda)
     -------------------------------------------------------------------------- */
  function openEntryModal(type, prefill = {}) {
    const modal = document.getElementById("entry-modal");
    const titleEl = document.getElementById("entry-modal-title");
    const form = document.getElementById("entry-modal-form");
    form.dataset.entryType = type;

    if (type === "task") {
      titleEl.textContent = "Nouvelle tâche (Anti-Procrastination)";
      form.innerHTML = `
        <input type="text" name="title" class="input" placeholder="Ex: Réviser chapitre Thermodynamique" required />
        <input type="text" name="firstStep" class="input" placeholder="Première micro-action (< 5 min) : Ex: Ouvrir le TD 2" required />
        <div class="form-row-2">
          <select name="priority" class="input">
            <option value="p1">P1 · Urgent & Important</option>
            <option value="p2" selected>P2 · Important (À planifier)</option>
            <option value="p3">P3 · Tâche rapide</option>
          </select>
          <select name="durationMin" class="input">
            <option value="25">25 min (1 sprint)</option>
            <option value="45">45 min (Deep work)</option>
            <option value="60" selected>1h00</option>
            <option value="90">1h30</option>
            <option value="120">2h00</option>
          </select>
        </div>
        <button type="submit" class="btn btn--primary">Ajouter au backlog</button>
      `;
    } else if (type === "event") {
      const days = Engine.getWeekDays(state.selectedWeekMonday);
      const defaultDate = prefill.date || Engine.toIsoDate(new Date());
      const defaultStart = prefill.startTime || "18:00";
      const defaultEnd = prefill.endTime || Engine.addMinutesToTime(defaultStart, prefill.durationMin || 60);

      titleEl.textContent = "Bloquer un créneau sur l'agenda";
      form.innerHTML = `
        <input type="text" name="title" class="input" value="${escapeHtml(prefill.title || "")}" placeholder="Ex: Révisions Maths / Session Batch-Malin" required />
        <div class="form-row-2">
          <select name="date" class="input">
            ${days
              .map(
                (d) =>
                  `<option value="${d.iso}" ${d.iso === defaultDate ? "selected" : ""}>${d.dayName} ${d.shortDate}</option>`
              )
              .join("")}
          </select>
          <select name="category" class="input">
            <option value="work" ${prefill.category === "work" ? "selected" : ""}>Travail / Révisions</option>
            <option value="cours" ${prefill.category === "cours" ? "selected" : ""}>Cours / TD</option>
            <option value="batch" ${prefill.category === "batch" ? "selected" : ""}>Batch-Malin (Cuisine)</option>
            <option value="perso" ${prefill.category === "perso" ? "selected" : ""}>Perso / Sport</option>
          </select>
        </div>
        <div class="form-row-2">
          <input type="time" name="startTime" class="input" value="${defaultStart}" required />
          <input type="time" name="endTime" class="input" value="${defaultEnd}" required />
        </div>
        <button type="submit" class="btn btn--primary">Inscrire dans la semaine</button>
      `;
    }

    modal.classList.remove("hidden");
    const firstInput = form.querySelector("input");
    if (firstInput) firstInput.focus();
  }

  function closeEntryModal() {
    document.getElementById("entry-modal").classList.add("hidden");
  }

  /* --------------------------------------------------------------------------
     Passerelles : Batch-Malin + Import/Export Agenda iPhone (.ics)
     -------------------------------------------------------------------------- */
  async function syncBatchCookingSlot() {
    if (!global.EtudiantCore || !global.EtudiantCore.loadModuleData) return;
    try {
      const bmData = await global.EtudiantCore.loadModuleData("batch-malin");
      const durationMin = bmData && bmData.prefs && bmData.prefs.maxTime ? Number(bmData.prefs.maxTime) : 75;
      const days = Engine.getWeekDays(state.selectedWeekMonday);
      const sundayIso = days[6].iso; // Dimanche de la semaine affichée

      openEntryModal("event", {
        title: "Session Batch-Malin (Cuisine semaine)",
        date: sundayIso,
        startTime: "17:30",
        durationMin,
        category: "batch"
      });
      showToast(`Créneau préparé (${durationMin} min d'après Batch-Malin)`);
    } catch (err) {
      console.error(err);
      showToast("Impossible de lire le temps Batch-Malin");
    }
  }

  function handleIcsFileImport(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imported = Engine.parseIcsContent(String(reader.result || ""));
      if (!imported.length) {
        showToast("Aucun événement valide trouvé dans ce fichier .ics");
        return;
      }

      state.events.push(...imported);

      // Si aucun événement importé ne tombe dans la semaine affichée, sauter sur la semaine du premier événement
      const currentDays = new Set(Engine.getWeekDays(state.selectedWeekMonday).map((d) => d.iso));
      if (!imported.some((ev) => currentDays.has(ev.date))) {
        const [y, m, d] = imported[0].date.split("-").map(Number);
        state.selectedWeekMonday = Engine.getMondayOfWeek(new Date(y, m - 1, d));
      }

      renderWeekGrid();
      scheduleSync();
      showToast(`${imported.length} événement(s) importé(s) dans votre agenda`);
    };
    reader.readAsText(file, "UTF-8");
  }

  function exportWeekToIphoneIcs() {
    const daysSet = new Set(Engine.getWeekDays(state.selectedWeekMonday).map((d) => d.iso));
    const weekEvents = state.events.filter((ev) => daysSet.has(ev.date));

    if (!weekEvents.length) {
      showToast("Aucun créneau planifié cette semaine à exporter");
      return;
    }

    const icsContent = Engine.generateIcsContent(weekEvents);
    const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `orga-malin-${state.selectedWeekMonday}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Fichier .ics prêt — ouvrez-le sur iPhone pour l'ajouter à Calendrier");
  }

  /* --------------------------------------------------------------------------
     Écouteurs d'événements
     -------------------------------------------------------------------------- */
  function bindEvents() {
    document.getElementById("em-btn-logout").addEventListener("click", async () => {
      if (global.EtudiantCore && global.EtudiantCore.signOut) {
        await global.EtudiantCore.signOut();
      }
      window.location.href = "../../index.html";
    });

    document.getElementById("btn-prev-week").addEventListener("click", () => {
      state.selectedWeekMonday = Engine.shiftWeekIso(state.selectedWeekMonday, -1);
      renderWeekGrid();
    });

    document.getElementById("btn-next-week").addEventListener("click", () => {
      state.selectedWeekMonday = Engine.shiftWeekIso(state.selectedWeekMonday, 1);
      renderWeekGrid();
    });

    document.getElementById("btn-import-ics").addEventListener("click", () => {
      document.getElementById("input-ics-file").click();
    });

    document.getElementById("input-ics-file").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        handleIcsFileImport(file);
        e.target.value = "";
      }
    });

    document.getElementById("btn-export-ics").addEventListener("click", exportWeekToIphoneIcs);
    document.getElementById("btn-sync-batch-orga").addEventListener("click", syncBatchCookingSlot);

    // Contrôles Sas Anti-Procrastination
    document.getElementById("focus-mode-pills").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-focus-mode]");
      if (btn) switchFocusMode(btn.dataset.focusMode);
    });

    document.getElementById("btn-focus-toggle").addEventListener("click", () => {
      if (state.focus.isRunning) {
        stopFocusTimer();
        renderFocusCockpit();
      } else {
        startFocusTimer();
      }
    });

    document.getElementById("btn-focus-reset").addEventListener("click", () => {
      switchFocusMode(state.focus.mode);
    });

    document.getElementById("btn-focus-complete").addEventListener("click", () => {
      const task = state.tasks.find((t) => t.id === state.focus.activeTaskId);
      if (task) {
        task.done = true;
        state.focus.activeTaskId = null;
        stopFocusTimer();
        Engine.playCompletionChime();
        renderAll();
        scheduleSync();
        showToast("Tâche terminée !");
      }
    });

    document.getElementById("focus-first-step-input").addEventListener("input", (e) => {
      const task = state.tasks.find((t) => t.id === state.focus.activeTaskId);
      if (task) {
        task.firstStep = e.target.value;
        renderBacklog();
        scheduleSync();
      }
    });

    document.getElementById("btn-log-distraction").addEventListener("click", () => {
      state.focus.distractions += 1;
      renderFocusCockpit();
      showToast("Distraction notée — reste sur ta micro-action");
    });

    // Backlog & Semainier
    document.getElementById("btn-add-task").addEventListener("click", () => openEntryModal("task"));
    document.getElementById("btn-add-block").addEventListener("click", () => openEntryModal("event"));

    document.getElementById("backlog-filter-pills").addEventListener("click", (e) => {
      const pill = e.target.closest("[data-backlog-filter]");
      if (!pill) return;
      state.backlogFilter = pill.dataset.backlogFilter;
      document.querySelectorAll("#backlog-filter-pills .filter-pill").forEach((p) =>
        p.classList.toggle("is-active", p === pill)
      );
      renderBacklog();
    });

    document.getElementById("entry-modal-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      const type = form.dataset.entryType;
      const fd = new FormData(form);

      if (type === "task") {
        const newTask = {
          id: `t-${Date.now()}`,
          title: String(fd.get("title") || "").trim(),
          firstStep: String(fd.get("firstStep") || "").trim(),
          priority: fd.get("priority") || "p2",
          durationMin: Number(fd.get("durationMin")) || 60,
          done: false
        };
        state.tasks.unshift(newTask);
        if (!state.focus.activeTaskId) state.focus.activeTaskId = newTask.id;
      } else if (type === "event") {
        state.events.push({
          id: `ev-${Date.now()}`,
          title: String(fd.get("title") || "").trim(),
          date: String(fd.get("date") || ""),
          startTime: String(fd.get("startTime") || "18:00"),
          endTime: String(fd.get("endTime") || "19:00"),
          category: fd.get("category") || "work"
        });
      }

      closeEntryModal();
      renderAll();
      scheduleSync();
    });

    document.body.addEventListener("change", (e) => {
      const check = e.target.closest("[data-toggle-task]");
      if (check) {
        const task = state.tasks.find((t) => t.id === check.dataset.toggleTask);
        if (task) {
          task.done = check.checked;
          if (task.done && state.focus.activeTaskId === task.id) {
            state.focus.activeTaskId = null;
          }
          renderAll();
          scheduleSync();
        }
      }
    });

    document.body.addEventListener("click", (e) => {
      const focusBtn = e.target.closest("[data-focus-task]");
      if (focusBtn) {
        state.focus.activeTaskId = focusBtn.dataset.focusTask;
        state.focus.distractions = 0;
        switchFocusMode("ignition");
        showToast("Cible verrouillée — lance les 5 minutes d'amorçage");
        return;
      }

      const planBtn = e.target.closest("[data-plan-task]");
      if (planBtn) {
        const task = state.tasks.find((t) => t.id === planBtn.dataset.planTask);
        if (task) {
          openEntryModal("event", {
            title: task.title,
            durationMin: task.durationMin || 60,
            category: "work"
          });
        }
        return;
      }

      const delTask = e.target.closest("[data-del-task]");
      if (delTask) {
        const id = delTask.dataset.delTask;
        state.tasks = state.tasks.filter((t) => t.id !== id);
        if (state.focus.activeTaskId === id) state.focus.activeTaskId = null;
        renderAll();
        scheduleSync();
        return;
      }

      const delEvent = e.target.closest("[data-del-event]");
      if (delEvent) {
        state.events = state.events.filter((ev) => ev.id !== delEvent.dataset.delEvent);
        renderWeekGrid();
        scheduleSync();
        return;
      }

      if (e.target.closest("[data-close-modal]")) closeEntryModal();
    });
  }

  /* --------------------------------------------------------------------------
     Initialisation avec garde d'authentification
     -------------------------------------------------------------------------- */
  async function init() {
    if (!global.EtudiantCore || !global.EtudiantCore.getCurrentUser) {
      window.location.href = "../../index.html";
      return;
    }

    const user = await global.EtudiantCore.getCurrentUser();
    if (!user) {
      window.location.href = "../../index.html";
      return;
    }

    state.currentUser = user;
    document.getElementById("em-user-email").textContent = user.email;

    if (state.tasks.length && !state.focus.activeTaskId) {
      state.focus.activeTaskId = state.tasks[0].id;
    }

    bindEvents();
    await loadFromCloud();
    if (!state.focus.activeTaskId) {
      const firstOpen = state.tasks.find((t) => !t.done);
      if (firstOpen) state.focus.activeTaskId = firstOpen.id;
    }
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})(window);