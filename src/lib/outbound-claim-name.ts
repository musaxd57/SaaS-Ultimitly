// Elle gönderim çift gönderim kalkanının SystemLock ad öneki — yaprak modül (senkron yazma servisi de okur: konuşmada sürmekte olan belirsiz
// gönderim varsa kanalın "otomasyon" etiketli mesajı otomatik mesaj sayılmaz — Opus 10-17 Q2-B). Ad biçimi: `<önek><konuşma>:<özet>`.
export const OUTBOUND_SEND_CLAIM_PREFIX = "outbound-send:";

// İstek kimliği talebi (Codex 11-05, 43fb93e incelemesi P2) — AYRI önek: başarılı gönderimden sonra 24 saat tutulur; yazma servisinin "belirsiz
// gönderim sürüyor" okuması (↑ önek) bunu GÖRMEZ — tutulan istek talebi belirsiz gönderim değildir. Ad biçimi: `<önek><konuşma>:<anahtar özeti>`.
export const OUTBOUND_REQUEST_CLAIM_PREFIX = "outbound-request:";
