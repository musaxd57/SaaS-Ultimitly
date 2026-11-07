import { describe, it, expect } from "vitest";
import { qrReplyHasDoorCode, withoutSecretKbItems } from "@/lib/guest-chat";
import { planDocumentImport } from "@/lib/kb-import/document";

// ---------------------------------------------------------------------------
// SÜRE PİNİ (CLAUDE.md "misafir metnine uygulanan kalıpta karesel iş yok"): 10-28 gece R24 / R25 kalıpları — giriş fiiliyle sayı
// (`ENTRY_NUMBER`), kod benzeri sayı, Almanca bileşik kapı kodu, "pin / codice + kapı adı", "keyless". Kötü niyetli uzun girdide (boşluk
// dizisi, tekrarlanan kök, uzun rakam dizisi) süre doğrusal kalmalı. Ölçüm (10-28): en kötüsü 20.000 boşlukta içe aktarma ≈ 73 ms.
// ---------------------------------------------------------------------------

const INPUTS: [string, string][] = [
  ["fiil + boşluk dizisi", "type" + " ".repeat(20_000) + "x"],
  ["sayı + boşluk tekrarı", ("4590" + " ".repeat(3)).repeat(4_000)],
  ["fiil tekrarı", "type ".repeat(4_000) + "x"],
  ["keyless + boşluk dizisi", "keyless" + " ".repeat(20_000) + "4590"],
  ["türcode tekrarı", "türcode ".repeat(2_500)],
  ["pin door tekrarı", "pin door ".repeat(2_500)],
  ["uzun rakam dizisi", "1".repeat(20_000)],
  ["codice porta tekrarı", "codice porta ".repeat(1_800)],
  ["yazın tekrarı", "4590 yazın ".repeat(1_800)],
];

describe("R24 / R25 kalıpları — süre", () => {
  for (const [name, text] of INPUTS) {
    it(`${name}: bilgi tabanı süzgeci + QR taraması + içe aktarma doğrusal`, () => {
      const t0 = performance.now();
      withoutSecretKbItems([{ title: "T", content: text.slice(0, 20_000) }]);
      qrReplyHasDoorCode(text.slice(0, 2_000), []);
      planDocumentImport([{ page: 1, text }]);
      expect(performance.now() - t0).toBeLessThan(1_500);
    });
  }
});
