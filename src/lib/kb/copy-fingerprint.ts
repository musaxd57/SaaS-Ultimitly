import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// BİLGİ TABANI KOPYASININ İÇERİK İZİ (kurucu D2, 10-15, migration 68). Kopya yazılırken (ya da kopyalama onu güncellerken) içeriğin
// SHA-256 izi `copiedContentHash`e yazılır. Sonraki kopyalamada kopyanın ŞİMDİKİ içeriğinin izi kayıtlı izle aynıysa kopya "yerelde
// değiştirilmemiş" sayılır ve güncellenebilir; değilse ev sahibi o dairede elle düzenlemiştir → üzerine yazılmaz.
// İz yalnız içerik alanlarından (kategori + başlık + içerik + dil); durum alanları (aktif / pasif, onay) içerik değildir.
// ---------------------------------------------------------------------------

export function kbContentFingerprint(item: { category: string; title: string; content: string; language: string }): string {
  return createHash("sha256").update(JSON.stringify([item.category, item.title, item.content, item.language])).digest("hex");
}
