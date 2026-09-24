import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ — UÇTAN UCA (09-24; DB gerçek, cevap modeli MOCK, anlama katmanı + bekçi sahte fetch).
// Kurucu: "hassas istek = ENGEL değil, doğrulama iş akışı. Her şey doğrulanmışsa insana düşmesin; eksik / çelişki /
// doğrulanamayan / gerçek host kararı → insan." Pinlenen:
//  · olgu yükleyici: aynı gün devir, önceki çıkışın GEÇ olanı, temizlik "bitti" işaretinin zamanı, çakışma, iptal satırı,
//    dün gece yalnız taze kaynakla boş, kiracı yalıtımı;
//  · kural deposu: yaz/oku/güncelle, bozuk satır = kapalı, başka kiracı okuyamaz;
//  · kanal oto-yanıtı: her şey doğrulanmışsa KODDAN kurulan onay gider (gerekçe `early_checkin_verified`, `ec` kanıtı,
//    host'a görev notu); tek eksik → insan (hangi kontrolün düştüğü kanıtta); kod metni de kapının geri kalanından geçer;
//  · "AI öner": host'a kontrol listesi + taslak; kural rotası yönetici kapılı ve kiracı kapsamlı.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  suggestReply: vi.fn(),
  classifyMessage: vi.fn(),
}));
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn().mockResolvedValue(undefined) };
});
/** Onay metnini BOZMAK için kanca (kapının kod metnini de sınadığını göstermek): `null` = gerçek metin. */
let approvalTextOverride: string | null = null;
vi.mock("@/lib/early-checkin/reply", async (orig) => {
  const actual = await orig<typeof import("@/lib/early-checkin/reply")>();
  return {
    ...actual,
    earlyCheckinApprovalText: (...args: Parameters<typeof actual.earlyCheckinApprovalText>) => {
      const real = actual.earlyCheckinApprovalText(...args);
      return real !== null && approvalTextOverride !== null ? approvalTextOverride : real;
    },
  };
});

import { suggestReply } from "@/lib/ai";
import { sendOnChannel } from "@/lib/messaging";
import { applyChannelAutoReply } from "@/lib/automation";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { loadEarlyCheckinFacts } from "@/lib/early-checkin/load";
import { autoEarlyCheckinPropertyIds, earlyCheckinRuleWhere, loadEarlyCheckinRule, saveEarlyCheckinRule, EARLY_CHECKIN_TRIGGER } from "@/lib/early-checkin/rules";
import { earlyCheckinRuleHash } from "@/lib/early-checkin/workflow";
import { decideEarlyCheckin } from "@/lib/early-checkin/core";
import type { EarlyCheckinRule } from "@/lib/early-checkin/core";
import { POST as aiSuggest } from "@/app/api/conversations/[id]/ai-suggest/route";
import { PUT as putRule, DELETE as deleteRule } from "@/app/api/properties/[id]/early-checkin-rule/route";
import { DELETE as deleteProperty } from "@/app/api/properties/[id]/route";

const mockSuggest = vi.mocked(suggestReply);
const mockSend = vi.mocked(sendOnChannel);

// İstanbul (UTC+3, yaz saati yok): 14 Ekim 11:40. Önceki misafir 11:00'de (08:00Z) çıktı, temizlik 11:30'da bitti.
const NOW = new Date("2026-10-14T08:40:00.000Z");
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);
const CLEANED_AT = new Date("2026-10-14T08:30:00.000Z");
const RULE: EarlyCheckinRule = { mode: "auto", earliest: "12:00", fee: { amount: 30, currency: "EUR" }, note: null };
const ASK = "Hi! Could we check in at 13:00 today?";

let userSeq = 0;
async function org() {
  const o = await prisma.organization.create({
    data: { name: "Test Org", timezone: "Europe/Istanbul", autoReplyHospitable: true, autoReplyStartHour: 0, autoReplyEndHour: 0 },
  });
  const p = await prisma.property.create({ data: { organizationId: o.id, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  // "Bitti" işareti yalnız KİMLİKLİ kullanıcı kaydından sayılır (kanıt modeli) — temizlik ekibi üyesi.
  const cleaner = await prisma.user.create({
    data: { organizationId: o.id, name: "Temizlik", email: `temizlik-${++userSeq}@example.com`, passwordHash: "x", role: "staff" },
  });
  return { orgId: o.id, propertyId: p.id, cleanerId: cleaner.id };
}

async function reservation(propertyId: string, arrival: string, departure: string, extra: Record<string, unknown> = {}) {
  return prisma.reservation.create({
    data: { propertyId, guestName: "Misafir", arrivalDate: midnight(arrival), departureDate: midnight(departure), status: "confirmed", channel: "airbnb", ...extra },
  });
}

/** Aynı gün devir: önceki misafir bugün çıkıyor, bizim misafir bugün geliyor; isteğe bağlı temizlik görevi. */
async function turnover(opts: { cleaned?: Date | null; cleaningStatus?: string; guestCheckout?: string | null } = {}) {
  const { orgId, propertyId, cleanerId } = await org();
  const previous = await reservation(propertyId, "2026-10-12", "2026-10-14", { guestCheckoutTime: opts.guestCheckout ?? null });
  const own = await reservation(propertyId, "2026-10-14", "2026-10-16");
  if (opts.cleaned !== undefined) {
    const task = await prisma.task.create({
      data: { propertyId, reservationId: previous.id, type: "cleaning", title: "Temizlik", status: opts.cleaningStatus ?? "done", origin: "system", dueAt: midnight("2026-10-14") },
    });
    if (opts.cleaned) await prisma.taskUpdate.create({ data: { taskId: task.id, userId: cleanerId, status: "done", createdAt: opts.cleaned } });
  }
  const prep = await prisma.task.create({ data: { propertyId, reservationId: own.id, type: "checkin_prep", title: "Giriş hazırlığı", origin: "system" } });
  return { orgId, propertyId, cleanerId, previous, own, prepTaskId: prep.id };
}

const REQUESTED = { time: "13:00", sources: 2, conflict: false };

describe("olgu yükleyici — yalnız okur, org kapsamlı", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("aynı gün devir + çıkıştan sonra atılmış 'bitti' işareti → hazır; önceki çıkış mülk varsayılanı", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    const out = await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(out?.facts).toMatchObject({
      standardCheckIn: "15:00",
      reservation: { status: "confirmed", arrivalKey: "2026-10-14" },
      todayKey: "2026-10-14",
      previousSameDay: { checkoutTime: "11:00" },
      otherOverlaps: 0,
      readiness: "ready",
      previousNightVerifiedVacant: false,
    });
    expect(out?.rule).toBeNull();
  });

  it("önceki misafirin bildirdiği saat varsayılandan GEÇSE o sayılır (erken bildirilen sayılmaz)", async () => {
    const late = await turnover({ cleaned: CLEANED_AT, guestCheckout: "13:30" });
    const a = await loadEarlyCheckinFacts({ organizationId: late.orgId, propertyId: late.propertyId, reservationId: late.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(a?.facts.previousSameDay).toEqual({ checkoutTime: "13:30" });
    // Geç beyan zaten beklenen saattir; ayrıca "erken beyan" diye taşınmaz.
    expect(a?.facts.previousDeclaredCheckout).toBeUndefined();
    // 11:30'daki işaret 13:30 çıkıştan ÖNCE → dünkü/erken dokunma, hazır SAYILMAZ.
    expect(a?.facts.readiness).toBe("not_ready");
    await resetDb();
    const early = await turnover({ cleaned: CLEANED_AT, guestCheckout: "09:00" });
    const b = await loadEarlyCheckinFacts({ organizationId: early.orgId, propertyId: early.propertyId, reservationId: early.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(b?.facts.previousSameDay).toEqual({ checkoutTime: "11:00" });
    // Erken beyan karara girmez, yalnız host bilgisi olarak taşınır (G2).
    expect(b?.facts.previousDeclaredCheckout).toBe("09:00");
    await resetDb();
    const same = await turnover({ cleaned: CLEANED_AT, guestCheckout: "11:00" });
    const c = await loadEarlyCheckinFacts({ organizationId: same.orgId, propertyId: same.propertyId, reservationId: same.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(c?.facts.previousDeclaredCheckout).toBeUndefined();
  });

  it("🚨 devirde AÇIK bakım/kontrol görevi (ayrılan ya da gelen konaklamaya bağlı, ya da devir gününe tarihli) → açık sorun; kapalı / başka gün sayılmaz", async () => {
    const cases: [string, (t: Awaited<ReturnType<typeof turnover>>) => Record<string, unknown>, boolean][] = [
      ["ayrılan konaklamaya bağlı açık bakım", (t) => ({ reservationId: t.previous.id, type: "maintenance", status: "todo" }), true],
      ["bağsız, devir gününe tarihli açık kontrol", () => ({ reservationId: null, type: "checkout_review", status: "in_progress", dueAt: midnight("2026-10-14") }), true],
      ["kapanmış bakım", (t) => ({ reservationId: t.previous.id, type: "maintenance", status: "done" }), false],
      // Gelen misafirin konaklamasına bağlı açık bakım ("varıştan önce ısıtıcıyı onar") da "hazır" dedirtmez (inceleme 09-24).
      ["bizim misafirin rezervasyonuna bağlı bakım", (t) => ({ reservationId: t.own.id, type: "maintenance", status: "todo" }), true],
      ["bağsız, başka güne tarihli bakım", () => ({ reservationId: null, type: "maintenance", status: "todo", dueAt: midnight("2026-10-13") }), false],
      ["eksik eşya (açık sorun sayılmaz)", (t) => ({ reservationId: t.previous.id, type: "restock", status: "todo" }), false],
    ];
    for (const [name, data, expected] of cases) {
      await resetDb();
      const t = await turnover({ cleaned: CLEANED_AT });
      await prisma.task.create({ data: { propertyId: t.propertyId, title: "Sorun", origin: "manual", ...data(t) } as never });
      const out = await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
      expect(out?.facts.openIssue, name).toBe(expected);
      // Hazırlık ayrı kalır: açık sorun "hazır" hükmünü değiştirmez, kararı host'a bırakır.
      expect(out?.facts.readiness, name).toBe("ready");
    }
  });

  it("🚨 inceleme 09-24: çıkıştan önceki kanıt ek (konaklama içi) temizlik görevinden gelemez; geri alınmış 'başladım' kanıt değil", async () => {
    const consent = { ...RULE, readyBeforeCheckout: true };
    const args = (t: { orgId: string; propertyId: string; own: { id: string } }) => ({
      organizationId: t.orgId,
      propertyId: t.propertyId,
      reservationId: t.own.id,
      now: NOW,
      requested: { time: "10:00", sources: 2, conflict: false },
      singleIntent: true,
    });
    // (a) Asıl çıkış temizliği 10:45'te "bitti" (başladım YOK); aynı gün, aynı konaklamaya bağlı YAPAY ZEKÂ ek temizlik
    //     görevi 09:00 başladım → 09:20 bitti (misafir içerideyken yapılmış olabilir) → çıkış kanıtı SAYILMAZ.
    const t = await turnover();
    await saveEarlyCheckinRule(t.orgId, t.propertyId, consent);
    const main = await prisma.task.create({
      data: { propertyId: t.propertyId, reservationId: t.previous.id, type: "cleaning", title: "Temizlik", status: "done", origin: "system", dueAt: midnight("2026-10-14") },
    });
    await prisma.taskUpdate.create({ data: { taskId: main.id, userId: t.cleanerId, status: "done", createdAt: new Date("2026-10-14T07:45:00.000Z") } });
    const extra = await prisma.task.create({
      data: { propertyId: t.propertyId, reservationId: t.previous.id, type: "cleaning", title: "Ek temizlik", status: "done", origin: "ai", dueAt: midnight("2026-10-14") },
    });
    await prisma.taskUpdate.create({ data: { taskId: extra.id, userId: t.cleanerId, status: "in_progress", createdAt: new Date("2026-10-14T06:00:00.000Z") } });
    await prisma.taskUpdate.create({ data: { taskId: extra.id, userId: t.cleanerId, status: "done", createdAt: new Date("2026-10-14T06:20:00.000Z") } });
    expect((await loadEarlyCheckinFacts(args(t)))?.facts).toMatchObject({ readiness: "not_ready", departureConfirmed: false });
    // KONTROL: aynı sıra asıl çıkış temizliğindeyse kanıt sayılır.
    await prisma.taskUpdate.create({ data: { taskId: main.id, userId: t.cleanerId, status: "in_progress", createdAt: new Date("2026-10-14T07:10:00.000Z") } });
    expect((await loadEarlyCheckinFacts(args(t)))?.facts).toMatchObject({ readiness: "ready", departureConfirmed: true });
    // (b) başladım → yapılacak (geri alındı) → bitti: temizlik oturumu kanıtı yok.
    await resetDb();
    const u = await turnover();
    await saveEarlyCheckinRule(u.orgId, u.propertyId, consent);
    const task = await prisma.task.create({
      data: { propertyId: u.propertyId, reservationId: u.previous.id, type: "cleaning", title: "Temizlik", status: "done", origin: "system", dueAt: midnight("2026-10-14") },
    });
    for (const [status, at] of [["in_progress", "06:00"], ["todo", "06:05"], ["done", "07:30"]] as const) {
      await prisma.taskUpdate.create({ data: { taskId: task.id, userId: u.cleanerId, status, createdAt: new Date(`2026-10-14T${at}:00.000Z`) } });
    }
    expect((await loadEarlyCheckinFacts(args(u)))?.facts).toMatchObject({ readiness: "not_ready", departureConfirmed: false });
  });

  it("mülkte bağsız açık bakım (tarihsiz / vadesi geçmiş) ve temizlikçinin BUGÜNKÜ notu yalnız otomatik gönderimi durdurur", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    const args = { organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true };
    expect((await loadEarlyCheckinFacts(args))?.facts).toMatchObject({ maintenanceOpen: false, cleaningNote: false, openIssue: false });
    const m = await prisma.task.create({ data: { propertyId: t.propertyId, type: "maintenance", title: "Duş bataryası", status: "todo", origin: "manual" } });
    expect((await loadEarlyCheckinFacts(args))?.facts).toMatchObject({ maintenanceOpen: true, openIssue: false });
    // Vadesi ileride olan bağsız bakım (ör. gelecek hafta boya) engel değil; kapanmış bakım da değil.
    await prisma.task.update({ where: { id: m.id }, data: { dueAt: new Date("2026-10-20T00:00:00.000Z") } });
    expect((await loadEarlyCheckinFacts(args))?.facts.maintenanceOpen).toBe(false);
    await prisma.task.update({ where: { id: m.id }, data: { dueAt: new Date("2026-10-10T00:00:00.000Z"), status: "done" } });
    expect((await loadEarlyCheckinFacts(args))?.facts.maintenanceOpen).toBe(false);
    // Temizlikçinin devir temizliğine BUGÜN yazdığı not → otomatik yok; dünkü not / kullanıcısız (sistem) not sayılmaz.
    const cleaningTask = await prisma.task.findFirstOrThrow({ where: { propertyId: t.propertyId, type: "cleaning" } });
    await prisma.taskUpdate.create({ data: { taskId: cleaningTask.id, userId: t.cleanerId, note: "dün bakıldı", createdAt: new Date("2026-10-13T10:00:00.000Z") } });
    await prisma.taskUpdate.create({ data: { taskId: cleaningTask.id, userId: null, note: "sistem", createdAt: new Date("2026-10-14T08:00:00.000Z") } });
    expect((await loadEarlyCheckinFacts(args))?.facts.cleaningNote).toBe(false);
    await prisma.taskUpdate.create({ data: { taskId: cleaningTask.id, userId: t.cleanerId, note: "Misafir hâlâ içeride", createdAt: new Date("2026-10-14T08:32:00.000Z") } });
    const out = await loadEarlyCheckinFacts(args);
    expect(out?.facts.cleaningNote).toBe(true);
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    expect(decideEarlyCheckin(out!.facts, await loadEarlyCheckinRule(t.orgId, t.propertyId))).toMatchObject({
      status: "approvable",
      autoSend: false,
      failed: ["cleaning_note"],
    });
  });

  it("temizlikçi başladı (G4) yalnız KİMLİKLİ ve BUGÜNKÜ 'başladım' + görev hâlâ sürüyorsa", async () => {
    const started = async (update: { userId: "cleaner" | null; at: string }, taskStatus = "in_progress") => {
      await resetDb();
      const t = await turnover();
      const task = await prisma.task.create({
        data: { propertyId: t.propertyId, reservationId: t.previous.id, type: "cleaning", title: "Temizlik", status: taskStatus, origin: "system", dueAt: midnight("2026-10-14") },
      });
      await prisma.taskUpdate.create({
        data: { taskId: task.id, userId: update.userId === "cleaner" ? t.cleanerId : null, status: "in_progress", createdAt: new Date(update.at) },
      });
      const out = await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
      return out?.facts;
    };
    expect(await started({ userId: "cleaner", at: "2026-10-14T08:10:00.000Z" })).toMatchObject({ cleaningStarted: true, readiness: "not_ready" });
    expect((await started({ userId: null, at: "2026-10-14T08:10:00.000Z" }))?.cleaningStarted).toBe(false);
    expect((await started({ userId: "cleaner", at: "2026-10-13T15:00:00.000Z" }))?.cleaningStarted).toBe(false);
    expect((await started({ userId: "cleaner", at: "2026-10-14T08:10:00.000Z" }, "todo"))?.cleaningStarted).toBe(false);
  });

  it("🚨 hazırlık: işaret çıkıştan önce, 5 dakikadan taze ya da görev açıksa hazır DEĞİL; görev yoksa bilinmiyor", async () => {
    const cases: [Parameters<typeof turnover>[0], string][] = [
      [{ cleaned: new Date("2026-10-14T07:59:00.000Z") }, "not_ready"],
      [{ cleaned: new Date("2026-10-14T08:37:00.000Z") }, "not_ready"],
      [{ cleaned: null, cleaningStatus: "in_progress" }, "not_ready"],
      [{}, "unknown"],
    ];
    for (const [opts, expected] of cases) {
      await resetDb();
      const t = await turnover(opts);
      const out = await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
      expect(out?.facts.readiness, JSON.stringify(opts)).toBe(expected);
    }
  });

  it("varış gecesini işgal eden başka rezervasyon çakışmadır; iptal satırı sayılmaz", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await reservation(t.propertyId, "2026-10-13", "2026-10-15", { status: "cancelled" });
    const clean = await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(clean?.facts.otherOverlaps).toBe(0);
    await reservation(t.propertyId, "2026-10-14", "2026-10-15");
    const clash = await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(clash?.facts.otherOverlaps).toBe(1);
  });

  it("🚨 P1 (inceleme 09-24): konaklama içi temizlik görevi çıkıştan SONRA kapatılsa da çıkış temizliği AÇIKSA hazır DEĞİL", async () => {
    const t = await turnover({ cleaned: null, cleaningStatus: "todo" });
    // Önceki misafirin konaklaması sırasında açılmış (şikâyet) temizlik görevi: vadesi konaklama içinde, çıkıştan sonra kapatıldı.
    const side = await prisma.task.create({
      data: { propertyId: t.propertyId, reservationId: t.previous.id, type: "cleaning", title: "Ek temizlik", status: "done", origin: "ai", dueAt: new Date("2026-10-13T09:00:00.000Z") },
    });
    await prisma.taskUpdate.create({ data: { taskId: side.id, userId: t.cleanerId, status: "done", createdAt: new Date("2026-10-14T08:20:00.000Z") } });
    const out = await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(out?.facts).toMatchObject({ readiness: "not_ready", readinessNote: "open" });
    expect(out?.readyAt).toBeNull();
    // Çıkış temizliği görevi HİÇ yoksa (mülk yaşam döngüsü görevi üretmiyor): konaklama içi görevin geç "bitti"si yine
    // hazır YAPMAZ — küme çıkış gününe bağlı görevlerden kurulur, o gün görev yok → bilinmiyor.
    await prisma.task.deleteMany({ where: { propertyId: t.propertyId, id: { not: side.id } } });
    const lone = await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(lone?.facts).toMatchObject({ readiness: "unknown" });
    // Çıkış günündeki İKİNCİ bir temizlik görevi açıkken de hazır değil; ikisi de kapanınca hazır.
    await resetDb();
    const u = await turnover({ cleaned: CLEANED_AT });
    const extra = await prisma.task.create({
      data: { propertyId: u.propertyId, reservationId: u.previous.id, type: "cleaning", title: "Çarşaf", status: "in_progress", origin: "manual", dueAt: midnight("2026-10-14") },
    });
    const args = { organizationId: u.orgId, propertyId: u.propertyId, reservationId: u.own.id, now: NOW, requested: REQUESTED, singleIntent: true };
    expect((await loadEarlyCheckinFacts(args))?.facts.readiness).toBe("not_ready");
    await prisma.task.update({ where: { id: extra.id }, data: { status: "done" } });
    await prisma.taskUpdate.create({ data: { taskId: extra.id, userId: u.cleanerId, status: "done", createdAt: CLEANED_AT } });
    expect((await loadEarlyCheckinFacts(args))?.facts.readiness).toBe("ready");
  });

  it("🚨 ayrılan konaklamaya bağlı TARİHSİZ temizlik görevi de bu devrin kümesindedir: açıksa hazır değil, kimlikli bitti sayılır", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    const undated = await prisma.task.create({
      data: { propertyId: t.propertyId, reservationId: t.previous.id, type: "cleaning", title: "Çarşaf", status: "todo", origin: "manual", dueAt: null },
    });
    const args = { organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true };
    expect((await loadEarlyCheckinFacts(args))?.facts).toMatchObject({ readiness: "not_ready", readinessNote: "open" });
    await prisma.task.update({ where: { id: undated.id }, data: { status: "done" } });
    await prisma.taskUpdate.create({ data: { taskId: undated.id, userId: t.cleanerId, status: "done", createdAt: CLEANED_AT } });
    expect((await loadEarlyCheckinFacts(args))?.facts.readiness).toBe("ready");
    // Başka bir konaklamaya bağlı tarihsiz görev bu devre girmez.
    const other = await reservation(t.propertyId, "2026-10-01", "2026-10-03");
    await prisma.task.create({ data: { propertyId: t.propertyId, reservationId: other.id, type: "cleaning", title: "Eski", status: "todo", origin: "manual", dueAt: null } });
    expect((await loadEarlyCheckinFacts(args))?.facts.readiness).toBe("ready");
  });

  it("gecesiz / ters kayıt varış gününe dokunuyorsa hüküm verilemez → çakışma", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await reservation(t.propertyId, "2026-10-14", "2026-10-14");
    const out = await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(out?.facts.otherOverlaps).toBe(1);
  });

  it("aynı gün devir YOKSA hazırlık varıştan önceki EN SON çıkışın temizliğine bakar (daha eskisine değil)", async () => {
    const { orgId, propertyId, cleanerId } = await org();
    const older = await reservation(propertyId, "2026-10-05", "2026-10-08");
    const latest = await reservation(propertyId, "2026-10-09", "2026-10-12");
    const own = await reservation(propertyId, "2026-10-14", "2026-10-16");
    const oldTask = await prisma.task.create({ data: { propertyId, reservationId: older.id, type: "cleaning", title: "T", status: "done", origin: "system", dueAt: midnight("2026-10-08") } });
    await prisma.taskUpdate.create({ data: { taskId: oldTask.id, userId: cleanerId, status: "done", createdAt: new Date("2026-10-08T10:00:00.000Z") } });
    await prisma.task.create({ data: { propertyId, reservationId: latest.id, type: "cleaning", title: "T", status: "todo", origin: "system", dueAt: midnight("2026-10-12") } });
    const out = await loadEarlyCheckinFacts({ organizationId: orgId, propertyId, reservationId: own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(out?.facts).toMatchObject({ previousSameDay: null, readiness: "not_ready" });
  });

  it("aynı gün İKİ ayrılan (önceki iki misafir çakışmış) → çakışma sayılır", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await reservation(t.propertyId, "2026-10-11", "2026-10-14");
    const out = await loadEarlyCheckinFacts({ organizationId: t.orgId, propertyId: t.propertyId, reservationId: t.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(out?.facts.otherOverlaps).toBe(1);
  });

  it("aynı gün devir YOKSA dün gece yalnız TAZE kaynakla boş sayılır; kaynaksız mülkte doğrulanamaz", async () => {
    const { orgId, propertyId } = await org();
    const own = await reservation(propertyId, "2026-10-14", "2026-10-16");
    const args = { organizationId: orgId, propertyId, reservationId: own.id, now: NOW, requested: REQUESTED, singleIntent: true };
    expect((await loadEarlyCheckinFacts(args))?.facts).toMatchObject({ previousSameDay: null, previousNightVerifiedVacant: false });
    await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://x.example/f.ics", lastStatus: "ok", lastSyncedAt: new Date(NOW.getTime() - 30 * 60_000) },
    });
    expect((await loadEarlyCheckinFacts(args))?.facts.previousNightVerifiedVacant).toBe(true);
    // Dün gece dolu (tek gece kalan başka misafir dün geldi, BUGÜN çıkıyor) → artık aynı gün devir.
    await reservation(propertyId, "2026-10-13", "2026-10-14");
    expect((await loadEarlyCheckinFacts(args))?.facts).toMatchObject({ previousSameDay: { checkoutTime: "11:00" }, previousNightVerifiedVacant: false });
  });

  it("🚨 kiracı yalıtımı: başka org'un mülkü → null; başka mülkün rezervasyonu → rezervasyon YOK", async () => {
    const a = await turnover({ cleaned: CLEANED_AT });
    const b = await org();
    expect(await loadEarlyCheckinFacts({ organizationId: b.orgId, propertyId: a.propertyId, reservationId: a.own.id, now: NOW, requested: REQUESTED, singleIntent: true })).toBeNull();
    const cross = await loadEarlyCheckinFacts({ organizationId: b.orgId, propertyId: b.propertyId, reservationId: a.own.id, now: NOW, requested: REQUESTED, singleIntent: true });
    expect(cross?.facts.reservation).toBeNull();
    // Anti-vakum: kendi kapsamında aynı çağrı rezervasyonu görür.
    expect((await loadEarlyCheckinFacts({ organizationId: a.orgId, propertyId: a.propertyId, reservationId: a.own.id, now: NOW, requested: REQUESTED, singleIntent: true }))?.facts.reservation).not.toBeNull();
  });
});

describe("kural deposu (migration'sız, `AutomationRule`)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("yaz → oku → güncelle (tek satır) → kaldır; bozuk satır KAPALI; başka kiracı okuyamaz", async () => {
    const a = await org();
    const b = await org();
    await saveEarlyCheckinRule(a.orgId, a.propertyId, RULE);
    await saveEarlyCheckinRule(a.orgId, a.propertyId, { ...RULE, earliest: "13:00" });
    expect(await loadEarlyCheckinRule(a.orgId, a.propertyId)).toEqual({ ...RULE, earliest: "13:00" });
    expect(await prisma.automationRule.count({ where: { organizationId: a.orgId, triggerType: EARLY_CHECKIN_TRIGGER } })).toBe(1);
    expect(await loadEarlyCheckinRule(b.orgId, a.propertyId)).toBeNull();
    await prisma.automationRule.updateMany({ where: { organizationId: a.orgId }, data: { actionJson: "{bozuk" } });
    expect(await loadEarlyCheckinRule(a.orgId, a.propertyId)).toBeNull();
    // Okunabilen ama geçersiz kural da KAPALI (okuma yeniden doğrular; tanınmayan kip otomatik sayılmaz).
    await prisma.automationRule.updateMany({ where: { organizationId: a.orgId }, data: { actionJson: JSON.stringify({ ...RULE, mode: "always" }) } });
    expect(await loadEarlyCheckinRule(a.orgId, a.propertyId)).toBeNull();
    await saveEarlyCheckinRule(a.orgId, a.propertyId, null);
    expect(await prisma.automationRule.count()).toBe(0);
  });

  it("🚨 eşzamanlı kayıtlar (iki sekme / çift tık) TEK satır bırakır: mülk satırı kilitlenir, yazımlar sıralanır", async () => {
    const a = await org();
    await Promise.all(Array.from({ length: 6 }, (_, i) => saveEarlyCheckinRule(a.orgId, a.propertyId, { ...RULE, earliest: `1${i}:00` })));
    expect(await prisma.automationRule.count({ where: { organizationId: a.orgId, triggerType: EARLY_CHECKIN_TRIGGER } })).toBe(1);
    expect((await loadEarlyCheckinRule(a.orgId, a.propertyId))?.earliest).toMatch(/^1[0-5]:00$/);
  });

  it("🚨 kilit DETERMİNİSTİK: başka bir yazıcı mülk satırını tutarken kayıt BEKLER, onun satırını görüp günceller", async () => {
    // Yukarıdaki Promise.all yarışı şansa bağlı (mutasyon turu 09-24: kilidi silen mutant ondan sağ çıktı). Burada eşzamanlı
    // yazıcı kilidi ELİNDE tutup satırını eklemiş ama henüz bitirmemiş: kilit varsa kayıt bekler ve bittikten sonra o satırı
    // günceller (tek satır); kilit yoksa kayıt onun bitmemiş satırını göremez ve ikinci satırı yaratır.
    const a = await org();
    const where = earlyCheckinRuleWhere(a.orgId, a.propertyId);
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let holding!: () => void;
    const held = new Promise<void>((r) => (holding = r));
    const writer = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "Property" WHERE "id" = ${a.propertyId} FOR UPDATE`;
        await tx.automationRule.create({ data: { ...where, actionJson: JSON.stringify(RULE), isEnabled: true, name: "Erken giriş kuralı" } });
        holding();
        await hold;
      },
      { timeout: 15_000 },
    );
    await held;
    let settled = false;
    const save = saveEarlyCheckinRule(a.orgId, a.propertyId, { ...RULE, earliest: "11:00" }).finally(() => {
      settled = true;
    });
    // Kayıt ya bitti (kilit yok) ya da kilitte bekliyor: ikisinden biri görülene kadar (en fazla ~3 sn) bekle.
    for (let i = 0; i < 300 && !settled; i++) {
      const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_locks WHERE NOT granted`;
      if (n > 0n) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    release();
    await writer;
    await save;
    const rows = await prisma.automationRule.findMany({ where });
    expect(rows).toHaveLength(1);
    expect((await loadEarlyCheckinRule(a.orgId, a.propertyId))?.earliest).toBe("11:00");
  });

  it("yeniden değerlendirme yalnız OTOMATİK kurallı mülkleri depodan okur: taslak, kapalı, bozuk ve başka kiracınınki yok", async () => {
    const a = await org();
    const [auto, draft, off, broken] = await Promise.all(
      ["Otomatik", "Taslak", "Kapalı", "Bozuk"].map((name) => prisma.property.create({ data: { organizationId: a.orgId, name } })),
    );
    await saveEarlyCheckinRule(a.orgId, auto.id, RULE);
    await saveEarlyCheckinRule(a.orgId, draft.id, { ...RULE, mode: "draft" });
    await saveEarlyCheckinRule(a.orgId, off.id, { ...RULE, mode: "off" });
    await prisma.automationRule.create({
      data: { organizationId: a.orgId, name: "x", triggerType: EARLY_CHECKIN_TRIGGER, conditionJson: JSON.stringify({ propertyId: broken.id }), actionJson: "{bozuk", isEnabled: true },
    });
    const b = await org();
    await saveEarlyCheckinRule(b.orgId, b.propertyId, RULE);
    expect(await autoEarlyCheckinPropertyIds(a.orgId)).toEqual([auto.id]);
    expect(await autoEarlyCheckinPropertyIds(b.orgId)).toEqual([b.propertyId]);
  });
});

// ─── kanal oto-yanıtı ───────────────────────────────────────────────────────

const MODEL = {
  intent: "early_checkin",
  confidence: 0.9,
  reply: "Thanks! I'll check with the host whether an early check-in is possible and get back to you.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "en",
  riskType: null,
  usedSources: [],
  sourceAudit: { declared: 0, verified: 0 },
  missingInfo: [],
  statedCheckoutTime: null,
  stayChange: { asked: "early_checkin" as const, stance: "defers" as const },
};

const nlu = (time: string | null, extraIntents: string[] = [], kind = "early_checkin") => ({
  language: "en",
  requests: [
    { intent: kind === "late_checkout" ? "late_checkout" : "early_checkin", query_tr: "erken giriş", query_original: "early check-in" },
    ...extraIntents.map((intent) => ({ intent, query_tr: "soru", query_original: "question" })),
  ],
  stay_change: { requested: true, kind, checkin_time: kind === "early_checkin" ? time : null, checkout_time: kind === "late_checkout" ? time : null },
});
const guard = (time: string | null, defers: boolean, kind = "early_checkin") => ({
  guest_requests_change: true,
  kind,
  requested_checkin_time: kind === "early_checkin" ? time : null,
  requested_checkout_time: kind === "late_checkout" ? time : null,
  reply_states_calendar: false,
  reply_grants_change: false,
  reply_defers_to_host: defers,
  reply_refuses: false,
  reply_amounts: [],
  reply_price_terms: false,
});

/** Şema adına göre cevap veren sahte OpenAI (anlama katmanı + bekçi aynı uca gider). */
function semanticFetch(answers: Record<string, Record<string, unknown>>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format?.json_schema?.name as string;
    const verdict = answers[name];
    if (!verdict) throw new Error(`beklenmeyen şema: ${name}`);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] }), { status: 200 });
  });
}

async function conversationFor(t: { propertyId: string; own: { id: string } }, body = ASK) {
  const c = await prisma.conversation.create({
    data: {
      propertyId: t.propertyId,
      reservationId: t.own.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      externalReservationId: "res-1",
      messages: { create: [{ direction: "inbound", senderName: "Alex", body, createdAt: new Date(NOW.getTime() - 2 * 60_000) }] },
    },
    select: { id: true },
  });
  return c.id;
}

/** Karar kaydı: `ec` burada yalnız karar alanlarıyla (s/f/a) kıyaslanır; dayanaklar `ecTrace` ile ayrıca sınanır. */
async function decision(conversationId: string) {
  const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
  const evidence = JSON.parse(String(ev.kbEvidenceJson)) as { ec?: { s: string; f: string[]; a: string } };
  return { finalDecision: ev.finalDecision, reason: ev.reason, ec: evidence.ec ? { s: evidence.ec.s, f: evidence.ec.f, a: evidence.ec.a } : undefined };
}

async function ecTrace(conversationId: string): Promise<Record<string, unknown>> {
  const ev = await prisma.riskEvent.findFirstOrThrow({ where: { conversationId, surface: "auto_reply" } });
  const ec = (JSON.parse(String(ev.kbEvidenceJson)) as { ec: Record<string, unknown> }).ec;
  return Object.fromEntries(Object.entries(ec).filter(([k]) => !["s", "f", "a"].includes(k)));
}

describe("kanal oto-yanıtı — doğrulanmış erken giriş", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    approvalTextOverride = null;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "1");
    mockSend.mockResolvedValue({ ok: true, externalId: "ext-1" } as never);
    mockSuggest.mockResolvedValue(MODEL);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 her şey doğrulanmış + kural otomatik → KODDAN kurulan onay gider (insana düşmez); gerekçe, kanıt ve host notu", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: guard("13:00", false) }));
    const id = await conversationFor(t);
    const out = await applyChannelAutoReply(id);
    expect(out.sent).toBe(true);
    const body = String(mockSend.mock.calls[0][1]);
    expect(body.startsWith("The apartment is ready — you can check in today (14 October) from 13:00. The early check-in fee is €30.")).toBe(true);
    expect(body).not.toContain("check with the host");
    expect(await decision(id)).toEqual({ finalDecision: "auto_sent", reason: "early_checkin_verified", ec: { s: "approvable", f: [], a: "1" } });
    const note = await prisma.taskUpdate.findFirstOrThrow({ where: { taskId: t.prepTaskId } });
    // Ücret TUTARI nota girmez (görev geçmişini temizlik de görür).
    expect(note.note).toBe("Erken giriş 13:00 otomatik onaylandı.");
  });

  it("🚨 karar kaydı dayanakları: hangi devir (rezervasyon), hangi 'hazır' kaydı + anı, hangi kural sürümü, kaç model okudu", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: guard("13:00", false) }));
    const id = await conversationFor(t);
    expect((await applyChannelAutoReply(id)).sent).toBe(true);
    const ready = await prisma.taskUpdate.findFirstOrThrow({ where: { task: { reservationId: t.previous.id }, status: "done" } });
    expect(await ecTrace(id)).toEqual({
      dr: t.previous.id,
      rm: ready.id,
      rt: "2026-10-14T08:30Z",
      rh: earlyCheckinRuleHash(await loadEarlyCheckinRule(t.orgId, t.propertyId)),
      n: "2",
    });
    // Kural sonradan değişirse kayıttaki parmak izi eski sürümü gösterir (karar yeniden kurulabilir).
    await saveEarlyCheckinRule(t.orgId, t.propertyId, { ...RULE, fee: { amount: 45, currency: "EUR" } });
    expect(earlyCheckinRuleHash(await loadEarlyCheckinRule(t.orgId, t.propertyId))).not.toBe((await ecTrace(id)).rh);
  });

  it("🚨 kalıcı mesaj kuyruğu AÇIKKEN doğrulanmış onay otomatik gitmez (bayat 'bugün' riski); kapıyı geçen erteleme kuyruğa girer", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: guard("13:00", false) }));
    const id = await conversationFor(t);
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(await prisma.messageOutbox.count()).toBe(0);
    expect(await decision(id)).toEqual({ finalDecision: "human_review", reason: "availability_unconfirmed", ec: { s: "approvable", f: ["queued_delivery"], a: "0" } });
    // İki model ertelemeyi doğruladı → yalnız ERTELEME kuyruğa girer (onay değil).
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    mockSuggest.mockResolvedValue(MODEL);
    const u = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(u.orgId, u.propertyId, RULE);
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: guard("13:00", true) }));
    const id2 = await conversationFor(u);
    expect(await applyChannelAutoReply(id2)).toMatchObject({ sent: true, queued: true });
    const row = await prisma.messageOutbox.findFirstOrThrow();
    expect(row.body).toContain("check with the host");
    expect(row.body).not.toContain("The apartment is ready");
    expect(await decision(id2)).toEqual({ finalDecision: "auto_sent", reason: "gate_passed", ec: { s: "approvable", f: ["queued_delivery"], a: "0" } });
    expect(await prisma.taskUpdate.count({ where: { taskId: u.prepTaskId } })).toBe(0);
  });

  it("bilgi sorusunun politika metni kuyruklu teslimde de kuyruğa girer (zamana bağlı değil); gerekçe `early_checkin_policy`", async () => {
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    mockSuggest.mockResolvedValue({ ...MODEL, reply: "It depends on availability.", stayChange: { asked: "none", stance: "none" } });
    const info = { ...nlu(null), stay_change: { requested: false, kind: "none", checkin_time: null, checkout_time: null } };
    const noRequest = { ...guard(null, false), guest_requests_change: false, kind: "none" };
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: info, stay_change_guard: noRequest }));
    const id = await conversationFor(t, "Is early check-in paid?");
    expect(await applyChannelAutoReply(id)).toMatchObject({ sent: true, queued: true });
    expect((await prisma.messageOutbox.findFirstOrThrow()).body).toContain("The early check-in fee is €30.");
    expect((await decision(id)).reason).toBe("early_checkin_policy");
  });

  it("🚨 iki model ertelemeyi doğrulayıp kapı GEÇSE de doğrulanmış onay ertelemenin yerine geçer (misafir 'soracağım' değil cevap alır)", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: guard("13:00", true) }));
    const id = await conversationFor(t);
    expect((await applyChannelAutoReply(id)).sent).toBe(true);
    expect(String(mockSend.mock.calls[0][1])).toContain("you can check in today (14 October) from 13:00");
    expect((await decision(id)).reason).toBe("early_checkin_verified");
  });

  it("kural 'taslak' → doğrulanmış cevap GİTMEZ; kapıyı geçen erteleme bugünkü gibi gider (kanıtta onaylanabilir, a=0)", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, { ...RULE, mode: "draft" });
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: guard("13:00", true) }));
    const id = await conversationFor(t);
    expect((await applyChannelAutoReply(id)).sent).toBe(true);
    expect(String(mockSend.mock.calls[0][1])).toContain("check with the host");
    expect(await decision(id)).toEqual({ finalDecision: "auto_sent", reason: "gate_passed", ec: { s: "approvable", f: [], a: "0" } });
    expect(await prisma.taskUpdate.count({ where: { taskId: t.prepTaskId } })).toBe(0);
  });

  it("🚨 tek eksik → İNSAN, hangi kontrolün düştüğü kanıtta (temizlik bitmedi / saatler çelişiyor / başka konu / kural yok)", async () => {
    const cases: { name: string; opts: Parameters<typeof turnover>[0]; rule: EarlyCheckinRule | null; understand: ReturnType<typeof nlu>; g: ReturnType<typeof guard>; failed: string[]; status: string }[] = [
      // Kanıt HENÜZ yok (temizlik görevi yok) → `pending`: reddedilmez, host'a gider; temizlik işaretiyle yeniden kontrol edilebilir.
      { name: "temizlik görevi yok", opts: {}, rule: RULE, understand: nlu("13:00"), g: guard("13:00", false), failed: ["ready_unknown"], status: "pending" },
      { name: "iki model farklı saat", opts: { cleaned: CLEANED_AT }, rule: RULE, understand: nlu("13:00"), g: guard("12:00", false), failed: ["time_conflict"], status: "needs_host" },
      { name: "mesajda başka soru", opts: { cleaned: CLEANED_AT }, rule: RULE, understand: nlu("13:00", ["wifi"]), g: guard("13:00", false), failed: ["multi_intent"], status: "approvable" },
      { name: "kural yok", opts: { cleaned: CLEANED_AT }, rule: null, understand: nlu("13:00"), g: guard("13:00", false), failed: ["rule_off"], status: "needs_host" },
    ];
    for (const c of cases) {
      await resetDb();
      vi.clearAllMocks();
      __resetUnderstandingCache();
      mockSuggest.mockResolvedValue(MODEL);
      const t = await turnover(c.opts);
      if (c.rule) await saveEarlyCheckinRule(t.orgId, t.propertyId, c.rule);
      vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: c.understand, stay_change_guard: c.g }));
      const id = await conversationFor(t);
      expect((await applyChannelAutoReply(id)).sent, c.name).toBe(false);
      expect(mockSend, c.name).not.toHaveBeenCalled();
      expect(await decision(id), c.name).toEqual({ finalDecision: "human_review", reason: "availability_unconfirmed", ec: { s: c.status, f: c.failed, a: "0" } });
    }
  });

  it("🚨 kod metni de kapının GERİ KALANINDAN geçer: onay metni çıktı vetosuna takılırsa gitmez (insan)", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    approvalTextOverride = "I have arranged everything — you can check in from 13:00.";
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: guard("13:00", false) }));
    const id = await conversationFor(t);
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await decision(id)).toMatchObject({ finalDecision: "human_review", reason: "availability_unconfirmed", ec: { s: "approvable", a: "0" } });
  });

  it("geç çıkış isteğinde akış HİÇ koşmaz (kanıtta `ec` yok, bugünkü davranış)", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    mockSuggest.mockResolvedValue({ ...MODEL, intent: "late_checkout", stayChange: { asked: "late_checkout", stance: "defers" } });
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00", [], "late_checkout"), stay_change_guard: guard("13:00", false, "late_checkout") }));
    const id = await conversationFor(t, "Could we check out at 13:00 on our last day?");
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect((await decision(id)).ec).toBeUndefined();
  });

  it("🚨 erken giriş + geç çıkış birlikte (bekçi çıkış saatini de okudu) → akış koşmaz, hiçbir şey gitmez", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: { ...guard("13:00", false), requested_checkout_time: "13:00" } }));
    const id = await conversationFor(t, "Could we check in at 13:00 and also leave at 13:00 on our last day?");
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await decision(id)).ec).toBeUndefined();
  });

  it("🚨 ikinci konaklama isteğini YALNIZ anlama katmanının istek listesi görse de akış koşmaz (mutasyon turu 09-24, RV16)", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    // Yuva ve bekçi yalnız erken giriş görüyor; ikinci istek (geç çıkış) yalnız anlama katmanının LİSTESİNDE.
    const nluTwo = nlu("13:00", ["late_checkout"]);
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nluTwo, stay_change_guard: guard("13:00", false) }));
    const id = await conversationFor(t);
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await decision(id)).ec).toBeUndefined();
  });

  it("🚨 P1-2 (inceleme 09-24): cevap modeli 'insan talebi' dediyse (anlama katmanı yalnız erken giriş görse de) onay GİTMEZ", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    mockSuggest.mockResolvedValue({ ...MODEL, intent: "human_request" });
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: guard("13:00", false) }));
    const id = await conversationFor(t, "Can we check in at 13:00? I also need to speak to the host.");
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await decision(id)).ec).toEqual({ s: "approvable", f: ["multi_intent"], a: "0" });
  });

  it("🚨 anlama katmanı BAVUL isteği de gördüyse onay yok: erken giriş onayı bavul isteğini cevaplamaz (host)", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00", ["luggage"]), stay_change_guard: guard("13:00", false) }));
    const id = await conversationFor(t, "Hi! Could we check in at 13:00 today, or at least drop our bags?");
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    const d = await decision(id);
    expect(d.ec?.s).toBe("needs_host");
    expect(d.ec?.f).toContain("luggage");
  });

  it("🚨 'istek yok' diyen bekçinin saati ikinci kaynak SAYILMAZ → tek kaynak, onay otomatik gitmez", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    const noRequest = { ...guard("13:00", false), guest_requests_change: false, kind: "none" };
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: noRequest }));
    const id = await conversationFor(t);
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await decision(id)).ec).toEqual({ s: "approvable", f: ["single_source_time"], a: "0" });
  });

  it("🚨 simetri (mutasyon turu 09-24, RV10 hayatta kalmıştı): 'istek yok' diyen ANLAMA katmanının saati de kaynak SAYILMAZ", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    // Anlama katmanı saati okudu ama istek görmedi (tutarsız okuma) → yalnız bekçinin saati sayılır.
    const nluNoRequest = { ...nlu("13:00"), stay_change: { requested: false, kind: "none", checkin_time: "13:00", checkout_time: null } };
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nluNoRequest, stay_change_guard: guard("13:00", false) }));
    const id = await conversationFor(t);
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await decision(id)).ec).toEqual({ s: "approvable", f: ["single_source_time"], a: "0" });
  });

  it("🚨 anlama katmanının BOŞ sorgulu insan talebi kalemi artık düşmez → tek konu değil, onay gitmez", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    const understanding = { ...nlu("13:00"), requests: [...nlu("13:00").requests, { intent: "human_request", query_tr: "", query_original: "" }] };
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: understanding, stay_change_guard: guard("13:00", false) }));
    const id = await conversationFor(t);
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("🚨 P2 (inceleme 09-24): modelin DÜŞÜK güveni onay metnine taşınır — güven tabanı kalkmaz; kapı güvenden kapandıysa akış hiç koşmaz", async () => {
    // (a) müsaitlik önce kapattı → akış koştu, ama onay metni modelin 0.5 güveniyle kapıdan geçemez.
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    mockSuggest.mockResolvedValue({ ...MODEL, confidence: 0.5 });
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: guard("13:00", false) }));
    const a = await conversationFor(t);
    expect((await applyChannelAutoReply(a)).sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect((await decision(a)).ec).toEqual({ s: "approvable", f: [], a: "0" });
    // (b) iki model ertelemeyi doğruladı (müsaitlik geçti) ama güven düşük → kapı güvenden kapandı → akış KOŞMAZ.
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    mockSuggest.mockResolvedValue({ ...MODEL, confidence: 0.5 });
    const u = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(u.orgId, u.propertyId, RULE);
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00"), stay_change_guard: guard("13:00", true) }));
    const b = await conversationFor(u);
    expect((await applyChannelAutoReply(b)).sent).toBe(false);
    expect((await decision(b)).ec).toBeUndefined();
  });

  it("KONTROL: bayraklar kapalıyken (bugünkü üretim) saat iki modelden okunamaz → otomatik onay YOK", async () => {
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "");
    vi.stubEnv("AI_STAY_GUARD_ENABLED", "");
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const id = await conversationFor(t);
    expect((await applyChannelAutoReply(id)).sent).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(await decision(id)).toMatchObject({ finalDecision: "human_review", ec: { s: "needs_host", f: ["time_unknown"], a: "0" } });
  });
});

// ─── "AI öner" + kural rotası ───────────────────────────────────────────────

const owner = (organizationId: string, role: SessionPayload["role"] = "owner"): SessionPayload => ({
  userId: "u-owner",
  organizationId,
  role,
  email: "o@example.com",
  name: "O",
  sessionEpoch: 0,
});

describe("AI öner — host'a kontrol listesi + doğrulanmış taslak (gönderim YOK)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __resetUnderstandingCache();
    approvalTextOverride = null;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("KB_RETRIEVAL_MODE", "legacy");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    mockSuggest.mockResolvedValue(MODEL);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rota olguları + taslağı döner; bekçi burada koşmadığı için saat tek kaynaklı (otomatik değil, taslak var)", async () => {
    const t = await turnover({ cleaned: CLEANED_AT });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, RULE);
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00") }));
    const id = await conversationFor(t);
    session = owner(t.orgId);
    const res = await aiSuggest(new NextRequest(`http://localhost/api/conversations/${id}/ai-suggest`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { earlyCheckin: Record<string, unknown> | null };
    expect(json.earlyCheckin).toMatchObject({
      status: "approvable",
      failed: ["single_source_time"],
      approvedTime: "13:00",
      mode: "auto",
      fee: { amount: 30, currency: "EUR" },
      facts: { arrivalToday: true, requestedTime: "13:00", previousCheckout: "11:00", readiness: "ready", otherOverlaps: 0 },
    });
    expect(String(json.earlyCheckin?.draft)).toMatch(/^The apartment is ready — you can check in today \(14 October\) from 13:00/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rota kanıt alanlarını panele taşır: çıkış doğrulandı, açık sorun, misafirin erken beyanı, temizlikçi başladı", async () => {
    const t = await turnover({ guestCheckout: "10:00" });
    // Kanıtlı erken hazırlık: aynı kullanıcı 09:30 başladı, 10:15 hazır (çıkıştan önce); host rızası açık.
    const task = await prisma.task.create({
      data: { propertyId: t.propertyId, reservationId: t.previous.id, type: "cleaning", title: "Temizlik", status: "done", origin: "system", dueAt: midnight("2026-10-14") },
    });
    await prisma.taskUpdate.create({ data: { taskId: task.id, userId: t.cleanerId, status: "in_progress", createdAt: new Date("2026-10-14T06:30:00.000Z") } });
    await prisma.taskUpdate.create({ data: { taskId: task.id, userId: t.cleanerId, status: "done", createdAt: new Date("2026-10-14T07:15:00.000Z") } });
    await prisma.task.create({ data: { propertyId: t.propertyId, reservationId: t.previous.id, type: "maintenance", title: "Sorun", status: "todo", origin: "manual" } });
    await saveEarlyCheckinRule(t.orgId, t.propertyId, { ...RULE, readyBeforeCheckout: true });
    vi.stubGlobal("fetch", semanticFetch({ guest_message_understanding: nlu("13:00") }));
    const id = await conversationFor(t);
    session = owner(t.orgId);
    const res = await aiSuggest(new NextRequest(`http://localhost/api/conversations/${id}/ai-suggest`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), {
      params: Promise.resolve({ id }),
    });
    const json = (await res.json()) as { earlyCheckin: { status: string; failed: string[]; facts: Record<string, unknown> } | null };
    expect(json.earlyCheckin?.facts).toMatchObject({ departureConfirmed: true, openIssue: true, previousDeclaredCheckout: "10:00", cleaningStarted: false, readiness: "ready" });
    expect(json.earlyCheckin?.status).toBe("needs_host");
    expect(json.earlyCheckin?.failed).toContain("open_issue");
  });
});

describe("PUT/DELETE /api/properties/[id]/early-checkin-rule", () => {
  const put = (id: string, body: unknown) =>
    putRule(new NextRequest(`http://localhost/api/properties/${id}/early-checkin-rule`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
      params: Promise.resolve({ id }),
    });
  const del = (id: string) => deleteRule(new NextRequest(`http://localhost/api/properties/${id}/early-checkin-rule`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

  beforeEach(async () => {
    await resetDb();
  });

  it("yönetici yazar; denetim kaydı DEĞER taşımaz; kaldırma kuralı siler", async () => {
    const { orgId, propertyId } = await org();
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@example.com", passwordHash: "x", role: "owner" } });
    session = { ...owner(orgId), userId: user.id };
    // Formun kendi örnek notu kabul edilmeli (söz veren "göndereceğiz" biçimi çıktı vetosuna takılır → reddedilir).
    expect((await put(propertyId, { ...RULE, note: "Ödeme talebini Airbnb üzerinden göndereceğiz." })).status).toBe(400);
    expect((await put(propertyId, { ...RULE, note: "Ödeme talebi Airbnb üzerinden gelecek." })).status).toBe(200);
    expect(await loadEarlyCheckinRule(orgId, propertyId)).toMatchObject({ mode: "auto", fee: { amount: 30, currency: "EUR" } });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "property.early_checkin_rule_set" } });
    // TAM eşitlik: rastgele kimlik "30" içerebilir (ilk sürümdeki /30|EUR/ kalıbı bu yüzden aralıklı kırmızıydı).
    expect(JSON.parse(String(audit.metadataJson))).toEqual({ propertyId, fields: ["mode", "earliest", "fee", "note", "readyBeforeCheckout"] });
    expect((await del(propertyId)).status).toBe(200);
    expect(await loadEarlyCheckinRule(orgId, propertyId)).toBeNull();
  });

  it("🚨 mülk silinince erken giriş kuralı da silinir (sahipsiz satır kalmaz); başka mülkün kuralına dokunulmaz", async () => {
    const { orgId, propertyId } = await org();
    const other = await prisma.property.create({ data: { organizationId: orgId, name: "Menekşe" } });
    await saveEarlyCheckinRule(orgId, propertyId, RULE);
    await saveEarlyCheckinRule(orgId, other.id, RULE);
    session = owner(orgId);
    const res = await deleteProperty(new NextRequest(`http://localhost/api/properties/${propertyId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: propertyId }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.automationRule.count({ where: { organizationId: orgId } })).toBe(1);
    expect(await loadEarlyCheckinRule(orgId, other.id)).not.toBeNull();
  });

  it("🚨 temizlik/personel rolü ücreti değiştiremez (403); başka kiracının mülkü 404; geçersiz girdi 400 + sade mesaj", async () => {
    const a = await org();
    const b = await org();
    session = owner(a.orgId, "staff");
    expect((await put(a.propertyId, RULE)).status).toBe(403);
    expect((await del(a.propertyId)).status).toBe(403);
    session = owner(b.orgId);
    expect((await put(a.propertyId, RULE)).status).toBe(404);
    expect((await del(a.propertyId)).status).toBe(404);
    expect(await prisma.automationRule.count()).toBe(0);
    session = owner(a.orgId);
    const bad = await put(a.propertyId, { ...RULE, fee: { amount: -1, currency: "EUR" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { fields?: { _?: string } }).fields?._).toMatch(/^Kuralı kontrol edin/);
    // Anti-vakum: kendi mülküne geçerli istek çalışır.
    expect((await put(a.propertyId, RULE)).status).toBe(200);
  });
});
