/**
 * Orga Malin V1.0 — Moteur Agenda .ics, Semainier & Synthèse Audio (orga-engine.js)
 */
(function (global) {
  "use strict";

  const DAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

  function toIsoDate(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getMondayOfWeek(dateObj = new Date()) {
    const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return toIsoDate(d);
  }

  function shiftWeekIso(mondayIso, deltaWeeks) {
    const [y, m, d] = mondayIso.split("-").map(Number);
    const dt = new Date(y, m - 1, d + deltaWeeks * 7);
    return toIsoDate(dt);
  }

  function getWeekDays(mondayIso) {
    const [y, m, d] = mondayIso.split("-").map(Number);
    const todayIso = toIsoDate(new Date());
    const days = [];

    for (let i = 0; i < 7; i++) {
      const dt = new Date(y, m - 1, d + i);
      const iso = toIsoDate(dt);
      days.push({
        iso,
        dayName: DAY_NAMES[i],
        shortDate: dt.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
        isToday: iso === todayIso
      });
    }
    return days;
  }

  function formatWeekRangeLabel(mondayIso) {
    const days = getWeekDays(mondayIso);
    return `${days[0].shortDate} – ${days[6].shortDate}`;
  }

  function addMinutesToTime(startTime, durationMin) {
    const [h, m] = (startTime || "09:00").split(":").map(Number);
    const total = h * 60 + m + (Number(durationMin) || 60);
    const endH = Math.floor(total / 60) % 24;
    const endM = total % 60;
    return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  }

  /* --------------------------------------------------------------------------
     Parseur & Générateur iCalendar (.ics) pour Agenda iPhone / ENT
     -------------------------------------------------------------------------- */
  function parseIcsDateValue(rawVal) {
    const clean = rawVal.trim();
    const match = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!match) return null;

    const [, y, mo, d, h, mi, s, isUtc] = match;
    if (h === undefined) {
      return { dateIso: `${y}-${mo}-${d}`, timeStr: "08:00", isAllDay: true };
    }

    if (isUtc === "Z") {
      const utcDate = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0)));
      return {
        dateIso: toIsoDate(utcDate),
        timeStr: `${String(utcDate.getHours()).padStart(2, "0")}:${String(utcDate.getMinutes()).padStart(2, "0")}`,
        isAllDay: false
      };
    }

    return {
      dateIso: `${y}-${mo}-${d}`,
      timeStr: `${h}:${mi}`,
      isAllDay: false
    };
  }

  function parseIcsContent(icsText) {
    // Dépliage des lignes longues selon la norme RFC 5545
    const unfolded = String(icsText || "").replace(/\r?\n[ \t]/g, "");
    const lines = unfolded.split(/\r?\n/);

    const events = [];
    let current = null;

    for (const line of lines) {
      if (line === "BEGIN:VEVENT") {
        current = {};
      } else if (line === "END:VEVENT" && current) {
        if (current.title && current.start) {
          events.push({
            id: `ics-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title: current.title,
            date: current.start.dateIso,
            startTime: current.start.timeStr,
            endTime: current.end ? current.end.timeStr : addMinutesToTime(current.start.timeStr, 60),
            category: "cours"
          });
        }
        current = null;
      } else if (current) {
        const sepIdx = line.indexOf(":");
        if (sepIdx === -1) continue;
        const propPart = line.slice(0, sepIdx).toUpperCase();
        const valPart = line.slice(sepIdx + 1);

        if (propPart === "SUMMARY" || propPart.startsWith("SUMMARY;")) {
          current.title = valPart.replace(/\\,/g, ",").replace(/\\n/g, " ").trim();
        } else if (propPart === "DTSTART" || propPart.startsWith("DTSTART;")) {
          current.start = parseIcsDateValue(valPart);
        } else if (propPart === "DTEND" || propPart.startsWith("DTEND;")) {
          current.end = parseIcsDateValue(valPart);
        }
      }
    }

    return events;
  }

  function toIcsTimestamp(dateIso, timeStr) {
    const cleanDate = dateIso.replace(/-/g, "");
    const cleanTime = (timeStr || "09:00").replace(/:/g, "") + "00";
    return `${cleanDate}T${cleanTime}`;
  }

  function generateIcsContent(events) {
    const nowStamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Etudiant-Malin//Orga-Malin 1.0//FR",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH"
    ];

    (events || []).forEach((ev) => {
      lines.push(
        "BEGIN:VEVENT",
        `UID:${ev.id}@etudiant-malin.app`,
        `DTSTAMP:${nowStamp}`,
        `DTSTART:${toIcsTimestamp(ev.date, ev.startTime)}`,
        `DTEND:${toIcsTimestamp(ev.date, ev.endTime || addMinutesToTime(ev.startTime, 60))}`,
        `SUMMARY:${String(ev.title || "Bloc Orga-Malin").replace(/,/g, "\\,")}`,
        "DESCRIPTION:Planifié depuis Orga-Malin (Étudiant-Malin)",
        "END:VEVENT"
      );
    });

    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  /* --------------------------------------------------------------------------
     Synthèse sonore Web Audio API (Carillon doux fin de sprint sans MP3)
     -------------------------------------------------------------------------- */
  function playCompletionChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const notes = [523.25, 659.25, 783.99]; // Accord Do5 - Mi5 - Sol5

      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;

        const start = ctx.currentTime + idx * 0.14;
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.75);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.8);
      });
    } catch {
      // Silencieux si bloqué par politique navigateur
    }
  }

  function createStarterWorkspace(mondayIso) {
    const days = getWeekDays(mondayIso);
    return {
      initialized: true,
      tasks: [
        {
          id: "t-1",
          title: "Finir le compte-rendu de TP / TD",
          category: "cours",
          priority: "p1",
          durationMin: 60,
          firstStep: "Ouvrir le document et rédiger uniquement le titre + l'introduction",
          done: false
        },
        {
          id: "t-2",
          title: "Préparer les repas de la semaine (Batch Cooking)",
          category: "perso",
          priority: "p2",
          durationMin: 75,
          firstStep: "Sortir la planche à découper, le couteau et les boîtes hermétiques",
          done: false
        }
      ],
      events: [
        {
          id: "ev-1",
          title: "Session Démarrage & Focus",
          date: days[0].iso,
          startTime: "18:00",
          endTime: "19:00",
          category: "work"
        }
      ],
      completedSprints: 0
    };
  }

  global.OrgaEngine = {
    toIsoDate,
    getMondayOfWeek,
    shiftWeekIso,
    getWeekDays,
    formatWeekRangeLabel,
    addMinutesToTime,
    parseIcsContent,
    generateIcsContent,
    playCompletionChime,
    createStarterWorkspace
  };
})(window);