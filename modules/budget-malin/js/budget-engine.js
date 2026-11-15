/**
 * Budget Malin V1.0 — Moteur de calcul & de modélisation (budget-engine.js)
 * Gère : séparation Parents / Perso, enveloppes polymorphiques (détaillé vs global),
 * reconduction mensuelle automatique et génération de la fiche récapitulative parents.
 */
(function (global) {
  "use strict";

  const KPI_DEFINITIONS = [
    { id: "reste_total", label: "Reste à vivre global" },
    { id: "reste_jour", label: "Budget / jour restant" },
    { id: "solde_parents", label: "Enveloppe Parents" },
    { id: "solde_perso", label: "Enveloppe Perso" },
    { id: "poids_fixes", label: "Poids charges fixes" },
    { id: "taux_epargne", label: "Solde net fin de mois" }
  ];

  const PALETTE = ["#0071e3", "#34c759", "#ff9500", "#5856d6", "#ff2d55", "#00c7be"];

  function getCurrentMonthKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  function shiftMonthKey(monthKey, delta) {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function formatMonthLabel(monthKey) {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  }

  function getRemainingDaysInMonth(monthKey) {
    const now = new Date();
    const currentKey = getCurrentMonthKey();
    const [y, m] = monthKey.split("-").map(Number);
    const totalDays = new Date(y, m, 0).getDate();

    if (monthKey < currentKey) return 0; // Mois passé
    if (monthKey > currentKey) return totalDays; // Mois futur
    return Math.max(1, totalDays - now.getDate() + 1);
  }

  function createPresetMonth(presetName) {
    if (presetName === "parents_support") {
      return {
        presetApplied: true,
        incomes: [
          { id: "inc-1", label: "Virement mensuel Parents", amount: 450, source: "parents", recurring: true },
          { id: "inc-2", label: "Job étudiant / Cours particuliers", amount: 180, source: "perso", recurring: true }
        ],
        fixedCharges: [
          { id: "fix-1", label: "Loyer (part restante)", amount: 150, fundedBy: "parents", recurring: true },
          { id: "fix-2", label: "Électricité & Internet", amount: 45, fundedBy: "parents", recurring: true },
          { id: "fix-3", label: "Transport & Téléphone", amount: 35, fundedBy: "perso", recurring: true }
        ],
        envelopes: [
          { id: "env-courses", name: "Courses & Alimentation", target: 160, fundedBy: "parents", mode: "detailed", manualSpent: 0, transactions: [] },
          { id: "env-sorties", name: "Sorties & Loisirs", target: 90, fundedBy: "perso", mode: "global", manualSpent: 0, transactions: [] },
          { id: "env-imprevus", name: "Santé & Imprévus", target: 50, fundedBy: "parents", mode: "detailed", manualSpent: 0, transactions: [] }
        ]
      };
    }

    if (presetName === "independent") {
      return {
        presetApplied: true,
        incomes: [
          { id: "inc-1", label: "Bourse CROUS / APL", amount: 420, source: "perso", recurring: true },
          { id: "inc-2", label: "Revenus perso / Job", amount: 380, source: "perso", recurring: true }
        ],
        fixedCharges: [
          { id: "fix-1", label: "Loyer", amount: 440, fundedBy: "perso", recurring: true },
          { id: "fix-2", label: "Électricité & Assurance", amount: 55, fundedBy: "perso", recurring: true },
          { id: "fix-3", label: "Forfait mobile & Transports", amount: 30, fundedBy: "perso", recurring: true }
        ],
        envelopes: [
          { id: "env-courses", name: "Courses & Batch Cooking", target: 140, fundedBy: "perso", mode: "detailed", manualSpent: 0, transactions: [] },
          { id: "env-perso", name: "Vie quotidienne & Sorties", target: 80, fundedBy: "perso", mode: "global", manualSpent: 0, transactions: [] }
        ]
      };
    }

    // Profil minimaliste (tout en saisie globale rapide)
    return {
      presetApplied: true,
      incomes: [
        { id: "inc-1", label: "Budget mensuel total", amount: 600, source: "parents", recurring: true }
      ],
      fixedCharges: [
        { id: "fix-1", label: "Charges fixes globales", amount: 250, fundedBy: "parents", recurring: true }
      ],
      envelopes: [
        { id: "env-courses", name: "Courses", target: 150, fundedBy: "parents", mode: "global", manualSpent: 0, transactions: [] },
        { id: "env-divers", name: "Dépenses courantes", target: 120, fundedBy: "perso", mode: "global", manualSpent: 0, transactions: [] }
      ]
    };
  }

  function cloneMonthForNextPeriod(templateMonth) {
    return {
      presetApplied: true,
      incomes: (templateMonth.incomes || [])
        .filter((i) => i.recurring)
        .map((i) => ({ ...i, id: `inc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })),
      fixedCharges: (templateMonth.fixedCharges || [])
        .filter((f) => f.recurring)
        .map((f) => ({ ...f, id: `fix-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })),
      envelopes: (templateMonth.envelopes || []).map((env) => ({
        ...env,
        manualSpent: 0,
        transactions: []
      }))
    };
  }

  function getEnvelopeSpent(env) {
    if (!env) return 0;
    if (env.mode === "global") {
      return Math.max(0, Number(env.manualSpent) || 0);
    }
    return (env.transactions || []).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  }

  function computeMonthSummary(monthData, monthKey) {
    const incomes = monthData.incomes || [];
    const fixedCharges = monthData.fixedCharges || [];
    const envelopes = monthData.envelopes || [];

    const totalIncome = incomes.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const incomeParents = incomes
      .filter((i) => i.source === "parents")
      .reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const incomePerso = incomes
      .filter((i) => i.source !== "parents")
      .reduce((s, i) => s + (Number(i.amount) || 0), 0);

    const totalFixed = fixedCharges.reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const fixedParents = fixedCharges
      .filter((f) => f.fundedBy === "parents")
      .reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const fixedPerso = fixedCharges
      .filter((f) => f.fundedBy !== "parents")
      .reduce((s, f) => s + (Number(f.amount) || 0), 0);

    let totalVariableSpent = 0;
    let variableParents = 0;
    let variablePerso = 0;

    const categoryBreakdown = [];

    fixedCharges.forEach((f, idx) => {
      const amt = Number(f.amount) || 0;
      if (amt > 0) {
        categoryBreakdown.push({
          label: f.label,
          amount: amt,
          fundedBy: f.fundedBy,
          type: "fixe",
          color: PALETTE[idx % PALETTE.length]
        });
      }
    });

    envelopes.forEach((env, idx) => {
      const spent = getEnvelopeSpent(env);
      totalVariableSpent += spent;
      if (env.fundedBy === "parents") variableParents += spent;
      else variablePerso += spent;

      if (spent > 0) {
        categoryBreakdown.push({
          label: env.name,
          amount: spent,
          fundedBy: env.fundedBy,
          type: "enveloppe",
          color: PALETTE[(fixedCharges.length + idx) % PALETTE.length]
        });
      }
    });

    const totalSpent = totalFixed + totalVariableSpent;
    const remainingTotal = totalIncome - totalSpent;
    const remainingParents = incomeParents - (fixedParents + variableParents);
    const remainingPerso = incomePerso - (fixedPerso + variablePerso);

    const remainingDays = getRemainingDaysInMonth(monthKey);
    const remainingPerDay = remainingDays > 0 ? remainingTotal / remainingDays : 0;
    const fixedRatio = totalIncome > 0 ? Math.round((totalFixed / totalIncome) * 100) : 0;

    return {
      totalIncome,
      incomeParents,
      incomePerso,
      totalFixed,
      fixedParents,
      fixedPerso,
      totalVariableSpent,
      variableParents,
      variablePerso,
      totalSpent,
      remainingTotal,
      remainingParents,
      remainingPerso,
      remainingDays,
      remainingPerDay,
      fixedRatio,
      categoryBreakdown
    };
  }

  function buildDonutSvg(breakdown, totalSpent) {
    if (!breakdown.length || totalSpent <= 0) {
      return `
        <svg viewBox="0 0 120 120" width="156" height="156">
          <circle cx="60" cy="60" r="46" fill="none" stroke="#ececf0" stroke-width="14" />
        </svg>
      `;
    }

    const radius = 46;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;

    const circles = breakdown
      .map((item) => {
        const fraction = item.amount / totalSpent;
        const dash = fraction * circumference;
        const segment = `
          <circle
            cx="60"
            cy="60"
            r="${radius}"
            fill="none"
            stroke="${item.color}"
            stroke-width="14"
            stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}"
            stroke-dashoffset="${(-offset).toFixed(2)}"
            transform="rotate(-90 60 60)"
          />
        `;
        offset += dash;
        return segment;
      })
      .join("");

    return `<svg viewBox="0 0 120 120" width="156" height="156">${circles}</svg>`;
  }

  function formatReportAsPlainText(monthKey, monthData, summary, options) {
    const lines = [
      `RÉCAPITULATIF BUDGET — ${formatMonthLabel(monthKey).toUpperCase()}`,
      `==========================================`
    ];

    const scopeIncome = options.onlyParents ? summary.incomeParents : summary.totalIncome;
    const scopeSpent = options.onlyParents
      ? summary.fixedParents + summary.variableParents
      : summary.totalSpent;
    const scopeBalance = scopeIncome - scopeSpent;

    if (options.showSummary) {
      lines.push(
        `Périmètre : ${options.onlyParents ? "Budget financé par les parents" : "Budget global (Parents + Perso)"}`,
        `• Ressources reçues : ${scopeIncome.toFixed(2)} €`,
        `• Dépenses totales : ${scopeSpent.toFixed(2)} €`,
        `• Solde restant : ${scopeBalance.toFixed(2)} €`,
        ``
      );
    }

    if (options.showFixed) {
      const charges = (monthData.fixedCharges || []).filter(
        (f) => !options.onlyParents || f.fundedBy === "parents"
      );
      if (charges.length) {
        lines.push(`CHARGES FIXES :`);
        charges.forEach((f) => lines.push(`- ${f.label} : ${Number(f.amount).toFixed(2)} €`));
        lines.push(``);
      }
    }

    if (options.showEnvelopes) {
      const envs = (monthData.envelopes || []).filter(
        (e) => !options.onlyParents || e.fundedBy === "parents"
      );
      if (envs.length) {
        lines.push(`DÉPENSES PAR CATÉGORIE :`);
        envs.forEach((e) => {
          const spent = getEnvelopeSpent(e);
          lines.push(`- ${e.name} : ${spent.toFixed(2)} € / ${Number(e.target).toFixed(2)} € prévus`);
          if (options.showDetails && e.mode === "detailed" && (e.transactions || []).length) {
            e.transactions.forEach((tx) => {
              lines.push(`   · ${tx.date || ""} ${tx.label} : ${Number(tx.amount).toFixed(2)} €`);
            });
          }
        });
        lines.push(``);
      }
    }

    if (options.customNote && options.customNote.trim()) {
      lines.push(`NOTE : ${options.customNote.trim()}`);
    }

    return lines.join("\n");
  }

  global.BudgetEngine = {
    KPI_DEFINITIONS,
    PALETTE,
    getCurrentMonthKey,
    shiftMonthKey,
    formatMonthLabel,
    createPresetMonth,
    cloneMonthForNextPeriod,
    getEnvelopeSpent,
    computeMonthSummary,
    buildDonutSvg,
    formatReportAsPlainText
  };
})(window);