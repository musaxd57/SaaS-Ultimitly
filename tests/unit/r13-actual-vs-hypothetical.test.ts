import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) }));
vi.mock("@/lib/alert-state", () => ({ alertOnTransition: vi.fn(async () => "alerted"), clearAlertState: vi.fn(async () => {}) }));

import { autoReplyGateVerdict } from "@/lib/automation";
import { evaluateEscalation } from "@/lib/guest-chat-gate";

// ---------------------------------------------------------------------------
// R13 SINIRI (kurucu 10-28 gece, aynen): "Yaşanan olayla varsayımsal olay ayrılmalı. 'Wi-Fi bozulursa ne yapmalıyız?' sorusuna bu talimat
// uygun olabilir. Ama misafir 'Wi-Fi şu anda çalışmıyor' diyorsa yalnız 'Bozulursa ev sahibine yazın' demek, bildirimi anlamamış gibi olur.
// Mevcut sorun kaydı ve host'a bildirim akışı korunmalı. … sistem gerçekten bildirim göndermediyse 'ev sahibinize bildirdim' de denmemeli."
//
// R13 yalnız CEVAP METNİNİ okuyan "ev sahibine yönlendirme" kuralını gevşetti. Bu dosya, misafirin GERÇEK arıza bildiriminin cevap metninden
// BAĞIMSIZ olarak tutulduğunu (şikâyet → ev sahibi; sözcük ağı VE model niyeti ayrı ayrı) ve yapılmamış bildirimin iddia edilemediğini pinler —
// kanal kapısı ve QR kapısı birlikte. Cevap gitmediği için açık şikâyet de "cevaplandı" sayılamaz.
// ---------------------------------------------------------------------------

const REFERRALS = [
  "Wi-Fi bozulursa ev sahibinize yazın.",
  "Bir sorun olursa ev sahibinizi arayıp bilgi verebilirsiniz.",
  "If the Wi-Fi stops working, message your host with the details.",
  "If anything breaks, please contact your host so they know.",
];
const ACTUAL = ["Wi-Fi şu anda çalışmıyor", "The wifi is not working right now", "Klima soğutmuyor", "Sıcak su gelmiyor", "The power is out"];
const model = (intent: string, reply: string) => ({ intent, riskLevel: "low", confidence: 0.95, source: "openai", reply });

describe("gerçek arıza bildirimi: R13 talimat cümlesi cevap olarak GİTMEZ (kanal kapısı)", () => {
  for (const g of ACTUAL) {
    for (const r of REFERRALS) {
      it(`"${g}" → "${r.slice(0, 40)}…" tutulur — model niyeti 'genel' dese bile`, () => {
        // Model şikâyeti görmese de sözcük ağı görür (iki bağımsız yol).
        expect(autoReplyGateVerdict(model("general", r), g)).not.toBeNull();
        expect(autoReplyGateVerdict(model("complaint", r), g)).not.toBeNull();
      });
    }
  }
});

describe("gerçek arıza bildirimi: QR kapısı da devreder", () => {
  for (const g of ACTUAL) {
    it(`"${g}"`, () => {
      const v = evaluateEscalation({ ...model("general", REFERRALS[1]), usedSources: [] }, g);
      expect(v.escalate).toBe(true);
    });
  }
});

describe("varsayımsal soru: talimat cevabı gider (R13'ün amacı)", () => {
  it("'Wi-Fi bozulursa ne yapmalıyım?' → 'Wi-Fi bozulursa ev sahibinizi arayıp bilgi verebilirsiniz.'", () => {
    expect(autoReplyGateVerdict(model("general", "Wi-Fi bozulursa ev sahibinizi arayıp bilgi verebilirsiniz."), "Wi-Fi bozulursa ne yapmalıyım?")).toBeNull();
  });
});

describe("yapılmamış bildirim iddia edilemez", () => {
  for (const r of ["Ev sahibinize bildirdim.", "Ev sahibinize ilettim, en kısa sürede dönecek.", "I've notified your host."]) {
    it(r, () => {
      expect(autoReplyGateVerdict(model("general", `Evet, binanın arkasında ücretsiz otopark var. ${r}`), "Otopark var mı?")).not.toBeNull();
    });
  }
});

// BİLİNEN AÇIK (10-28 gece, kurucu sorusu R13-b — `docs/INCELEME-2026-10-28-opus-ikinci-dilim.md` sonu): sözcük ağı bu bildirimleri şikâyet
// SAYMIYOR (Wi-Fi'ye bağlanamama bilerek "wifi" sorusu — çoğu zaman doğru cevap şifredir; elektrik / su / ısıtma "yok" kalıbı ağda yok). Model
// niyeti de "genel" derse koşullu "bozulursa ev sahibine yazın" cevabı GİDER. R13'ten ÖNCE de gidiyordu ("bozulursa … yazın" biçimi zaten
// muaftı). Karar kurucuda; bu pin bugünkü davranışı gösterir, karar uygulanınca TERSİNE çevrilir.
describe("BİLİNEN AÇIK R13-b: sözcük ağının şikâyet saymadığı gerçek bildirim + model 'genel' → koşullu talimat gider", () => {
  for (const g of ["İnternet yok, bağlanamıyorum", "İnternet kesildi", "Elektrik yok", "Su yok", "Isıtma yok", "TV açılmıyor"]) {
    it(g, () => {
      expect(autoReplyGateVerdict(model("general", "Bir sorun olursa ev sahibinize yazın."), g)).toBeNull();
      // Model şikâyeti görürse tutulur (bugünkü tek koruma).
      expect(autoReplyGateVerdict(model("complaint", "Bir sorun olursa ev sahibinize yazın."), g)).not.toBeNull();
    });
  }
});
