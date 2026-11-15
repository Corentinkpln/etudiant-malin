import { MODULES } from "./config.js";
import { getCurrentUser, signIn, signUp, signOut } from "./supabase.js";

let isRegisterMode = false;

const authView = document.getElementById("auth-view");
const appView = document.getElementById("app-view");
const authForm = document.getElementById("auth-form");
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authSwitchText = document.getElementById("auth-switch-text");
const authSwitchBtn = document.getElementById("auth-switch-btn");
const authError = document.getElementById("auth-error");
const userEmailLabel = document.getElementById("user-email-label");
const orbArena = document.getElementById("orb-arena");
const coreOrb = document.getElementById("core-orb");

function renderSatellites() {
  // Supprime d'éventuels anciens satellites avant recalcul
  orbArena.querySelectorAll(".satellite-orb").forEach((el) => el.remove());

  const isMobile = window.innerWidth <= 520;
  const radius = isMobile ? 124 : 172;
  const total = MODULES.length;

  MODULES.forEach((mod, index) => {
    // Répartition régulière sur le cercle en partant du haut (-PI / 2)
    const angle = (2 * Math.PI * index) / total - Math.PI / 2;
    const tx = Math.round(radius * Math.cos(angle));
    const ty = Math.round(radius * Math.sin(angle));

    const link = document.createElement("a");
    link.href = mod.url;
    link.className = "satellite-orb";
    link.style.setProperty("--tx", `${tx}px`);
    link.style.setProperty("--ty", `${ty}px`);
    link.style.transitionDelay = `${index * 45}ms`;

    link.innerHTML = `
      <span class="satellite-orb__dot" style="background: ${mod.accent}"></span>
      <span class="satellite-orb__title">${mod.title}</span>
      <span class="satellite-orb__sub">${mod.subtitle}</span>
    `;

    orbArena.appendChild(link);
  });
}

function updateViewForUser(user) {
  if (user) {
    authView.classList.add("hidden");
    appView.classList.remove("hidden");
    userEmailLabel.textContent = user.email;
    renderSatellites();
  } else {
    appView.classList.add("hidden");
    authView.classList.remove("hidden");
    orbArena.classList.remove("is-expanded");
    coreOrb.classList.remove("is-open");
  }
}

authSwitchBtn.addEventListener("click", () => {
  isRegisterMode = !isRegisterMode;
  authError.classList.add("hidden");
  authTitle.textContent = isRegisterMode ? "Créer un compte" : "Étudiant-Malin";
  authSubtitle.textContent = isRegisterMode
    ? "Synchronisez vos repas, votre budget et votre planning."
    : "Connectez-vous à votre espace personnel.";
  authSubmitBtn.textContent = isRegisterMode ? "Créer mon espace" : "Continuer";
  authSwitchText.textContent = isRegisterMode ? "Déjà inscrit ?" : "Pas encore de compte ?";
  authSwitchBtn.textContent = isRegisterMode ? "Se connecter" : "Créer un compte";
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.classList.add("hidden");
  authSubmitBtn.disabled = true;

  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;

  try {
    const user = isRegisterMode
      ? await signUp(email, password)
      : await signIn(email, password);
    updateViewForUser(user);
  } catch (err) {
    authError.textContent = err.message || "Erreur d'authentification.";
    authError.classList.remove("hidden");
  } finally {
    authSubmitBtn.disabled = false;
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await signOut();
  updateViewForUser(null);
});

coreOrb.addEventListener("click", () => {
  const expanded = orbArena.classList.toggle("is-expanded");
  coreOrb.classList.toggle("is-open", expanded);
  coreOrb.querySelector(".core-orb__hint").textContent = expanded
    ? "Choisir un outil"
    : "Toucher pour ouvrir";
});

window.addEventListener("resize", () => {
  if (!appView.classList.contains("hidden")) renderSatellites();
});

// Vérification automatique de session au chargement
getCurrentUser().then(updateViewForUser);