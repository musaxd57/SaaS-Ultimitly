import { describe, it, expect } from "vitest";
import { evaluateStay, type StayReadinessInput } from "@/lib/readiness-list/evaluate";

// UX-10 D5 (kurucu 11-13): "Giriş mesajını gönderin" düğmesi YALNIZ otomatik giriş mesajının bu misafire gitmeyeceği ve elle gönderilebileceği
// satırlarda. Gönderildi / hazır / kontrol bekliyor / doldurulamıyor / yazılmamış / silinmiş / bağlantı yok / kanalsız satırlarda YOK; acil
// durdurma açıkken (kill_switch) YOK (temkinli seçim, kurucu sorusu S-1b). Yükleyici "gönderilebilir" demediyse hiçbir satırda yok.

const at = (iso: string) => new Date(iso);
const stay = (over: Partial<StayReadinessInput> = {}): StayReadinessInput => ({
  timeZone: "Europe/Istanbul",
  now: at("2026-11-07T10:00:00Z"),
  cleaning: { status: "unknown", note: "none", previousKnown: false, previousCheckout: null, readyMark: null, tasks: [] },
  openIssue: false,
  maintenanceOpen: false,
  overlaps: 0,
  commitments: [],
  needs: [],
  accessInstructions: null,
  checkInTime: "15:00",
  ...over,
});
const access = (input: StayReadinessInput) => evaluateStay(input).factors.find((f) => f.key === "access")!;

describe("Girişler — 'Giriş mesajını gönderin' görünürlüğü", () => {
  it("otomatik giriş kapalı / taban yok / rezervasyon tabandan önce + gönderilebilir → düğme var", () => {
    expect(access(stay({ autoCheckin: { state: "disabled" }, checkinManualSendable: true })).sendCheckin).toBe(true);
    expect(access(stay({ autoCheckin: { state: "not_sending", reason: "no_baseline" }, checkinManualSendable: true })).sendCheckin).toBe(true);
    expect(access(stay({ autoCheckin: { state: "not_sending", reason: "before_baseline" }, checkinManualSendable: true })).sendCheckin).toBe(true);
    // Kurucu 11-18 akşam: iki dairede kayıtlı rezervasyonda otomatik mesaj tutulur; ev sahibi doğru dairenin satırından elle gönderebilir.
    const two = access(stay({ autoCheckin: { state: "not_sending", reason: "two_properties" }, checkinManualSendable: true }));
    expect(two.sendCheckin).toBe(true);
    expect(two.label).toBe("Bu rezervasyon iki dairede kayıtlı, otomatik mesaj gitmez · giriş bilgisini siz gönderin");
  });

  it("yükleyici gönderilebilir demediyse (metin yok, onaysız, bağlantı yok…) aynı satırlarda düğme YOK", () => {
    expect(access(stay({ autoCheckin: { state: "disabled" } })).sendCheckin).toBeUndefined();
    expect(access(stay({ autoCheckin: { state: "disabled" }, checkinManualSendable: false })).sendCheckin).toBeUndefined();
    expect(access(stay({ autoCheckin: { state: "not_sending", reason: "before_baseline" }, checkinManualSendable: false })).sendCheckin).toBeUndefined();
  });

  it("🚨 acil durdurma, bağlantı yok, kanalsız, silinmiş misafir → düğme YOK (gönderilebilir dense bile)", () => {
    for (const reason of ["kill_switch", "no_connection", "no_channel", "erased"] as const) {
      expect(access(stay({ autoCheckin: { state: "not_sending", reason }, checkinManualSendable: true })).sendCheckin, reason).toBeUndefined();
    }
  });

  it("🚨 gönderici zaten gönderecek / gönderdi / önce metin düzeltilmeli → düğme YOK", () => {
    const states: StayReadinessInput["autoCheckin"][] = [
      { state: "sent", at: at("2026-11-07T07:00:00Z") },
      { state: "ready", id: "a1", at: at("2026-11-06T07:00:00Z") },
      { state: "review", id: "a1", at: at("2026-11-06T07:00:00Z") },
      { state: "skipped", reason: "unfilled" },
      { state: "missing" },
    ];
    for (const a of states) expect(access(stay({ autoCheckin: a, checkinManualSendable: true })).sendCheckin, a!.state).toBeUndefined();
  });

  it("düğme satırın etiketini ve konuşma bağlantısını değiştirmez", () => {
    const f = access(stay({ autoCheckin: { state: "disabled" }, checkinManualSendable: true }));
    expect(f.label).toBe("Otomatik giriş mesajı kapalı · giriş bilgisini siz gönderin");
    expect(f.link).toEqual({ to: "conversation" });
  });
});
