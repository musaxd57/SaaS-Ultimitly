import { describe, it, expect, beforeEach } from "vitest";
import type { OutboundAdapter, OutboundSendResult } from "@/lib/channels";

// ---------------------------------------------------------------------------
// OUTBOUND CONNECTOR CONFORMANCE KİTİ (V0.2)
//
// Aynı senaryo seti HEM ortak fake'e HEM gerçek adaptöre (HTTP katmanı stub'lı)
// koşulur. Amaç iki yönlü: (a) her adaptör çekirdeğin dayandığı sözleşmeyi
// sağlar, (b) fake gerçek sağlayıcı davranışından sapamaz — sapınca bu kit
// kırmızı olur. Gelecekteki adaptör (Airbnb Direct) aynı kiti geçmek zorunda;
// kit sağlayıcı-özel hiçbir şey (hata metni biçimi, endpoint) bilmez.
//
// Harness = "sağlayıcı tarafını" programlayan ve gözleyen nesne; gerçek adaptörde
// bu fetch stub'ıdır, fake'te sağlayıcı nesnesinin kendisi.
// ---------------------------------------------------------------------------

export type ConformanceScenario =
  | "succeed"
  | "reject_404"
  | "reject_401"
  | "reject_422"
  | "rate_limit_30"
  | "blocked_402"
  | "outage_503"
  | "status_408"
  | "timeout_lost"
  | "timeout_delivered";

export interface ConformanceHarness {
  adapter: OutboundAdapter;
  /** Sağlayıcının bir sonraki isteğe vereceği cevabı programla. */
  arrange(s: ConformanceScenario): void;
  /** Sağlayıcıya ulaşan istek sayısı. */
  attempts(): number;
  /** Misafire GERÇEKTEN ulaşan mesaj sayısı. */
  deliveries(): number;
  /** Sağlayıcının son istekte gördüğü kimlik bilgisi (ham token). */
  lastToken(): string | undefined;
  /** "Kimlik bilgisi yok" senaryosu için ortam (env fallback vb.) hazırla. */
  clearAmbientCredentials(): void;
  reset(): void;
}

const DEST = { provider: "hospitable" as const, externalReservationId: "res-conf-1" };
const TOKEN = "tok-conf-SECRET-9f3a";
const CRED = { provider: "hospitable" as const, token: TOKEN };

export function describeOutboundConformance(label: string, makeHarness: () => ConformanceHarness): void {
  describe(`outbound conformance — ${label}`, () => {
    let h: ConformanceHarness;
    beforeEach(() => {
      h = makeHarness();
      h.reset();
    });

    const send = (body = "Merhaba"): Promise<OutboundSendResult> => h.adapter.send(DEST, body, CRED);

    it("başarı: tipli success + sağlayıcı mesaj id'si + TEK deneme + kimlik bilgisi aynen iletildi", async () => {
      h.arrange("succeed");
      const r = await send();
      expect(r.ok).toBe(true);
      expect(r.kind).toBe("definitive_success");
      expect(r.providerMessageId).toBeTruthy();
      expect(h.attempts()).toBe(1);
      expect(h.deliveries()).toBe(1);
      expect(h.lastToken()).toBe(TOKEN);
    });

    it("🚨 sağlayıcı DEDUPE YAPMAZ: aynı gövde iki kez → iki teslim (tekilleştirme çekirdeğin işi)", async () => {
      h.arrange("succeed");
      await send("aynı");
      await send("aynı");
      expect(h.deliveries()).toBe(2);
      expect(h.attempts()).toBe(2);
    });

    it("🚨 kiracı sınırı: başka hesabın / bilinmeyen rezervasyon → definitive_failure, teslim YOK", async () => {
      h.arrange("reject_404");
      const r = await send();
      expect(r).toMatchObject({ ok: false, kind: "definitive_failure", providerMessageId: null });
      expect(h.deliveries()).toBe(0);
    });

    it("yetki iptali (401) → definitive_failure (bugünkü sınıf; V0.3: auth_revoked), teslim YOK", async () => {
      h.arrange("reject_401");
      const r = await send();
      expect(r).toMatchObject({ ok: false, kind: "definitive_failure" });
      expect(h.deliveries()).toBe(0);
    });

    it("istek reddi (422) → definitive_failure", async () => {
      h.arrange("reject_422");
      expect((await send()).kind).toBe("definitive_failure");
    });

    it("429 → rate_limited + Retry-After taşınır, teslim YOK", async () => {
      h.arrange("rate_limit_30");
      const r = await send();
      expect(r).toMatchObject({ ok: false, kind: "rate_limited", retryAfterSec: 30 });
      expect(h.deliveries()).toBe(0);
    });

    it("402 → blocked (abonelik pasif), teslim YOK", async () => {
      h.arrange("blocked_402");
      expect((await send()).kind).toBe("blocked");
      expect(h.deliveries()).toBe(0);
    });

    it("5xx → ambiguous, TEK deneme (istemci içi retry yok), teslim YOK", async () => {
      h.arrange("outage_503");
      const r = await send();
      expect(r.kind).toBe("ambiguous");
      expect(h.attempts()).toBe(1);
      expect(h.deliveries()).toBe(0);
    });

    it("408 → ambiguous (zaman aşımı sınıfı, definitive DEĞİL)", async () => {
      h.arrange("status_408");
      expect((await send()).kind).toBe("ambiguous");
    });

    it("ağ zaman aşımı (yanıt yok, POST ulaşmadı) → ambiguous, id yok, TEK deneme", async () => {
      h.arrange("timeout_lost");
      const r = await send();
      expect(r).toMatchObject({ ok: false, kind: "ambiguous", providerMessageId: null });
      expect(h.attempts()).toBe(1);
      expect(h.deliveries()).toBe(0);
    });

    it("🚨 zaman aşımı ama POST ULAŞMIŞ (yanıt kayboldu) → yine ambiguous; teslim 1 — kör tekrar gönderim çift mesaj demektir", async () => {
      h.arrange("timeout_delivered");
      const r = await send();
      expect(r.kind).toBe("ambiguous");
      expect(h.deliveries()).toBe(1);
      expect(r.providerMessageId).toBeNull(); // id gelmedi → çekirdek reconcile eder, yeniden POST etmez
    });

    it("🚨 kimlik bilgisi YOKSA ağa çıkılmaz → definitive_failure, deneme 0", async () => {
      h.clearAmbientCredentials();
      h.arrange("succeed");
      const r = await h.adapter.send(DEST, "Merhaba", { provider: "hospitable", token: undefined });
      expect(r).toMatchObject({ ok: false, kind: "definitive_failure", providerMessageId: null });
      expect(h.attempts()).toBe(0);
      expect(h.deliveries()).toBe(0);
    });

    it("hata metni kimlik bilgisini TAŞIMAZ (hiçbir senaryoda)", async () => {
      for (const s of ["reject_404", "reject_401", "rate_limit_30", "blocked_402", "outage_503", "timeout_lost"] as const) {
        h.reset();
        h.arrange(s);
        const r = await send();
        expect(r.error ?? "", s).not.toContain(TOKEN);
        expect(r.error ?? "", s).not.toContain("SECRET");
      }
    });

    it("asla fırlatmaz; her sonuçta `kind` dolu", async () => {
      for (const s of ["succeed", "reject_404", "reject_401", "reject_422", "rate_limit_30", "blocked_402", "outage_503", "status_408", "timeout_lost", "timeout_delivered"] as const) {
        h.reset();
        h.arrange(s);
        const r = await send();
        expect(typeof r.kind, s).toBe("string");
        expect(["definitive_success", "definitive_failure", "ambiguous", "rate_limited", "blocked"], s).toContain(r.kind);
      }
    });
  });
}
