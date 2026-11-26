import { describe, it, expect } from "vitest";
import { autoSendDecision, shadowMismatch, type AutoSendFacts } from "@/lib/conversation-control/decision";

// Konuşma kontrolü tek karar noktası (tasarım `docs/TASARIM-2026-11-04-konusma-kontrolu.md` §2; kurucu K-1..K-6 11-04). Saf fonksiyon:
// her şart tek başına tutar, öğe kapsamlı engel yalnız kendi öğesini tutar, gölge kıyası yalnız ayrışmada konuşur.

const clean: AutoSendFacts = { controlMode: "auto", blocks: [], draftItemIds: ["i1"], newerGuestMessage: false, hostQueued: false, commonVeto: null };
const f = (over: Partial<AutoSendFacts>): AutoSendFacts => ({ ...clean, ...over });

describe("autoSendDecision — her şart tek başına tutar", () => {
  it("KONTROL: temiz konuşma → gönderilir, sebep yok", () => {
    expect(autoSendDecision(clean)).toEqual({ allowed: true, reasons: [], blockKinds: [] });
  });
  it.each([
    [{ controlMode: "host" as const }, "host_control"],
    [{ blocks: [{ kind: "safety_incident" as const, scope: "conversation" as const, itemId: null }] }, "conversation_block"],
    [{ newerGuestMessage: true }, "newer_guest_message"],
    [{ hostQueued: true }, "host_queued"],
    [{ commonVeto: "reservation_cancelled" }, "common_veto"],
  ])("%o → %s", (over, reason) => {
    const d = autoSendDecision(f(over));
    expect(d.allowed).toBe(false);
    expect(d.reasons).toEqual([reason]);
  });
  it("sebepler sabit sırada, hepsi birden", () => {
    const d = autoSendDecision(
      f({
        controlMode: "host",
        blocks: [
          { kind: "hazard_unverified", scope: "conversation", itemId: null },
          { kind: "safety_incident", scope: "conversation", itemId: null },
          { kind: "legacy_problem", scope: "item", itemId: "i1" },
        ],
        newerGuestMessage: true,
        hostQueued: true,
        commonVeto: "org_switch_off",
      }),
    );
    expect(d.reasons).toEqual(["host_control", "conversation_block", "item_block", "newer_guest_message", "host_queued", "common_veto"]);
    expect(d.blockKinds).toEqual(["safety_incident", "hazard_unverified", "legacy_problem"]);
  });
});

describe("öğe kapsamlı engel yalnız kendi öğesini tutar (kurucu: bağımsız güvenli soru cevaplanır)", () => {
  const itemBlock = { kind: "technical" as const, scope: "item" as const, itemId: "fault-1" };
  it("taslak engelli öğeyi cevaplıyor → tutulur", () => {
    expect(autoSendDecision(f({ blocks: [itemBlock], draftItemIds: ["fault-1"] }))).toMatchObject({ allowed: false, reasons: ["item_block"] });
  });
  it("taslak BAŞKA öğeyi (çöp sorusu) cevaplıyor → gider", () => {
    expect(autoSendDecision(f({ blocks: [itemBlock], draftItemIds: ["trash-1"] }))).toMatchObject({ allowed: true, reasons: [] });
  });
  it("öğe kimliği olmayan öğe kapsamlı engel hiçbir taslağı tutmaz (bozuk kayıt sessizce her şeyi durdurmasın)", () => {
    expect(autoSendDecision(f({ blocks: [{ kind: "technical", scope: "item", itemId: null }] })).allowed).toBe(true);
  });
  it("öğesiz taslak (öğe kipi kapalı) öğe kapsamlı engelden etkilenmez; konuşma kapsamlı engel yine tutar", () => {
    expect(autoSendDecision(f({ blocks: [itemBlock], draftItemIds: [] })).allowed).toBe(true);
    expect(autoSendDecision(f({ blocks: [{ kind: "safety_incident", scope: "conversation", itemId: null }], draftItemIds: [] })).allowed).toBe(false);
  });
});

describe("gölge kıyası (G0) — yalnız ayrışmada konuşur", () => {
  it("🚨 kurucunun bulduğu hata: açık tehlikede host'un tek cevabından sonra bugün AI gönderir, yeni model tutar", () => {
    const next = autoSendDecision(f({ blocks: [{ kind: "safety_incident", scope: "conversation", itemId: null }] }));
    expect(shadowMismatch(true, next)).toEqual({ direction: "new_blocks_old_sends", reasons: ["conversation_block"], blockKinds: ["safety_incident"] });
  });
  it("ters yön: bugün tutulan (ör. tek kötü taslak bütün konuşmayı durdurdu), yeni model gönderirdi", () => {
    expect(shadowMismatch(false, autoSendDecision(clean))).toEqual({ direction: "new_sends_old_blocks", reasons: [], blockKinds: [] });
  });
  it("KONTROL: aynı karar → sessiz", () => {
    expect(shadowMismatch(true, autoSendDecision(clean))).toBeNull();
    expect(shadowMismatch(false, autoSendDecision(f({ hostQueued: true })))).toBeNull();
  });
});
