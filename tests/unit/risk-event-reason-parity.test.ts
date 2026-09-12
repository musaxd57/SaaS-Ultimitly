import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ESCALATION_REASON_CODES } from "@/lib/risk-events";

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

const GATE = "src/lib/guest-chat-gate.ts";

/**
 * `EscalationReason` birleşim tipindeki string literalleri kaynaktan çıkarır.
 * (Tip düzeyi bilgi çalışma zamanında yok; tek yol metin. Anti-vakum ↓.)
 */
function gateReasons(): string[] {
  const src = readFileSync(join(process.cwd(), GATE), "utf8");
  const at = src.indexOf("export type EscalationReason");
  expect(at, "EscalationReason tipi bulunamadı").toBeGreaterThan(-1);
  const end = src.indexOf(";", at);
  expect(end, "tip bildirimi kapanmıyor").toBeGreaterThan(at);
  const block = src.slice(at, end);
  return [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("QR devir gerekçesi → RiskEvent kodu", () => {
  it("anti-vakum: tip GERÇEKTEN bir dizi gerekçe taşıyor", () => {
    const rs = gateReasons();
    // Ölçüldüğü gün 12 daldı. Sayı değil, ALT SINIR pinleniyor: yeni dal
    // eklemek serbest, listeyi boşaltıp bu dosyayı yeşil bırakmak değil.
    expect(rs.length).toBeGreaterThanOrEqual(10);
    // Bilinen iki uç gerçekten listede (regex yanlış bloğu okumadı).
    expect(rs).toContain("low_confidence");
    expect(rs).toContain("absence_admission");
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
