import { describe, it, expect } from "vitest";
import { detectRiskType, isSafetyEmergencyText } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// K6 İKİNCİ TUR (Codex 10-01): meslek / yer ANILMASI gerçekleşen tehlike değildir. Kurucu kararı K6 (09-30) yer / eşya sorusunu
// ("yangın söndürücü nerede", "polis merkezi nerede") ve "acil değil"i tek başına acil saymıyordu; ama mesajda "doktor / avukat /
// hastane" geçmesi olay işareti sayılıp nötrlenen sözcüğü geri açıyordu. Artık yalnız KİMLİK ("doktor olan arkadaşım", "avukat
// arkadaşımızla") ve RUTİN BAKIM ("hastanedeki rutin kontrol randevum") çerçeveleri etkisiz; ihtiyaç / eylem ve gerçek olay acil kalır.
// ---------------------------------------------------------------------------

const NOT_EMERGENCY = [
  // Codex örnekleri
  "Yangın söndürücü nerede? Doktor olan arkadaşım cihazın yerini merak ediyor.",
  "Polis merkezi nerede? Avukat arkadaşımızla orada buluşacağız.",
  "Acil değil, hastanedeki rutin kontrol randevuma nasıl giderim?",
  // aynı sınıf, başka biçim
  "Yangın söndürücü nerede? Eşim doktordur, sadece merak etti.",
  "Where is the fire extinguisher? My friend is a doctor and asked.",
  "Where is the police station? We are meeting a lawyer friend there.",
  "Not an emergency — how do I get to the hospital for my routine check-up?",
  // her çerçeve kendi örneğiyle (mutasyon 10-01)
  "Acil değil, rutin kontrol için hastaneye nasıl giderim?",
  "Where is the fire extinguisher? I'm a doctor, just checking the flat.",
  "Not an emergency, how do I get to my routine doctor visit?",
  "Where is the police station? After that I have a check-up at the hospital.",
];

const STILL_EMERGENCY = [
  // Codex kontrolleri
  "Yangın söndürücü nerede, mutfak yanıyor!",
  "Acil çıkış nerede? Çıkış kilitli, duman var.",
  // ihtiyaç / eylem / gerçek olay — kimlik çerçevesi olsa bile
  "Acil değil ama doktor lazım, arkadaşım bayıldı.",
  "Polis merkezi nerede? Avukatımla gideceğim, çantam çalındı.",
  "Acil değil, arkadaşım hastaneye kaldırıldı. Polis merkezi nerede?",
  "Doktor olan arkadaşım bayıldı, yangın söndürücü nerede?",
  "Where is the fire extinguisher? There is smoke in the kitchen.",
  "Not an emergency but we need a doctor, my son fell and is bleeding.",
];

describe("K6 — meslek / rutin bakım anılması olay değildir", () => {
  it.each(NOT_EMERGENCY)("acil DEĞİL: %s", (msg) => {
    expect(isSafetyEmergencyText(msg)).toBe(false);
    expect(detectRiskType(msg)).not.toBe("safety_emergency");
  });
  it.each(STILL_EMERGENCY)("acil KALIR: %s", (msg) => {
    expect(isSafetyEmergencyText(msg)).toBe(true);
  });
});
