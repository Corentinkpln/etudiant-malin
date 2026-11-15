// Remplace ces deux valeurs par celles de ton projet Supabase (Settings > API)
export const SUPABASE_URL = "https://scybntqgrvapmjdwxfeu.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable__y5EzXPd5zF17TEdgCbrNA_ZPvBPdq9";

// Liste des modules affichés autour du rond central
export const MODULES = [
  {
    id: "batch-malin",
    title: "Batch-Malin",
    subtitle: "Repas & Courses",
    url: "./modules/batch-malin/",
    accent: "#0071e3",
    icon: "utensils"
  },
  {
    id: "budget-malin",
    title: "Budget-Malin",
    subtitle: "Dépenses & Épargne",
    url: "./modules/budget-malin/",
    accent: "#34c759",
    icon: "wallet"
  },
  {
    id: "orga-malin",
    title: "Orga-Malin",
    subtitle: "Planning & Tâches",
    url: "./modules/orga-malin/",
    accent: "#ff9500",
    icon: "calendar"
  }
];