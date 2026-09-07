import { describe, it, expect, beforeEach } from "vitest";
import { IngestError, type IngestAdapter } from "@/lib/channels/ingest";

// ---------------------------------------------------------------------------
// INGEST CONNECTOR CONFORMANCE KİTİ (V0.6)
//
// Aynı senaryolar HEM ortak fake'e HEM gerçek adaptöre (HTTP stub) koşulur: fake
// gerçek sağlayıcı davranışından sapamaz, gerçek adaptör çekirdeğin dayandığı
// canonical sözleşmeyi sağlar. Kit sağlayıcı-özel hiçbir şey bilmez (endpoint,
// JSON alan adı, hata metni); "sağlayıcı tarafı" harness'ta programlanır.
// ⚠️ HTTP stub ≠ canlı sağlayıcı doğrulaması — gerçek gövdeler canlıda gözlenmedi.
// ---------------------------------------------------------------------------

export type IngestScenario =
  | "two_reservations"
  | "duplicate_reservation"
  | "status_variants"
  | "messages_unsorted"
  | "message_without_body"
  | "two_pages"
  | "unowned_property"
  | "reject_401"
  | "reject_403"
  | "reject_404"
  | "rate_limit"
  | "outage_503"
  | "network_down";

export interface IngestHarness {
  adapter: IngestAdapter;
  /** Sağlayıcının bir sonraki listelemede vereceği cevabı programla. */
  arrange(s: IngestScenario): void;
  /** Sağlayıcıya ulaşan istek sayısı. */
  attempts(): number;
  /** Sağlayıcının son istekte gördüğü ham token. */
  lastToken(): string | undefined;
  clearAmbientCredentials(): void;
  reset(): void;
}

export const KIT = {
  TOKEN: "tok-ingest-SECRET-7c2e",
  PROPERTY: "prop-conf-1",
  RES_A: "res-conf-A",
  RES_B: "res-conf-B",
  WINDOW: { propertyExternalId: "prop-conf-1", startDate: "2026-05-01", endDate: "2026-12-31" },
} as const;

export function describeIngestConformance(label: string, makeHarness: () => IngestHarness): void {
  describe(`ingest conformance — ${label}`, () => {
    let h: IngestHarness;
    const cred = { provider: "hospitable" as const, token: KIT.TOKEN };
    beforeEach(() => {
      h = makeHarness();
      h.reset();
    });

    it("yetenekler ilan edilir: properties/reservations/messages.read", () => {
      expect(h.adapter.provider).toBe("hospitable");
      for (const c of ["properties.read", "reservations.read", "messages.read"] as const) expect(h.adapter.capabilities.has(c)).toBe(true);
    });

    it("rezervasyonlar canonical şekle çevrilir: kimlik, kanal, durum, tarih, misafir, thread imleci; kimlik bilgisi aynen sağlayıcıya gider", async () => {
      h.arrange("two_reservations");
      const rs = await h.adapter.listReservations(cred, KIT.WINDOW);
      expect(rs.map((r) => r.externalId)).toEqual([KIT.RES_A, KIT.RES_B]);
      const a = rs[0];
      expect(a.channel).toBe("airbnb");
      expect(a.status).toBe("confirmed");
      expect(a.terminal).toBe(false);
      expect(a.arrivalDate?.toISOString().slice(0, 10)).toBe("2026-06-01");
      expect(a.departureDate?.toISOString().slice(0, 10)).toBe("2026-06-05");
      expect(a.guest).toEqual({ externalId: "g-1", name: "Alex Guest", email: "alex@example.com", phone: "+900000" });
      expect(a.conversationExternalId).toBe("conv-A");
      expect(a.lastMessageAt?.toISOString()).toBe("2026-05-30T10:00:00.000Z");
      const b = rs[1];
      expect(b.channel).toBe("booking");
      expect(b.status).toBe("cancelled");
      expect(b.terminal).toBe(true);
      expect(b.guest.email).toBeNull(); // maskelenmiş misafir → null, uydurulmaz
      expect(h.lastToken()).toBe(KIT.TOKEN);
    });

    it("🚨 sağlayıcı DEDUPE YAPMAZ: aynı rezervasyon listede iki kez → adaptör ikisini de aktarır (tekilleştirme çekirdeğin işi)", async () => {
      h.arrange("duplicate_reservation");
      const rs = await h.adapter.listReservations(cred, KIT.WINDOW);
      expect(rs.map((r) => r.externalId)).toEqual([KIT.RES_A, KIT.RES_A]);
    });

    it("durum eşlemesi kapalı kümeye iner: pending/request → pending · checked_out/past → completed · declined/expired → cancelled(terminal)", async () => {
      h.arrange("status_variants");
      const rs = await h.adapter.listReservations(cred, KIT.WINDOW);
      expect(rs.map((r) => [r.externalId, r.status, r.terminal])).toEqual([
        ["v-pending", "pending", false],
        ["v-past", "completed", true],
        ["v-declined", "cancelled", true],
        ["v-vrbo", "confirmed", false],
      ]);
      expect(rs[3].channel).toBe("vrbo");
    });

    it("🚨 sağlayıcı SIRALAMAZ: mesajlar geldiği sırayla aktarılır; yön gönderen rolünden; kimlik string", async () => {
      h.arrange("messages_unsorted");
      const ms = await h.adapter.listMessages(cred, KIT.RES_A);
      expect(ms.map((m) => m.externalId)).toEqual(["m-3", "m-1", "m-2"]); // sağlayıcı sırası korunur
      expect(ms.map((m) => m.direction)).toEqual(["inbound", "outbound", "inbound"]);
      expect(ms[0].senderName).toBe("Alex Guest");
      expect(ms[1].senderName).toBe("Ev Sahibi");
      expect(ms[0].createdAt?.toISOString()).toBe("2026-05-30T11:00:00.000Z");
    });

    it("gövdesiz sağlayıcı mesajı body=null ile aktarılır (çekirdek sayar, atlar; adaptör uydurmaz)", async () => {
      h.arrange("message_without_body");
      const ms = await h.adapter.listMessages(cred, KIT.RES_A);
      expect(ms).toHaveLength(2);
      expect(ms[0].body).toBe("dolu");
      expect(ms[1].body).toBeNull();
    });

    it("sayfalama: iki sayfa tek listede birleşir", async () => {
      h.arrange("two_pages");
      const rs = await h.adapter.listReservations(cred, KIT.WINDOW);
      expect(rs.map((r) => r.externalId)).toEqual(["p1-1", "p1-2", "p2-1"]);
    });

    it("kiracı sınırı (stub varsayımı, canlıda gözlenmedi): token'ın görmediği mülk → boş liste, hata yok", async () => {
      h.arrange("unowned_property");
      const rs = await h.adapter.listReservations(cred, { ...KIT.WINDOW, propertyExternalId: "prop-of-ANOTHER" });
      expect(rs).toEqual([]);
    });

    for (const [scenario, kind, status] of [
      ["reject_401", "auth_revoked", 401],
      ["reject_403", "auth_revoked", 403],
      ["reject_404", "not_found", 404],
      ["rate_limit", "rate_limited", 429],
      ["outage_503", "outage", 503],
    ] as const) {
      it(`hata sınıfı TİPLİ: HTTP ${status} → IngestError.kind=${kind}; metin token taşımaz`, async () => {
        h.arrange(scenario);
        let caught: unknown;
        try {
          await h.adapter.listReservations(cred, KIT.WINDOW);
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(IngestError);
        const e = caught as IngestError;
        expect(e.kind).toBe(kind);
        expect(e.status).toBe(status);
        expect(e.message).not.toContain(KIT.TOKEN);
        expect(h.attempts()).toBeGreaterThanOrEqual(1);
      });
    }

    it("ağ arızası → outage (durum kodu yok), metin token taşımaz", async () => {
      h.arrange("network_down");
      let caught: unknown;
      try {
        await h.adapter.listMessages(cred, KIT.RES_A);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(IngestError);
      expect((caught as IngestError).kind).toBe("outage");
      expect((caught as IngestError).message).not.toContain(KIT.TOKEN);
    });

    it("🚨 kimlik bilgisi YOK (token yok, env yok) → no_credential, AĞA ÇIKILMAZ", async () => {
      h.arrange("two_reservations");
      h.clearAmbientCredentials();
      let caught: unknown;
      try {
        await h.adapter.listReservations({ provider: "hospitable", token: undefined }, KIT.WINDOW);
      } catch (e) {
        caught = e;
      }
      expect((caught as IngestError)?.kind).toBe("no_credential");
      expect(h.attempts()).toBe(0);
    });
  });
}
