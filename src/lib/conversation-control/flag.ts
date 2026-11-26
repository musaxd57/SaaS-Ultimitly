// Konuşma kontrolü G0 gölge anahtarı (tasarım `docs/TASARIM-2026-11-04-konusma-kontrolu.md` §11). VARSAYILAN KAPALI: kapalıyken engel
// yazılmaz, kıyas yapılmaz, veritabanına dokunulmaz. Yalnız "1" açar.
export function conversationControlShadowEnabled(): boolean {
  return process.env.CONVERSATION_CONTROL_SHADOW_ENABLED === "1";
}
