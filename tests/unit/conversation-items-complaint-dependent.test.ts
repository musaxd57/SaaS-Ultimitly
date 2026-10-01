import { describe, it, expect } from "vitest";
import { composeItemsPlan } from "@/lib/conversation-items/plan";
import { COMPLAINT_INDEPENDENT_KINDS, complaintDependent, complaintDependentHold, type ItemKind } from "@/lib/conversation-items/core";

// ---------------------------------------------------------------------------
// ŞİKÂYETE BAĞLI İSTEK (kurucu kararı 10-01): "Gürültü yüzünden uyuyamadık, yine olursa ne yapacağız?" tek şikâyet + ona bağlı yardım
// talebi. Anlama katmanı ikiye bölse de (şikâyet + "ne yapacağız?") yardım talebi cevaplanabilir SAYILMAZ; doğrudan kapıya verilse de
// cevap GİTMEZ. Bağımsız "Wi-Fi ağı hangisi?" cevaplanır. Önceki turun şikâyeti bugünkü isteği bağlamaz (K8).
// ---------------------------------------------------------------------------

type T = { messageId: string; kind: ItemKind; sensitivity: "none" | "sensitive" | "emergency" };
const complaint = (messageId = "m1"): T => ({ messageId, kind: "complaint_issue", sensitivity: "sensitive" });
const ask = (kind: ItemKind, messageId = "m1"): T => ({ messageId, kind, sensitivity: "none" });
const held = (kind: ItemKind, earlier = false) => ({ kind, sensitivity: "sensitive" as const, riskType: null, ...(earlier ? { earlier } : {}) });
const plan = (turnItems: T[], heldItems: ReturnType<typeof held>[]) => composeItemsPlan({ turnItems, held: heldItems, hints: new Map() });

describe("plan — şikâyete bağlı istek cevaplanabilir sayılmaz", () => {
  it("🚨 şikâyet + 'yine olursa ne yapacağız?' (diğer / ev kuralı / insan talebi türü) → cevaplanabilir YOK, tur tamamen tutulur", () => {
    for (const kind of ["other", "house_rules", "amenities", "appliance_help", "cleaning_linen"] as ItemKind[]) {
      const p = plan([complaint(), ask(kind)], [held("complaint_issue")]);
      expect(p.answerable, kind).toEqual([]);
      expect(p.allHeld, kind).toBe(true);
      expect(p.replyItems.held.map((h) => h.kind), kind).toEqual(["complaint_issue", kind]);
    }
  });

  it("bağımsız bilgi ('Wi-Fi ağı hangisi?') cevaplanır; bağlı istek aynı turda bırakılır", () => {
    const p = plan([complaint(), ask("other"), ask("wifi")], [held("complaint_issue")]);
    expect(p.answerable.map((a) => a.item.kind)).toEqual(["wifi"]);
    expect(p.answerable[0].ref).toBe("R1");
    expect(p.gateItems.answerableKinds).toEqual(["wifi"]);
  });

  it("çok mesajlı tur: şikâyet bir mesajda, 'ne yapacağız?' sonraki mesajda → yine bağlı", () => {
    const p = plan([complaint("m1"), ask("other", "m2")], [held("complaint_issue")]);
    expect(p.answerable).toEqual([]);
  });

  it("KONTROL: ÖNCEKİ turun tutulan şikâyeti bugünkü isteği bağlamaz (K8)", () => {
    const p = plan([ask("amenities", "m2")], [held("complaint_issue", true)]);
    expect(p.answerable.map((a) => a.item.kind)).toEqual(["amenities"]);
    // Kapı girdisi de önceki tur işaretini taşır — ikinci kemer bugünkü isteği tutmaz.
    expect(complaintDependentHold(p.gateItems)).toBe(false);
  });

  it("KONTROL: şikâyet yokken (ödeme tutuluyor) istekler bugünkü gibi cevaplanabilir", () => {
    const p = plan([{ messageId: "m1", kind: "payment_invoice", sensitivity: "sensitive" }, ask("other")], [held("payment_invoice")]);
    expect(p.answerable.map((a) => a.item.kind)).toEqual(["other"]);
  });

  it("bağımsız tür kümesi KAPALI ve dar (genişletme kurucu kararı)", () => {
    expect([...COMPLAINT_INDEPENDENT_KINDS].sort()).toEqual(
      ["access_keys", "checkin_time", "checkout_time", "directions_transport", "local_recommendations", "luggage", "parking", "wifi"].sort(),
    );
    for (const k of COMPLAINT_INDEPENDENT_KINDS) expect(complaintDependent(k, [held("complaint_issue")])).toBe(false);
  });
});

describe("kapı — iki öğe DOĞRUDAN verilse de şikâyete bağlı cevap tutulur (ikinci kemer)", () => {
  it("🚨 tutulan şikâyet (bu tur) + cevaplanabilir 'diğer' → tut", () => {
    expect(complaintDependentHold({ held: [held("complaint_issue")], answerableKinds: ["other"] })).toBe(true);
    expect(complaintDependentHold({ held: [held("complaint_issue")], answerableKinds: ["wifi", "house_rules"] })).toBe(true);
  });
  it("KONTROL: bağımsız Wi-Fi geçer; önceki turun şikâyeti bağlamaz; şikâyetsiz tutuş bağlamaz", () => {
    expect(complaintDependentHold({ held: [held("complaint_issue")], answerableKinds: ["wifi"] })).toBe(false);
    expect(complaintDependentHold({ held: [held("complaint_issue", true)], answerableKinds: ["other"] })).toBe(false);
    expect(complaintDependentHold({ held: [held("payment_invoice")], answerableKinds: ["other"] })).toBe(false);
    expect(complaintDependentHold({ held: [], answerableKinds: ["other"] })).toBe(false);
  });
});
