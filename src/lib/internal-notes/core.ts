// ---------------------------------------------------------------------------
// İÇ NOT — SAF ÇEKİRDEK (dilim D1, tasarım `docs/TASARIM-2026-11-18-gercek-konusma-ve-ic-not.md` §3.1; kurucu 11-18 akşam: "Telefon
// görüşmesini kaydetmek → Konaklamada İç not ekle. Konaklama yoksa daireye not. Sırf not için misafir sohbeti açılmaz.").
// YAPRAK modül (istemci + sunucu; hiçbir şey import etmez): metin temizliği ve sınırlar tek yerde. Sunucu (`service.ts`) ve rota şeması
// aynı kuraldan karar verir; arayüzün sayaç / `maxLength` değeri de buradan okunur.
// ---------------------------------------------------------------------------

/** Not metninin üst sınırı (temizlikten SONRA, UTF-16 birimi — tarayıcının `maxLength` sayımıyla aynı). Aşan metin KIRPILMAZ, reddedilir. */
export const INTERNAL_NOTE_MAX_CHARS = 1000;

/** Yazan adının kopyası en çok bu kadar (kişi sonradan adını değiştirse / ekipten çıksa da not okunur). */
export const INTERNAL_NOTE_AUTHOR_MAX_CHARS = 80;

/** Liste sayfasının üst sınırı (yeniden eskiye). */
export const INTERNAL_NOTE_PAGE_MAX = 50;

// Denetim karakterleri (Unicode `Cc`: C0 + DEL + C1, NUL dahil) — satır sonu HARİÇ ("Cc olmayan ya da satır sonu olmayan" = Cc ama LF değil).
// Tek karakter sınıfı, genel bayrak → doğrusal (karesel iş yok).
const CONTROL_CHARS = /[^\P{Cc}\n]/gu;

/**
 * Not metnini temizler (sınır DENETLEMEZ): satır sonu birleşir (CRLF / CR → LF), sekme boşluğa döner, NUL ve öteki denetim karakterleri
 * silinir, baş / son boşluk kırpılır. Satır sonu metnin içinde KALIR (telefon notu birkaç satır olabilir).
 */
export function normalizeInternalNoteBody(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(CONTROL_CHARS, "").trim();
}

export type InternalNoteBodyCheck = { ok: true; body: string } | { ok: false; reason: "empty" | "too_long" };

/** Temizlik + sınır: boş metin ve 1.000 karakteri aşan metin reddedilir (kırpma YOK — ev sahibinin yazdığının bir kısmı sessizce kaybolmaz). */
export function checkInternalNoteBody(raw: string): InternalNoteBodyCheck {
  const body = normalizeInternalNoteBody(raw);
  if (body.length === 0) return { ok: false, reason: "empty" };
  if (body.length > INTERNAL_NOTE_MAX_CHARS) return { ok: false, reason: "too_long" };
  return { ok: true, body };
}

/**
 * Yazan adının kopyası: aynı temizlik, satır sonu da boşluğa döner (ad tek satırdır), en çok 80 karakter. Ad kırpılabilir (metin değil,
 * kopya) — ama vekil çifti ortasından bölünmez (kod noktası sınırında kesilir).
 */
export function internalNoteAuthorName(name: string): string {
  const flat = normalizeInternalNoteBody(name).replace(/\n+/g, " ");
  if (flat.length <= INTERNAL_NOTE_AUTHOR_MAX_CHARS) return flat;
  let out = "";
  for (const ch of flat) {
    if (out.length + ch.length > INTERNAL_NOTE_AUTHOR_MAX_CHARS) break;
    out += ch;
  }
  return out.trimEnd();
}

/**
 * Silme yetkisi (kurucuya önerilen Y1-d; görev metni): notu YAZAN kişi ya da işletme SAHİBİ silebilir. Yönetici başkasının notunu silemez.
 * Yazanı bilinmeyen not (kişi silinmiş — bağ boşalmış) yalnız sahipçe silinir. Düzeltme yok (yeni not yazılır).
 */
export function canDeleteInternalNote(note: { authorUserId: string | null }, viewer: { userId: string; role: string }): boolean {
  if (viewer.role === "owner") return true;
  return note.authorUserId !== null && note.authorUserId === viewer.userId;
}
