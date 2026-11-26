// ---------------------------------------------------------------------------
// İSTEMCİ İSTEK KİMLİĞİ (yaprak modül; tarayıcı + sunucu güvenli, hiçbir şey içe aktarmaz). Opus 11-05 F12: `crypto.randomUUID()` Safari
// 15.4'ten ÖNCE yok — QR sohbetinde iyimser balon eklendikten SONRA çağrılıyordu: eski iPhone'da hata fırlıyor, misafirin mesajı
// gönderilmiş gibi duruyor ama sunucuya hiç gitmiyor, "gönderiliyor" bayrağı takılı kalıp sohbet de güncellenmiyordu. Sırayla:
// `randomUUID` → `getRandomValues` ile v4 UUID → son çare zaman + `Math.random` (biçim yine sunucu kuralına uyar: [A-Za-z0-9-]{8,64}).
// ---------------------------------------------------------------------------

function hexToUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function newRequestId(): string {
  const c = (typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined) ?? undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // sürüm 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // değişke
  return hexToUuid(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
}
