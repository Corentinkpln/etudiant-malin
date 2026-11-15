import { supabase, getCurrentUser, signOut } from "./supabase.js";

export async function saveModuleData(moduleName, payload) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Utilisateur non connecté");

  const { error } = await supabase
    .from("user_module_data")
    .upsert(
      {
        user_id: user.id,
        module_name: moduleName,
        payload,
        updated_at: new Date().toISOString()
      },
      { onConflict: "user_id,module_name" }
    );

  if (error) throw error;
}

export async function loadModuleData(moduleName) {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("user_module_data")
    .select("payload, updated_at")
    .eq("user_id", user.id)
    .eq("module_name", moduleName)
    .maybeSingle();

  if (error) throw error;
  return data ? data.payload : null;
}

window.EtudiantCore = {
  getCurrentUser,
  signOut,
  saveModuleData,
  loadModuleData
};