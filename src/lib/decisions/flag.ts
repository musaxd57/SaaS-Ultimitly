/**
 * HOST KARAR MOTORU bayrağı (Faz 1, kurucu 10-02 akşam; tasarım `docs/TASARIM-2026-10-02-host-karar-motoru.md`). Yalnız tam "1"
 * açar; varsayılan KAPALI. Kapalıyken: kart kaydı açılmaz, kart / rozet / pano satırı görünmez, karar rotası 404, "Misafir cevabınızı
 * bekliyor" e-postası bugünkü gibi — davranış birebir eski. YAPRAK modül.
 */
export function hostDecisionsEnabled(): boolean {
  return process.env.HOST_DECISIONS_ENABLED === "1";
}
