import { describe, it, expect } from "vitest";
import { timeStatedInMessage } from "@/lib/ai/stated-time";

// ---------------------------------------------------------------------------
// K11 İKİNCİ TUR (Codex 10-01): TEKİL izin isteği de beyan değildir. "Please let me check out at 1pm" / "Please allow me to check
// out at 1pm" 13:00 beyanı sayılıyordu → model saati çıkarırsa rezervasyonun `guestCheckoutTime` alanına yazılabilirdi (gönderim
// kararından ÖNCE). İzin isteme biçimleri tekil + çoğul BİRLİKTE, beş dilde; düz sıra beyan kalır (kurucu: "soruyu, isteği çok iyi
// seviyede amaç anlamalı").
// ---------------------------------------------------------------------------

const SINGULAR_AND_PLURAL_REQUESTS: [msg: string, hhmm: string][] = [
  // EN — Codex örnekleri + çoğul ikizleri
  ["Please let me check out at 1pm", "13:00"],
  ["Please allow me to check out at 1pm", "13:00"],
  ["Please allow us to check out at 1pm", "13:00"],
  ["Could you permit me to leave at 1pm", "13:00"],
  ["Can I check out at 1pm", "13:00"],
  ["May I leave at 1pm", "13:00"],
  ["Hi, would it be ok if I leave at 1pm", "13:00"],
  // DE
  ["Darf ich um 13 Uhr auschecken", "13:00"],
  ["Kann ich um 13 Uhr abreisen", "13:00"],
  ["Dürften wir um 13 Uhr abreisen", "13:00"],
  // FR
  ["Puis-je partir à 13h", "13:00"],
  ["Pourrais-je partir à 13h", "13:00"],
  ["Pourrions-nous partir à 13h", "13:00"],
  // ES
  ["Puedo salir a las 13", "13:00"],
  ["Podría salir a las 13", "13:00"],
  // TR — tekil + çoğul (bugün de istek; birlikte pinli)
  ["13'te çıkabilir miyim", "13:00"],
  ["13'te çıksam olur mu", "13:00"],
  ["13'te çıkmama izin verir misiniz", "13:00"],
  ["13'te çıkmamıza izin verir misiniz", "13:00"],
];

const STATEMENTS: [msg: string, hhmm: string][] = [
  ["We will check out at 1pm", "13:00"], // Codex: gerçek beyan kalmalı
  ["I will check out at 1pm", "13:00"],
  ["I'll leave at 1pm, let me know if that is a problem", "13:00"], // istek AYRI cümlecikte
  ["Ich reise um 13 Uhr ab", "13:00"],
  ["Je pars à 13h", "13:00"],
  ["Saldremos a las 13", "13:00"],
  ["13'te çıkacağım", "13:00"],
];

describe("K11 — tekil / çoğul izin isteği çıkış saati beyanı DEĞİL", () => {
  it.each(SINGULAR_AND_PLURAL_REQUESTS)("istek: %s → %s kaydedilmez", (msg, hhmm) => {
    expect(timeStatedInMessage(hhmm, msg)).toBe(false);
  });
  it.each(STATEMENTS)("beyan: %s → %s kalır", (msg, hhmm) => {
    expect(timeStatedInMessage(hhmm, msg)).toBe(true);
  });
});
