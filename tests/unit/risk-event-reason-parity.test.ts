import { describe, it, expect } from "vitest";
import { ESCALATION_REASON_CODES } from "@/lib/risk-events";
import { ESCALATION_REASONS, type EscalationReason } from "@/lib/guest-chat-gate";

// ---------------------------------------------------------------------------
// DEVİR GEREKÇESİ ↔ KAYIT KODU PARİTESİ (09-12).
//
// 🚨 BU PİN BİR KUSURDAN DOĞDU. `history_injection` dalını eklerken kod doğru
// çalışıyordu (kapı devrediyordu) ama `recordRiskEvent`in `clampTo`'su o değeri
// TANIMADIĞI için sessizce `null` yazıyordu. Yani:
//   · gönderim kararı DOĞRU,
//   · canlı teşhis KÖR.
// Hiçbir derleyici, hiçbir tip, hiçbir test bunu söylemiyordu — kusuru yalnız
// RiskEvent satırını GERÇEKTEN okuyan integration testi yakaladı.
//
// `clampTo`nun sessizliği fail-safe olarak DOĞRU (misafir metni kolona asla
// sızamaz; tanınmayan değer `null` olur). Yanlış olan şey, o sessizliğin yeni
// bir dal eklendiğinde fark edilmemesiydi. Bu dosya farkı MEKANİK kılar.
// ---------------------------------------------------------------------------

/**
 * 🚨 KAYNAK TARAMASI DEĞİL, GERÇEK DEĞER (09-12 incelemesi bunu zorladı).
 *
 * İlk yazımda liste `guest-chat-gate.ts` metninden regex ile çıkarılıyordu ve o
 * yaklaşım TAM DA korumak istediği yerde körleşiyordu: `indexOf(";")` ile
 * kesilen blokta, üyeler arasındaki JSDoc yorumlarından birine tek bir `;`
 * girse tarama erken bitiyordu (ölçüldü: 13 üye → 6). Kesme SON yorumda olsaydı
 * anti-vakum çapaları (`>= 10`, iki bilinen üye) da geçerdi ve **en yeni
 * gerekçe sessizce denetimden düşerdi** — yeni dallar hep sona, hep yorumla
 * ekleniyor, yani kaçak testin var olma sebebinin tam ortasındaydı.
 *
 * Çözüm: `ESCALATION_REASONS` artık `as const` bir DİZİ ve tip ondan türüyor.
 * Bu dosya iki gerçek değeri karşılaştırıyor; metin taraması kalmadı.
 */
const gateReasons = (): readonly string[] => ESCALATION_REASONS;

describe("QR devir gerekçesi → RiskEvent kodu", () => {
  it("anti-vakum: liste GERÇEKTEN dolu ve tipi BESLİYOR", () => {
    const rs = gateReasons();
    // Sayı değil ALT SINIR: yeni dal eklemek serbest, listeyi boşaltıp bu
    // dosyayı yeşil bırakmak değil.
    expect(rs.length).toBeGreaterThanOrEqual(10);
    expect(rs).toContain("low_confidence");
    expect(rs).toContain("absence_admission");
    // 🚨 Tip ↔ dizi bağı: `EscalationReason` diziden TÜRÜYOR. Bu satır
    // derlenmiyorsa bağ kopmuştur (biri tipi elle yeniden yazmıştır).
    const sample: EscalationReason = "history_injection";
    expect(rs).toContain(sample);
  });

  it("🚨 HER gerekçe RiskEvent kapalı kümesinde VAR (yoksa sessizce null yazılır)", () => {
    const missing = gateReasons().filter((r) => !ESCALATION_REASON_CODES.has(r));
    expect(
      missing,
      `Bu gerekçeler RiskEvent'e NULL olarak yazılır → canlı teşhis körleşir: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("🚨 bu turda eklenen dal PİNLİ (gerileme kapanı)", () => {
    expect(gateReasons()).toContain("history_injection");
    expect(ESCALATION_REASON_CODES.has("history_injection")).toBe(true);
  });

  it("`gate_passed` kapı tipinde DEĞİL ama kayıtta VAR (asimetri bilinçli)", () => {
    // Kapı "geçti"yi `reason: null` ile anlatır; rota onu `gate_passed` koduna
    // çevirir (`verdict.reason ?? "gate_passed"`). Ters yönü zorlamak yanlış
    // olurdu — bu satır o asimetriyi BELGELER, böylece biri "listeler eşit
    // olsun" diye kapı tipine `gate_passed` eklemez.
    expect(gateReasons()).not.toContain("gate_passed");
    expect(ESCALATION_REASON_CODES.has("gate_passed")).toBe(true);
  });
});
