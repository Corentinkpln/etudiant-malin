/**
 * Budget Malin V1.0 — Contrôleur UI & Synchronisation Cloud (budget-app.js)
 */
(function (global) {
  "use strict";

  const Engine = global.BudgetEngine;

  const state = {
    currentUser: null,
    syncTimer: null,
    selectedMonth: Engine.getCurrentMonthKey(),
    visibleKpis: ["reste_total", "reste_jour", "solde_parents", "solde_perso"],
    months: {},
    reportOptions: {
      onlyParents: true,
      showSummary: true,
      showFixed: true,
      showEnvelopes: true,
      showDetails: false,
      customNote: ""
    }
  };

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatEuro(val) {
    return `${Number(val || 0).toFixed(2).replace(".", ",")} €`;
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
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 3000);
  }

  function getActiveMonthData() {
    if (!state.months[state.selectedMonth]) {
      const existingKeys = Object.keys(state.months).sort();
      if (existingKeys.length > 0) {
        const latestKey = existingKeys[existingKeys.length - 1];
        state.months[state.selectedMonth] = Engine.cloneMonthForNextPeriod(state.months[latestKey]);
      } else {
        state.months[state.selectedMonth] = Engine.createPresetMonth("parents_support");
        state.months[state.selectedMonth].presetApplied = false;
      }
    }
    return state.months[state.selectedMonth];
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
        await global.EtudiantCore.saveModuleData("budget-malin", {
          visibleKpis: state.visibleKpis,
          months: state.months,
          reportOptions: state.reportOptions
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
      const data = await global.EtudiantCore.loadModuleData("budget-malin");
      if (data && typeof data === "object") {
        if (Array.isArray(data.visibleKpis) && data.visibleKpis.length) {
          state.visibleKpis = data.visibleKpis;
        }
        if (data.months && typeof data.months === "object") {
          state.months = data.months;
        }
        if (data.reportOptions && typeof data.reportOptions === "object") {
          state.reportOptions = { ...state.reportOptions, ...data.reportOptions };
        }
      }
      setSyncIndicator("ok", "Synchronisé ✓");
    } catch (err) {
      console.error(err);
      setSyncIndicator("error", "Mode hors-ligne");
    }
  }

  /* --------------------------------------------------------------------------
     Rendu Global de l'interface
     -------------------------------------------------------------------------- */
  function renderAll() {
    const monthData = getActiveMonthData();
    const summary = Engine.computeMonthSummary(monthData, state.selectedMonth);

    document.getElementById("current-month-label").textContent = Engine.formatMonthLabel(state.selectedMonth);
    document.getElementById("preset-banner").classList.toggle("hidden", Boolean(monthData.presetApplied));

    renderKpiCustomizer();
    renderKpiGrid(summary);
    renderLedgerLists(monthData);
    renderChart(summary);
    renderEnvelopes(monthData);
  }

  function renderKpiCustomizer() {
    const container = document.getElementById("kpi-toggles-list");
    container.innerHTML = Engine.KPI_DEFINITIONS.map((kpi) => {
      const checked = state.visibleKpis.includes(kpi.id) ? "checked" : "";
      return `
        <label class="chip-toggle">
          <input type="checkbox" data-toggle-kpi="${kpi.id}" ${checked} />
          <span>${escapeHtml(kpi.label)}</span>
        </label>
      `;
    }).join("");
  }

  function renderKpiGrid(summary) {
    const grid = document.getElementById("kpi-grid");
    const cardsMap = {
      reste_total: () => `
        <article class="kpi-card">
          <div class="kpi-card__top">
            <span class="kpi-card__label">Reste à vivre global</span>
            <span class="pill ${summary.remainingTotal >= 0 ? "pill--green" : "pill--red"}">
              ${summary.remainingTotal >= 0 ? "Équilibré" : "Déficit"}
            </span>
          </div>
          <div class="kpi-card__value">${formatEuro(summary.remainingTotal)}</div>
          <div class="kpi-card__sub">Revenus ${formatEuro(summary.totalIncome)} − Dépenses ${formatEuro(summary.totalSpent)}</div>
        </article>
      `,
      reste_jour: () => `
        <article class="kpi-card">
          <div class="kpi-card__top">
            <span class="kpi-card__label">Budget / jour restant</span>
            <span class="pill pill--orange">${summary.remainingDays > 0 ? `${summary.remainingDays} j restants` : "Clôturé"}</span>
          </div>
          <div class="kpi-card__value">${summary.remainingDays > 0 ? `${formatEuro(summary.remainingPerDay)} / j` : "—"}</div>
          <div class="kpi-card__sub">Pour tenir jusqu'à la fin du mois</div>
        </article>
      `,
      solde_parents: () => `
        <article class="kpi-card">
          <div class="kpi-card__top">
            <span class="kpi-card__label">Enveloppe Parents</span>
            <span class="pill pill--purple">Reçu : ${formatEuro(summary.incomeParents)}</span>
          </div>
          <div class="kpi-card__value">${formatEuro(summary.remainingParents)}</div>
          <div class="kpi-card__sub">Dépensé sur part parents : ${formatEuro(summary.fixedParents + summary.variableParents)}</div>
        </article>
      `,
      solde_perso: () => `
        <article class="kpi-card">
          <div class="kpi-card__top">
            <span class="kpi-card__label">Enveloppe Perso</span>
            <span class="pill pill--green">Reçu : ${formatEuro(summary.incomePerso)}</span>
          </div>
          <div class="kpi-card__value">${formatEuro(summary.remainingPerso)}</div>
          <div class="kpi-card__sub">Dépensé sur part perso : ${formatEuro(summary.fixedPerso + summary.variablePerso)}</div>
        </article>
      `,
      poids_fixes: () => `
        <article class="kpi-card">
          <div class="kpi-card__top">
            <span class="kpi-card__label">Poids des charges fixes</span>
            <span class="pill ${summary.fixedRatio <= 60 ? "pill--green" : "pill--orange"}">${summary.fixedRatio} %</span>
          </div>
          <div class="kpi-card__value">${formatEuro(summary.totalFixed)}</div>
          <div class="kpi-card__sub">Part incompressible de tes revenus</div>
        </article>
      `,
      taux_epargne: () => `
        <article class="kpi-card">
          <div class="kpi-card__top">
            <span class="kpi-card__label">Solde net fin de mois</span>
            <span class="pill pill--green">Épargne potentielle</span>
          </div>
          <div class="kpi-card__value">${formatEuro(Math.max(0, summary.remainingTotal))}</div>
          <div class="kpi-card__sub">Disponible à mettre de côté</div>
        </article>
      `
    };

    grid.innerHTML = state.visibleKpis
      .filter((id) => cardsMap[id])
      .map((id) => cardsMap[id]())
      .join("");
  }

  function renderLedgerLists(monthData) {
    const incList = document.getElementById("incomes-list");
    incList.innerHTML = (monthData.incomes || []).length
      ? monthData.incomes
          .map(
            (inc) => `
          <li class="ledger-row">
            <div class="ledger-row__info">
              <span class="ledger-row__name">${escapeHtml(inc.label)}</span>
              <span class="pill ${inc.source === "parents" ? "pill--purple" : "pill--green"}">
                ${inc.source === "parents" ? "Parents" : "Perso"}
              </span>
            </div>
            <div class="ledger-row__right">
              <span class="ledger-row__amount" style="color: var(--green);">+${formatEuro(inc.amount)}</span>
              <button type="button" class="btn--icon-danger" data-del-income="${inc.id}" title="Supprimer">×</button>
            </div>
          </li>
        `
          )
          .join("")
      : `<li style="font-size: 0.84rem; color: var(--text-secondary);">Aucune ressource ajoutée ce mois-ci.</li>`;

    const fixList = document.getElementById("fixed-list");
    fixList.innerHTML = (monthData.fixedCharges || []).length
      ? monthData.fixedCharges
          .map(
            (fix) => `
          <li class="ledger-row">
            <div class="ledger-row__info">
              <span class="ledger-row__name">${escapeHtml(fix.label)}</span>
              <span class="pill ${fix.fundedBy === "parents" ? "pill--purple" : "pill--green"}">
                ${fix.fundedBy === "parents" ? "Part Parents" : "Part Perso"}
              </span>
            </div>
            <div class="ledger-row__right">
              <span class="ledger-row__amount">-${formatEuro(fix.amount)}</span>
              <button type="button" class="btn--icon-danger" data-del-fixed="${fix.id}" title="Supprimer">×</button>
            </div>
          </li>
        `
          )
          .join("")
      : `<li style="font-size: 0.84rem; color: var(--text-secondary);">Aucune charge fixe ce mois-ci.</li>`;
  }

  function renderChart(summary) {
    const container = document.getElementById("chart-container");
    const svg = Engine.buildDonutSvg(summary.categoryBreakdown, summary.totalSpent);

    const legendHtml = summary.categoryBreakdown.length
      ? summary.categoryBreakdown
          .map(
            (item) => `
          <div class="legend-row">
            <span><i class="legend-dot" style="background: ${item.color};"></i>${escapeHtml(item.label)}</span>
            <strong>${formatEuro(item.amount)}</strong>
          </div>
        `
          )
          .join("")
      : `<p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">Ajoute une charge ou une dépense pour voir la répartition graphique.</p>`;

    container.innerHTML = `
      <div class="donut-wrap">
        ${svg}
        <div class="donut-center">
          <strong>${formatEuro(summary.totalSpent)}</strong>
          <span>Total dépensé</span>
        </div>
      </div>
      <div class="chart-legend">${legendHtml}</div>
    `;
  }

  function renderEnvelopes(monthData) {
    const grid = document.getElementById("envelopes-grid");
    const envelopes = monthData.envelopes || [];

    if (!envelopes.length) {
      grid.innerHTML = `<div class="card" style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary);">Aucune enveloppe créée. Clique sur <strong>« + Nouvelle enveloppe »</strong>.</div>`;
      return;
    }

    grid.innerHTML = envelopes
      .map((env) => {
        const spent = Engine.getEnvelopeSpent(env);
        const target = Math.max(1, Number(env.target) || 1);
        const pct = Math.min(100, Math.round((spent / target) * 100));
        const isOver = spent > Number(env.target);
        const barColor = isOver ? "var(--red)" : env.fundedBy === "parents" ? "var(--purple)" : "var(--accent)";

        const bodyHtml =
          env.mode === "global"
            ? `
              <div class="global-input-row">
                <label style="font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap;">Total dépensé (€) :</label>
                <input type="number" step="0.01" min="0" class="input" data-global-spent="${env.id}" value="${Number(env.manualSpent) || 0}" />
              </div>
            `
            : `
              <ul class="tx-mini-list">
                ${
                  (env.transactions || []).length
                    ? env.transactions
                        .map(
                          (tx) => `
                        <li class="tx-mini-item">
                          <span>${escapeHtml(tx.label)} <small style="color: var(--text-secondary);">(${escapeHtml(tx.date || "")})</small></span>
                          <span>
                            <strong>${formatEuro(tx.amount)}</strong>
                            <button type="button" class="btn--icon-danger" data-del-tx="${env.id}:${tx.id}" title="Supprimer">×</button>
                          </span>
                        </li>
                      `
                        )
                        .join("")
                    : `<li style="font-size: 0.8rem; color: var(--text-secondary);">Aucune dépense saisie.</li>`
                }
              </ul>
              <button type="button" class="btn btn--subtle btn--sm" data-add-tx="${env.id}" style="align-self: flex-start;">
                + Saisir une dépense
              </button>
            `;

        return `
          <article class="env-card">
            <div class="env-card__head">
              <div>
                <div class="env-card__title">
                  ${escapeHtml(env.name)}
                  <span class="pill ${env.fundedBy === "parents" ? "pill--purple" : "pill--green"}">
                    ${env.fundedBy === "parents" ? "Parents" : "Perso"}
                  </span>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 4px;">
                <div class="mode-switch" title="Choisir le mode de suivi">
                  <button type="button" class="${env.mode === "detailed" ? "is-active" : ""}" data-env-mode="${env.id}:detailed">Détail</button>
                  <button type="button" class="${env.mode === "global" ? "is-active" : ""}" data-env-mode="${env.id}:global">Total</button>
                </div>
                <button type="button" class="btn--icon-danger" data-del-env="${env.id}" title="Supprimer l'enveloppe">×</button>
              </div>
            </div>

            <div class="env-progress">
              <div class="env-progress__fill" style="width: ${pct}%; background: ${barColor};"></div>
            </div>

            <div class="env-numbers">
              <span>Dépensé : <strong>${formatEuro(spent)}</strong></span>
              <span>Objectif : <strong>${formatEuro(env.target)}</strong></span>
            </div>

            ${bodyHtml}
          </article>
        `;
      })
      .join("");
  }

  /* --------------------------------------------------------------------------
     Modales d'ajout (Revenu, Charge fixe, Enveloppe, Dépense unitaire)
     -------------------------------------------------------------------------- */
  function openEntryModal(type, envelopeId = null) {
    const modal = document.getElementById("entry-modal");
    const titleEl = document.getElementById("entry-modal-title");
    const form = document.getElementById("entry-modal-form");
    form.dataset.entryType = type;
    form.dataset.envelopeId = envelopeId || "";

    if (type === "income") {
      titleEl.textContent = "Ajouter une ressource";
      form.innerHTML = `
        <input type="text" name="label" class="input" placeholder="Ex: Virement Parents, Bourse, Cours..." required />
        <div class="form-row-2">
          <input type="number" name="amount" step="0.01" min="0.01" class="input" placeholder="Montant (€)" required />
          <select name="source" class="input">
            <option value="parents">Argent Parents</option>
            <option value="perso">Argent Perso</option>
          </select>
        </div>
        <label class="report-check"><input type="checkbox" name="recurring" checked /> Reconduire automatiquement chaque mois</label>
        <button type="submit" class="btn btn--primary">Enregistrer</button>
      `;
    } else if (type === "fixed") {
      titleEl.textContent = "Ajouter une charge fixe";
      form.innerHTML = `
        <input type="text" name="label" class="input" placeholder="Ex: Loyer, Électricité, Internet, Navigo..." required />
        <div class="form-row-2">
          <input type="number" name="amount" step="0.01" min="0.01" class="input" placeholder="Montant (€)" required />
          <select name="fundedBy" class="input">
            <option value="parents">Financé par Parents</option>
            <option value="perso">Financé en Perso</option>
          </select>
        </div>
        <label class="report-check"><input type="checkbox" name="recurring" checked /> Reconduire automatiquement chaque mois</label>
        <button type="submit" class="btn btn--primary">Enregistrer</button>
      `;
    } else if (type === "envelope") {
      titleEl.textContent = "Créer une enveloppe modulable";
      form.innerHTML = `
        <input type="text" name="name" class="input" placeholder="Ex: Courses, Sport, Transport, Livres..." required />
        <div class="form-row-2">
          <input type="number" name="target" step="1" min="1" class="input" placeholder="Budget mensuel cible (€)" required />
          <select name="fundedBy" class="input">
            <option value="parents">Financé par Parents</option>
            <option value="perso">Financé en Perso</option>
          </select>
        </div>
        <select name="mode" class="input">
          <option value="detailed">Mode détaillé (saisir mes dépenses une par une)</option>
          <option value="global">Mode global (saisir juste le total mensuel)</option>
        </select>
        <button type="submit" class="btn btn--primary">Créer l'enveloppe</button>
      `;
    } else if (type === "tx") {
      const today = new Date().toISOString().slice(0, 10);
      titleEl.textContent = "Ajouter une dépense";
      form.innerHTML = `
        <input type="text" name="label" class="input" placeholder="Ex: Courses Lidl, Pharmacie, Billet train..." required />
        <div class="form-row-2">
          <input type="number" name="amount" step="0.01" min="0.01" class="input" placeholder="Montant (€)" required />
          <input type="date" name="date" class="input" value="${today}" />
        </div>
        <button type="submit" class="btn btn--primary">Ajouter la dépense</button>
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
     Studio Fiche Récap Parents (Aperçu temps réel)
     -------------------------------------------------------------------------- */
  function renderParentReportSheet() {
    const monthData = getActiveMonthData();
    const summary = Engine.computeMonthSummary(monthData, state.selectedMonth);
    const opts = state.reportOptions;
    const sheet = document.getElementById("parent-report-sheet");

    const scopeIncome = opts.onlyParents ? summary.incomeParents : summary.totalIncome;
    const scopeSpent = opts.onlyParents
      ? summary.fixedParents + summary.variableParents
      : summary.totalSpent;
    const scopeBalance = scopeIncome - scopeSpent;

    let html = `
      <div class="report-sheet__head">
        <div>
          <span style="font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary);">Étudiant-Malin · Relevé mensuel</span>
          <h3 style="margin: 2px 0 0; font-size: 1.3rem; text-transform: capitalize;">${escapeHtml(Engine.formatMonthLabel(state.selectedMonth))}</h3>
        </div>
        <span class="pill ${opts.onlyParents ? "pill--purple" : "pill--green"}">
          ${opts.onlyParents ? "Périmètre : Budget Parents" : "Périmètre : Budget Complet"}
        </span>
      </div>
    `;

    if (opts.showSummary) {
      html += `
        <div class="report-kpis">
          <div class="report-kpi-box">
            <span>Ressources allouées</span>
            <strong>${formatEuro(scopeIncome)}</strong>
          </div>
          <div class="report-kpi-box">
            <span>Dépenses du mois</span>
            <strong>${formatEuro(scopeSpent)}</strong>
          </div>
          <div class="report-kpi-box">
            <span>Solde restant</span>
            <strong style="color: ${scopeBalance >= 0 ? "var(--green)" : "var(--red)"};">${formatEuro(scopeBalance)}</strong>
          </div>
        </div>
      `;
    }

    if (opts.showFixed) {
      const charges = (monthData.fixedCharges || []).filter(
        (f) => !opts.onlyParents || f.fundedBy === "parents"
      );
      if (charges.length) {
        html += `
          <h4 style="margin: 12px 0 6px; font-size: 0.9rem;">Charges fixes</h4>
          <table class="report-table">
            <thead><tr><th>Libellé</th><th>Financement</th><th>Montant</th></tr></thead>
            <tbody>
              ${charges
                .map(
                  (f) => `
                <tr>
                  <td>${escapeHtml(f.label)}</td>
                  <td>${f.fundedBy === "parents" ? "Parents" : "Perso"}</td>
                  <td><strong>${formatEuro(f.amount)}</strong></td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        `;
      }
    }

    if (opts.showEnvelopes) {
      const envs = (monthData.envelopes || []).filter(
        (e) => !opts.onlyParents || e.fundedBy === "parents"
      );
      if (envs.length) {
        html += `
          <h4 style="margin: 12px 0 6px; font-size: 0.9rem;">Dépenses courantes par catégorie</h4>
          <table class="report-table">
            <thead><tr><th>Catégorie</th><th>Budget prévu</th><th>Réel dépensé</th></tr></thead>
            <tbody>
              ${envs
                .map((e) => {
                  const spent = Engine.getEnvelopeSpent(e);
                  let detailRows = "";
                  if (opts.showDetails && e.mode === "detailed" && (e.transactions || []).length) {
                    detailRows = e.transactions
                      .map(
                        (tx) => `
                      <tr style="color: var(--text-secondary); font-size: 0.78rem;">
                        <td colspan="2" style="padding-left: 18px;">↳ ${escapeHtml(tx.date || "")} · ${escapeHtml(tx.label)}</td>
                        <td>${formatEuro(tx.amount)}</td>
                      </tr>
                    `
                      )
                      .join("");
                  }
                  return `
                    <tr>
                      <td>${escapeHtml(e.name)}</td>
                      <td>${formatEuro(e.target)}</td>
                      <td><strong>${formatEuro(spent)}</strong></td>
                    </tr>
                    ${detailRows}
                  `;
                })
                .join("")}
            </tbody>
          </table>
        `;
      }
    }

    if (opts.customNote && opts.customNote.trim()) {
      html += `
        <div style="margin-top: 14px; padding: 12px 14px; background: #f5f5f7; border-radius: 12px; font-size: 0.85rem;">
          <strong>Note :</strong> ${escapeHtml(opts.customNote.trim())}
        </div>
      `;
    }

    sheet.innerHTML = html;
  }

  function openParentReportModal() {
    document.getElementById("rep-only-parents").checked = state.reportOptions.onlyParents;
    document.getElementById("rep-show-summary").checked = state.reportOptions.showSummary;
    document.getElementById("rep-show-fixed").checked = state.reportOptions.showFixed;
    document.getElementById("rep-show-envelopes").checked = state.reportOptions.showEnvelopes;
    document.getElementById("rep-show-details").checked = state.reportOptions.showDetails;
    document.getElementById("rep-custom-note").value = state.reportOptions.customNote || "";

    renderParentReportSheet();
    document.getElementById("parent-report-modal").classList.remove("hidden");
  }

  /* --------------------------------------------------------------------------
     Intégration inter-modules : Lecture du budget courses Batch-Malin
     -------------------------------------------------------------------------- */
  async function syncFromBatchMalin() {
    if (!global.EtudiantCore || !global.EtudiantCore.loadModuleData) return;
    try {
      const bmData = await global.EtudiantCore.loadModuleData("batch-malin");
      if (!bmData || !bmData.prefs) {
        showToast("Aucun plan Batch-Malin trouvé sur ton compte");
        return;
      }

      const weeklyBudget = Number(bmData.prefs.budget) || 35;
      const days = Math.max(1, Number(bmData.prefs.days) || 5);
      const monthlyEstimate = Math.round((weeklyBudget / days) * 30);

      const monthData = getActiveMonthData();
      let foodEnv = (monthData.envelopes || []).find((e) =>
        e.name.toLowerCase().includes("course") || e.name.toLowerCase().includes("aliment")
      );

      if (foodEnv) {
        foodEnv.target = monthlyEstimate;
      } else {
        monthData.envelopes.unshift({
          id: `env-${Date.now()}`,
          name: "Courses (Batch-Malin)",
          target: monthlyEstimate,
          fundedBy: "parents",
          mode: "detailed",
          manualSpent: 0,
          transactions: []
        });
      }

      renderAll();
      scheduleSync();
      showToast(`Objectif Courses ajusté à ${monthlyEstimate} €/mois d'après Batch-Malin`);
    } catch (err) {
      console.error(err);
      showToast("Impossible de lire les données Batch-Malin");
    }
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

    document.getElementById("btn-prev-month").addEventListener("click", () => {
      state.selectedMonth = Engine.shiftMonthKey(state.selectedMonth, -1);
      renderAll();
    });

    document.getElementById("btn-next-month").addEventListener("click", () => {
      state.selectedMonth = Engine.shiftMonthKey(state.selectedMonth, 1);
      renderAll();
      scheduleSync();
    });

    document.getElementById("btn-toggle-kpi-panel").addEventListener("click", () => {
      document.getElementById("kpi-customizer").classList.toggle("hidden");
    });

    document.getElementById("btn-close-kpi-panel").addEventListener("click", () => {
      document.getElementById("kpi-customizer").classList.add("hidden");
    });

    document.getElementById("btn-sync-batch").addEventListener("click", syncFromBatchMalin);
    document.getElementById("btn-open-parent-report").addEventListener("click", openParentReportModal);

    document.getElementById("btn-add-income").addEventListener("click", () => openEntryModal("income"));
    document.getElementById("btn-add-fixed").addEventListener("click", () => openEntryModal("fixed"));
    document.getElementById("btn-add-envelope").addEventListener("click", () => openEntryModal("envelope"));

    document.getElementById("entry-modal-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      const type = form.dataset.entryType;
      const fd = new FormData(form);
      const monthData = getActiveMonthData();
      monthData.presetApplied = true;

      if (type === "income") {
        monthData.incomes.push({
          id: `inc-${Date.now()}`,
          label: String(fd.get("label") || "").trim(),
          amount: Math.max(0, parseFloat(fd.get("amount")) || 0),
          source: fd.get("source") || "parents",
          recurring: fd.get("recurring") === "on"
        });
      } else if (type === "fixed") {
        monthData.fixedCharges.push({
          id: `fix-${Date.now()}`,
          label: String(fd.get("label") || "").trim(),
          amount: Math.max(0, parseFloat(fd.get("amount")) || 0),
          fundedBy: fd.get("fundedBy") || "parents",
          recurring: fd.get("recurring") === "on"
        });
      } else if (type === "envelope") {
        monthData.envelopes.push({
          id: `env-${Date.now()}`,
          name: String(fd.get("name") || "").trim(),
          target: Math.max(1, parseFloat(fd.get("target")) || 50),
          fundedBy: fd.get("fundedBy") || "parents",
          mode: fd.get("mode") || "detailed",
          manualSpent: 0,
          transactions: []
        });
      } else if (type === "tx") {
        const env = monthData.envelopes.find((item) => item.id === form.dataset.envelopeId);
        if (env) {
          env.transactions = env.transactions || [];
          env.transactions.unshift({
            id: `tx-${Date.now()}`,
            label: String(fd.get("label") || "").trim(),
            amount: Math.max(0.01, parseFloat(fd.get("amount")) || 0),
            date: String(fd.get("date") || "")
          });
        }
      }

      closeEntryModal();
      renderAll();
      scheduleSync();
    });

    // Mise à jour en direct dans le Studio Fiche Parents
    ["rep-only-parents", "rep-show-summary", "rep-show-fixed", "rep-show-envelopes", "rep-show-details"].forEach((id) => {
      document.getElementById(id).addEventListener("change", () => {
        state.reportOptions.onlyParents = document.getElementById("rep-only-parents").checked;
        state.reportOptions.showSummary = document.getElementById("rep-show-summary").checked;
        state.reportOptions.showFixed = document.getElementById("rep-show-fixed").checked;
        state.reportOptions.showEnvelopes = document.getElementById("rep-show-envelopes").checked;
        state.reportOptions.showDetails = document.getElementById("rep-show-details").checked;
        renderParentReportSheet();
        scheduleSync();
      });
    });

    document.getElementById("rep-custom-note").addEventListener("input", (e) => {
      state.reportOptions.customNote = e.target.value;
      renderParentReportSheet();
      scheduleSync();
    });

    document.getElementById("btn-copy-report").addEventListener("click", async () => {
      const monthData = getActiveMonthData();
      const summary = Engine.computeMonthSummary(monthData, state.selectedMonth);
      const txt = Engine.formatReportAsPlainText(state.selectedMonth, monthData, summary, state.reportOptions);
      try {
        await navigator.clipboard.writeText(txt);
        showToast("Récapitulatif copié (prêt pour WhatsApp / Mail)");
      } catch {
        showToast("Copie impossible sur ce navigateur");
      }
    });

    document.getElementById("btn-download-report-txt").addEventListener("click", () => {
      const monthData = getActiveMonthData();
      const summary = Engine.computeMonthSummary(monthData, state.selectedMonth);
      const txt = Engine.formatReportAsPlainText(state.selectedMonth, monthData, summary, state.reportOptions);
      const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recap-budget-${state.selectedMonth}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById("btn-print-report").addEventListener("click", () => {
      window.print();
    });

    // Délégation des clics et saisies dynamiques
    document.body.addEventListener("change", (e) => {
      const kpiToggle = e.target.closest("[data-toggle-kpi]");
      if (kpiToggle) {
        const id = kpiToggle.dataset.toggleKpi;
        if (kpiToggle.checked) {
          if (!state.visibleKpis.includes(id)) state.visibleKpis.push(id);
        } else if (state.visibleKpis.length > 1) {
          state.visibleKpis = state.visibleKpis.filter((k) => k !== id);
        } else {
          kpiToggle.checked = true;
          showToast("Garde au moins un chiffre clé affiché");
        }
        renderAll();
        scheduleSync();
      }
    });

    document.body.addEventListener("input", (e) => {
      const globalInput = e.target.closest("[data-global-spent]");
      if (globalInput) {
        const envId = globalInput.dataset.globalSpent;
        const env = getActiveMonthData().envelopes.find((item) => item.id === envId);
        if (env) {
          env.manualSpent = Math.max(0, parseFloat(globalInput.value) || 0);
          const summary = Engine.computeMonthSummary(getActiveMonthData(), state.selectedMonth);
          renderKpiGrid(summary);
          renderChart(summary);
          scheduleSync();
        }
      }
    });

    document.body.addEventListener("click", (e) => {
      const presetBtn = e.target.closest("[data-apply-preset]");
      if (presetBtn) {
        state.months[state.selectedMonth] = Engine.createPresetMonth(presetBtn.dataset.applyPreset);
        renderAll();
        scheduleSync();
        showToast("Profil appliqué ! Tout reste modifiable à la carte.");
        return;
      }

      const delInc = e.target.closest("[data-del-income]");
      if (delInc) {
        const m = getActiveMonthData();
        m.incomes = m.incomes.filter((i) => i.id !== delInc.dataset.delIncome);
        renderAll();
        scheduleSync();
        return;
      }

      const delFix = e.target.closest("[data-del-fixed]");
      if (delFix) {
        const m = getActiveMonthData();
        m.fixedCharges = m.fixedCharges.filter((f) => f.id !== delFix.dataset.delFixed);
        renderAll();
        scheduleSync();
        return;
      }

      const delEnv = e.target.closest("[data-del-env]");
      if (delEnv) {
        const m = getActiveMonthData();
        m.envelopes = m.envelopes.filter((item) => item.id !== delEnv.dataset.delEnv);
        renderAll();
        scheduleSync();
        return;
      }

      const modeBtn = e.target.closest("[data-env-mode]");
      if (modeBtn) {
        const [envId, newMode] = modeBtn.dataset.envMode.split(":");
        const env = getActiveMonthData().envelopes.find((item) => item.id === envId);
        if (env) {
          env.mode = newMode;
          renderAll();
          scheduleSync();
        }
        return;
      }

      const addTxBtn = e.target.closest("[data-add-tx]");
      if (addTxBtn) {
        openEntryModal("tx", addTxBtn.dataset.addTx);
        return;
      }

      const delTxBtn = e.target.closest("[data-del-tx]");
      if (delTxBtn) {
        const [envId, txId] = delTxBtn.dataset.delTx.split(":");
        const env = getActiveMonthData().envelopes.find((item) => item.id === envId);
        if (env) {
          env.transactions = (env.transactions || []).filter((t) => t.id !== txId);
          renderAll();
          scheduleSync();
        }
        return;
      }

      if (e.target.closest("[data-close-modal]")) closeEntryModal();
      if (e.target.closest("[data-close-report]")) {
        document.getElementById("parent-report-modal").classList.add("hidden");
      }
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

    bindEvents();
    await loadFromCloud();
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})(window);