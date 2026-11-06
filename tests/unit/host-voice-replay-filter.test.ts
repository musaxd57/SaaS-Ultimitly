import { describe, it, expect } from "vitest";
import { isForbiddenMeasurementFile, isReplayOutput } from "../eval/measurement-files";

// ---------------------------------------------------------------------------
// Ev sahibi sesi tekrar oynatması (ücretsiz ölçüm, kurucu 11-06) yasak setleri OKUMAZ: adında kör / kabul / blind / holdout / acceptance /
// sealed geçen ölçüm yan dosyaları atlanır (CLAUDE.md yasak dosya kuralı). Ad gerçek `docs/olcum` biçimlerinden alındı.
// ---------------------------------------------------------------------------

describe("tekrar oynatma — yasak ölçüm dosyası süzgeci", () => {
  it("kör / kabul / blind / acceptance / holdout / sealed adlı dosyalar atlanır", () => {
    for (const name of [
      "anlama-e2e-kor-live-2026-10-21-rtblind.json",
      "live-pipeline-2026-09-30-gpt-5.1-luna-acceptance-KABUL-5.1-referans.json",
      "decision-text-2026-11-04-haiku-kor.json",
      "rag-2026-10-01-holdout.json",
      "qr-2026-10-02-sealed-set.json",
      "anlama-kör-2026-10-20.json",
    ]) {
      expect(isForbiddenMeasurementFile(name), name).toBe(true);
    }
  });

  it("KONTROL: sıradan ölçüm dosyaları okunur ('kor' sözcük içinde geçse de — 'korku', 'kordon')", () => {
    for (const name of [
      "ev-sahibi-cevabi-2026-10-31-gpt-5.1-host-answer-compose-dev.json",
      "host-contact-replay-2026-10-30.json",
      "anlama-korku-mesajlari-2026-10-20.json",
      "kordon-2026-10-01.json",
    ]) {
      expect(isForbiddenMeasurementFile(name), name).toBe(false);
    }
  });

  it("tekrar oynatmaların kendi çıktıları (kısaltılmış örnek cevap taşır) okunmaz; sıradan ölçüm dosyası okunur", () => {
    expect(isReplayOutput("host-voice-replay-2026-11-06.json")).toBe(true);
    expect(isReplayOutput("host-contact-replay-2026-10-30.json")).toBe(true);
    expect(isReplayOutput("ev-sahibi-cevabi-2026-10-31-gpt-5.1-host-answer-compose-dev.json")).toBe(false);
    expect(isReplayOutput("live-pipeline-2026-10-30-host-voice.json")).toBe(false);
  });
});
