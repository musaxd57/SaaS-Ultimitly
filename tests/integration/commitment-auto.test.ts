import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// SÖZ → GÖREV OTOMATİK (kurucu kararları 10-17 gece, migration 75) — gerçek PostgreSQL.
//  · "Onayla host uğraşmasın; host yapıcam yazdıysa saati ile kaydetsin, akşam yazmışsa akşam olarak tutsun" → onaysız söz + görev; saat
//    UYDURULMAZ (açık saat · gün dilimi · yalnız gün).
//  · "Aynı görevin saati güncellensin ama aynı görevden bahsedildiği bağlamdan anlaşılsın — başka bir şeyi değiştirmemeli" → kesin eşleşme
//    taşınır, belirsizde HİÇBİR şey değişmez (öneri kartı seçim ister).
//  · "Havlu / temizlik / eksik eşya kapansın, arıza kalsın" · "20" (günlük sınır) · "isterlerse kapatabilsinler" (işletme ayarı).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/messaging", async (orig) => ({ ...(await orig<typeof import("@/lib/messaging")>()), sendOnChannel: vi.fn() }));
vi.mock("@/lib/channels", async (orig) => ({
  ...(await orig<typeof import("@/lib/channels")>()),
  resolveOrgChannelCredential: vi.fn(async () => ({ token: "t" })),
}));

import { POST as decideRoute } from "@/app/api/ai-suggestions/route";
import { PATCH as commitmentPatch } from "@/app/api/conversations/[id]/commitments/[commitmentId]/route";
import { getConversationSuggestions } from "@/lib/ai-suggestions/load";
import {
  AUTO_COMMITMENT_DAILY_CAP,
  SWEEP_CATCHUP_MINUTES,
  applyHostCommitmentsAuto,
  closeStayEndedCommitments,
  sweepHostCommitmentsAuto,
  __stayEndHooks,
} from "@/lib/guest-commitments-auto";
import { createGuestCommitment } from "@/lib/guest-commitments";
import { commitmentDueAt, commitmentTaskTitle } from "@/lib/guest-commitments-core";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";
import { sendOnChannel } from "@/lib/messaging";
import { sendHostMessage } from "@/lib/host-send";
import { addZonedDays, dateKeyInTimeZone } from "@/lib/timezone";
import { __autoCommitmentInternals } from "@/lib/guest-commitments-auto";
import { DEMO_ORG_ID } from "@/lib/demo-tenant/constants";

const TZ = "Europe/Istanbul";
const mockSend = vi.mocked(sendOnChannel);

const decide = (body: Record<string, unknown>) =>
  decideRoute(new NextRequest("http://localhost/api/ai-suggestions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({}),
  } as never);
const patchCommitment = (conversationId: string, commitmentId: string, body: Record<string, unknown>) =>
  commitmentPatch(
    new NextRequest(`http://localhost/api/conversations/${conversationId}/commitments/${commitmentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: conversationId, commitmentId }) } as never,
  );

let seq = 0;
async function asOwner(orgId: string) {
  const u = await prisma.user.create({ data: { organizationId: orgId, name: "U", email: `u${++seq}-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
  session = { userId: u.id, organizationId: orgId, role: "owner", email: u.email, name: "U", sessionEpoch: 0 } as SessionPayload;
}

async function setup(opts: { reservationDepartureKey?: string } = {}) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await asOwner(orgId);
  const reservation = opts.reservationDepartureKey
    ? await prisma.reservation.create({
        data: {
          propertyId,
          guestName: "Misafir",
          arrivalDate: new Date(`${opts.reservationDepartureKey}T00:00:00.000Z`),
          departureDate: new Date(`${opts.reservationDepartureKey}T00:00:00.000Z`),
        },
      })
    : null;
  const conv = await prisma.conversation.create({
    data: { propertyId, guestIdentifier: "Misafir", channel: "airbnb", status: "new", reservationId: reservation?.id ?? null },
  });
  return { orgId, propertyId, conversationId: conv.id, reservationId: reservation?.id ?? null };
}

/** Ev sahibinin mesajı (gerçek zaman — günlük sınır sayımı veritabanı saatine bakar). */
async function hostSays(conversationId: string, body: string, at: Date = new Date(Date.now() - 5_000)) {
  return prisma.message.create({ data: { conversationId, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body, createdAt: at } });
}

const tomorrowKeyOf = (d: Date) => dateKeyInTimeZone(addZonedDays(d, 1, TZ), TZ);

beforeEach(async () => {
  await resetDb();
  mockSend.mockReset();
  vi.stubEnv("HOST_COMMITMENT_AUTO_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/**
 * Gerçek saatle koşan (karar rotası `decide()` kendi `new Date()`ını kullanır) ama mesajları "10 / 5 dk önce" yazan testler İstanbul'da gece
 * yarısından hemen sonra koşarsa iki mesaj farklı günlere düşer (Opus 10-17 gece-3 F14: 21:00–21:10 UTC'de kırmızı). Yalnız `Date` sahtelenir,
 * BUGÜNÜN İstanbul öğlesine: gerçek günle aynı gün → veritabanının kendi zaman damgalarıyla (karar kaydı, söz satırı) gün karışmaz.
 */
/** İşletme diliminde duvar saati "HH:MM". */
const wallClock = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

function pinIstanbulNoonToday(): Date {
  const noon = new Date(`${dateKeyInTimeZone(new Date(), TZ)}T09:00:00.000Z`);
  vi.useFakeTimers({ toFake: ["Date"], now: noon });
  return noon;
}

describe("anahtar ve ayar", () => {
  it("🚨 anahtar KAPALI → hiçbir şey açılmaz (bugünkü davranış: öneri kalır); tarama ve konaklama kapatması sorgusuz", async () => {
    vi.stubEnv("HOST_COMMITMENT_AUTO_ENABLED", "");
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.");
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 0, rescheduled: 0, skipped: 0 });
    expect(await sweepHostCommitmentsAuto(new Date(), SWEEP_CATCHUP_MINUTES)).toMatchObject({ conversations: 0, created: 0 });
    expect(await closeStayEndedCommitments()).toEqual({ closed: 0 });
    expect(await prisma.guestCommitment.count()).toBe(0);
    expect((await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment")).toHaveLength(1);
  });

  it("🚨 işletme ayarı KAPALI (anahtar açık) → söz açılmaz VE söz önerisi de çıkmaz ('isterlerse kapatabilsinler')", async () => {
    const s = await setup();
    await prisma.organization.update({ where: { id: s.orgId }, data: { autoCommitmentsEnabled: false } });
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.");
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(0);
    expect(await prisma.guestCommitment.count()).toBe(0);
    expect((await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment")).toEqual([]);
  });

  it("🚨 öneri anahtarı KAPALI + otomatik söz AÇIK → yalnız SÖZ önerisi karara açık (görev önerisi 404); ikisi de kapalı → 404", async () => {
    vi.stubEnv("AI_ACTION_SUGGESTIONS_ENABLED", "");
    const s = await setup();
    // Görev önerisi anahtarı (konuşmadaki misafir mesajı) — öneri anahtarı kapalıyken reddedilir.
    expect((await decide({ key: "task:anything", decision: "dismiss" })).status).toBe(404);
    // Söz önerisi anahtarı rotadan geçer (öneri yoksa 409 "artık geçerli değil" — 404 DEĞİL).
    expect((await decide({ key: "commitment:nothing", decision: "dismiss" })).status).toBe(409);
    vi.stubEnv("HOST_COMMITMENT_AUTO_ENABLED", "");
    expect((await decide({ key: "commitment:nothing", decision: "dismiss" })).status).toBe(404);
    void s;
  });

  it("KONTROL: anahtar KAPALIYKEN ayar kapalı olsa da öneri bugünkü gibi görünür (ayar yüzeyde yok)", async () => {
    vi.stubEnv("HOST_COMMITMENT_AUTO_ENABLED", "");
    const s = await setup();
    await prisma.organization.update({ where: { id: s.orgId }, data: { autoCommitmentsEnabled: false } });
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.");
    expect((await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment")).toHaveLength(1);
  });
});

describe("saat uydurulmaz — açık saat · gün dilimi · yalnız gün", () => {
  it("🚨 açık saat → onaysız söz + görev (kaynak auto, kaynak mesaj, aynı an); ikinci uygulama yeni söz AÇMAZ", async () => {
    const s = await setup();
    const msg = await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.");
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 1, rescheduled: 0, skipped: 0 });
    const [c] = await prisma.guestCommitment.findMany();
    const due = commitmentDueAt({ day: "tomorrow", time: "10:00" }, TZ, msg.createdAt)!;
    expect(c).toMatchObject({ source: "auto", duePrecision: "time", dayPart: null, sourceMessageId: msg.id, topic: "ac", kind: "maintenance", status: "open" });
    expect(c.dueAt.toISOString()).toBe(due.toISOString());
    const task = await prisma.task.findUniqueOrThrow({ where: { id: c.taskId! } });
    expect(task.title).toBe("Misafire söz: Arıza / bakım · klima");
    expect(task.dueAt?.toISOString()).toBe(due.toISOString());
    // Sistem kararı: aktör yok, "auto" işareti (karar kaydı aynı mesajdan sözün yeniden açılmasını engeller).
    const approved = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: s.orgId, action: "ai_suggestion.approved" } });
    expect(approved.actorUserId).toBeNull();
    expect(JSON.parse(approved.metadataJson ?? "{}")).toMatchObject({ kind: "commitment", auto: true });
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 0, rescheduled: 0, skipped: 0 });
    expect(await prisma.guestCommitment.count()).toBe(1);
    expect(await prisma.task.count()).toBe(1);
  });

  it("🚨 'Yarın akşam havlu getireceğim' → AKŞAM olarak tutulur: saat yok, görev başlığında dilim, görev vadesi yalnız-tarih çapası", async () => {
    const s = await setup();
    const msg = await hostSays(s.conversationId, "Yarın akşam havlu getireceğim.");
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
    const [c] = await prisma.guestCommitment.findMany();
    expect(c).toMatchObject({ duePrecision: "part", dayPart: "evening", kind: "towels" });
    const dayKey = tomorrowKeyOf(msg.createdAt);
    // Pencere sonu = o günün 23:59'u (işletme saati).
    expect(dateKeyInTimeZone(c.dueAt, TZ)).toBe(dayKey);
    expect(c.dueAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: TZ })).toBe("23:59");
    const task = await prisma.task.findUniqueOrThrow({ where: { id: c.taskId! } });
    expect(task.title).toBe("Misafire söz: Havlu / çarşaf · akşam");
    expect(task.dueAt?.toISOString()).toBe(`${dayKey}T12:00:00.000Z`);
  });

  it("'Havlu getireceğim' (saat / gün yok) → GÜN olarak tutulur (dilim yok, başlıkta ek yok)", async () => {
    const s = await setup();
    // Sabit an (İstanbul 12:00): gece yarısını aşan koşuda "bugün" kaymasın (Haiku 10-17 gece).
    const NOW = new Date("2026-11-20T09:00:00Z");
    const msg = await hostSays(s.conversationId, "Havlu getireceğim.", new Date(NOW.getTime() - 5_000));
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId, NOW)).created).toBe(1);
    const [c] = await prisma.guestCommitment.findMany();
    expect(c).toMatchObject({ duePrecision: "day", dayPart: null });
    expect(dateKeyInTimeZone(c.dueAt, TZ)).toBe(dateKeyInTimeZone(msg.createdAt, TZ));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: c.taskId! } })).title).toBe("Misafire söz: Havlu / çarşaf");
  });

  it.each(["Belki yarın teknisyen gelecek.", "Teknisyen yarın gelecek demiştim.", "Teknisyen ertelendi.", "Klima için teknisyen 2 hafta sonra gelecek."])(
    "kararsız / aktarılan / zamansız değişiklik '%s' → hiçbir şey açılmaz",
    async (text) => {
      const s = await setup();
      await hostSays(s.conversationId, text);
      expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(0);
      expect(await prisma.guestCommitment.count()).toBe(0);
    },
  );

  it("misafirin mesajı ve kanalın kendi otomatik mesajı söz DEĞİLDİR (yalnız ev sahibinin yazdığı)", async () => {
    const s = await setup();
    await prisma.message.create({
      data: { conversationId: s.conversationId, direction: "inbound", authorType: "guest", senderName: "Misafir", body: "Teknisyen yarın 10:00'da gelecek mi?" },
    });
    await prisma.message.create({
      data: {
        conversationId: s.conversationId,
        direction: "outbound",
        authorType: "automation",
        channelSenderRole: "automation",
        senderName: "Kanal",
        body: "Housekeeping will come tomorrow at 10.",
      },
    });
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(0);
    expect(await prisma.guestCommitment.count()).toBe(0);
  });
});

describe("günlük sınır 20 (kurucu 10-17)", () => {
  async function seedAuto(orgId: string, conversationId: string, n: number) {
    for (let i = 0; i < n; i++) {
      await prisma.guestCommitment.create({
        data: { organizationId: orgId, conversationId, kind: "towels", dueAt: new Date(Date.now() + (i + 1) * 3_600_000), source: "auto" },
      });
    }
  }

  it("🚨 bugün 20 otomatik söz açıldıysa 21.si AÇILMAZ (öneri olarak kalır); 19 iken açılır", async () => {
    expect(AUTO_COMMITMENT_DAILY_CAP).toBe(20);
    const s = await setup();
    const other = await prisma.conversation.create({ data: { propertyId: s.propertyId, guestIdentifier: "B", channel: "airbnb", status: "new" } });
    await seedAuto(s.orgId, other.id, 20);
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.");
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 0, rescheduled: 0, skipped: 1 });
    expect(await prisma.guestCommitment.count({ where: { conversationId: s.conversationId } })).toBe(0);
    expect((await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment")).toHaveLength(1);
    // Konaklama bitince kapanan otomatik söz yine sayılır (gün içinde açıldı) → hâlâ dolu.
    const seeded = await prisma.guestCommitment.findMany({ where: { conversationId: other.id }, orderBy: { id: "asc" }, take: 2 });
    await prisma.guestCommitment.update({ where: { id: seeded[0].id }, data: { status: "cancelled", closedReason: "stay_ended" } });
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(0);
    // "Yanlış, kaldır" ile kaldırılan söz sayılmaz (Haiku 10-17 gece) → yer açılır.
    await prisma.guestCommitment.update({ where: { id: seeded[1].id }, data: { status: "cancelled", closedReason: "wrong" } });
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
  });

  it("KONTROL: elle / öneriden açılan söz sınırdan sayılmaz; başka işletmenin otomatik sözü sayılmaz", async () => {
    const s = await setup();
    const t = await setup();
    const other = await prisma.conversation.create({ data: { propertyId: s.propertyId, guestIdentifier: "B", channel: "airbnb", status: "new" } });
    for (let i = 0; i < 20; i++) {
      await prisma.guestCommitment.create({ data: { organizationId: s.orgId, conversationId: other.id, kind: "towels", dueAt: new Date(Date.now() + 3_600_000), source: "manual" } });
    }
    await seedAuto(t.orgId, t.conversationId, 20);
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.");
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
  });
});

describe("BAĞLAM — saat güncellemesi yalnız kesin eşleşmede (kurucu: 'başka bir şeyi değiştirmemeli')", () => {
  it("🚨 aynı konulu yeni saat ('Klima için teknisyen yarın 11:00') → AYNI söz + AYNI görev taşınır; önceki saat izde; yeni görev YOK", async () => {
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.", new Date(Date.now() - 10 * 60_000));
    await applyHostCommitmentsAuto(s.orgId, s.conversationId);
    const before = await prisma.guestCommitment.findFirstOrThrow();
    const msg2 = await hostSays(s.conversationId, "Klima için teknisyen yarın 11:00'de gelecek.", new Date());
    const now2 = new Date(Date.now() + 1_000);
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId, now2)).toEqual({ created: 0, rescheduled: 1, skipped: 0 });
    const after = await prisma.guestCommitment.findMany();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].previousDueAt?.toISOString()).toBe(before.dueAt.toISOString());
    expect(after[0].dueAt.toISOString()).toBe(commitmentDueAt({ day: "tomorrow", time: "11:00" }, TZ, msg2.createdAt)!.toISOString());
    expect(await prisma.task.count()).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: before.taskId! } })).dueAt?.toISOString()).toBe(after[0].dueAt.toISOString());
    expect(await prisma.auditLog.count({ where: { action: "commitment.rescheduled" } })).toBe(1);
  });

  it("🚨 'Teknisyen yarın 11'e kaydı' (konusuz + değişiklik sözcüğü) TEK aday → taşınır", async () => {
    const s = await setup();
    await hostSays(s.conversationId, "Teknisyen yarın 10:00'da gelecek.", new Date(Date.now() - 10 * 60_000));
    await applyHostCommitmentsAuto(s.orgId, s.conversationId);
    const before = await prisma.guestCommitment.findFirstOrThrow();
    const msg2 = await hostSays(s.conversationId, "Teknisyen yarın 11'e kaydı.", new Date());
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId, new Date(Date.now() + 1_000))).rescheduled).toBe(1);
    const after = await prisma.guestCommitment.findFirstOrThrow();
    expect(after.id).toBe(before.id);
    expect(after.dueAt.toISOString()).toBe(commitmentDueAt({ day: "tomorrow", time: "11:00" }, TZ, msg2.createdAt)!.toISOString());
  });

  it("🚨 BAŞKA konulu söz (klima açık, 'Musluk için usta yarın 11:00') → klima DEĞİŞMEZ, ayrı söz açılır", async () => {
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.", new Date(Date.now() - 10 * 60_000));
    await applyHostCommitmentsAuto(s.orgId, s.conversationId);
    const ac = await prisma.guestCommitment.findFirstOrThrow();
    await hostSays(s.conversationId, "Musluk için usta yarın 11:00'de gelecek.", new Date());
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId, new Date(Date.now() + 1_000))).toEqual({ created: 1, rescheduled: 0, skipped: 0 });
    const acAfter = await prisma.guestCommitment.findUniqueOrThrow({ where: { id: ac.id } });
    expect(acAfter.dueAt.toISOString()).toBe(ac.dueAt.toISOString());
    expect(acAfter.previousDueAt).toBeNull();
    expect(await prisma.guestCommitment.count()).toBe(2);
  });

  it("🚨 Opus O1 (P1): AYNI KONU, FARKLI YAPAN ('Klima kumandasının pilini akşam getireceğim') teknisyen sözünü TAŞIMAZ — ayrı söz açılır", async () => {
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.", new Date(Date.now() - 10 * 60_000));
    await applyHostCommitmentsAuto(s.orgId, s.conversationId);
    const tech = await prisma.guestCommitment.findFirstOrThrow();
    await hostSays(s.conversationId, "Klima kumandasının pilini akşam getireceğim.", new Date());
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId, new Date(Date.now() + 1_000))).toEqual({ created: 1, rescheduled: 0, skipped: 0 });
    const techAfter = await prisma.guestCommitment.findUniqueOrThrow({ where: { id: tech.id } });
    expect(techAfter.dueAt.toISOString()).toBe(tech.dueAt.toISOString());
    expect(techAfter.previousDueAt).toBeNull();
    expect(await prisma.guestCommitment.count()).toBe(2);
  });

  it("🚨 Opus O8: konusuz eski söz ('Teknisyen yarın 10'da') + konulu yeni saat ('Klima için teknisyen yarın 11'de') → kendiliğinden ne taşır ne ikinci görev açar; kart sorar", async () => {
    const s = await setup();
    await createGuestCommitment({
      organizationId: s.orgId,
      conversationId: s.conversationId,
      propertyId: s.propertyId,
      reservationId: null,
      kind: "maintenance",
      dueAt: commitmentDueAt({ day: "tomorrow", time: "10:00" }, TZ, new Date())!,
      actorUserId: null,
      source: "manual",
    });
    await hostSays(s.conversationId, "Klima için teknisyen yarın 11:00'de gelecek.", new Date());
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 0, rescheduled: 0, skipped: 1 });
    expect(await prisma.guestCommitment.count()).toBe(1);
    const [sugg] = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    expect(sugg.kind === "commitment" && sugg.proposal.moveOptions?.length).toBe(1);
  });

  it("🚨 Opus O4: gün sözcüğü OLMAYAN saat değişikliği ('Teknisyen 23'e kaydı') eski sözün GÜNÜNE uygulanır (bugüne kaymaz)", async () => {
    const s = await setup();
    // Sabit an (İstanbul 12:00): "23'e kaydı" gün sözcüksüz okunursa BUGÜN 23:00 olurdu; doğru olan eski sözün günü (yarın).
    const NOW = new Date("2026-11-20T09:00:00Z");
    await hostSays(s.conversationId, "Teknisyen yarın 10:00'da gelecek.", new Date(NOW.getTime() - 10 * 60_000));
    await applyHostCommitmentsAuto(s.orgId, s.conversationId, NOW);
    const before = await prisma.guestCommitment.findFirstOrThrow();
    await hostSays(s.conversationId, "Teknisyen 23'e kaydı.", new Date(NOW.getTime() - 5 * 60_000));
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId, NOW)).rescheduled).toBe(1);
    const after = await prisma.guestCommitment.findFirstOrThrow();
    expect(dateKeyInTimeZone(before.dueAt, TZ)).toBe("2026-11-21");
    expect(dateKeyInTimeZone(after.dueAt, TZ)).toBe("2026-11-21");
    expect(after.dueAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: TZ })).toBe("23:00");
  });

  it("🚨 Haiku 2. tur: gün sözcüksüz yeni saat ('Klima için teknisyen 15:00'te gelecek') + eski söz BAŞKA günde (yarın) → kendiliğinden bugüne TAŞINMAZ, kart sorar", async () => {
    const s = await setup();
    // Sabit an (İstanbul 12:00): gün sözcüksüz "15:00" bugün okunur; eski söz yarın → hangi gün belli değil.
    const NOW = new Date("2026-11-20T09:00:00Z");
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.", new Date(NOW.getTime() - 10 * 60_000));
    await applyHostCommitmentsAuto(s.orgId, s.conversationId, NOW);
    const before = await prisma.guestCommitment.findFirstOrThrow();
    await hostSays(s.conversationId, "Klima için teknisyen 15:00'te gelecek.", new Date(NOW.getTime() - 5 * 60_000));
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId, NOW)).toEqual({ created: 0, rescheduled: 0, skipped: 1 });
    const after = await prisma.guestCommitment.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.dueAt.toISOString()).toBe(before.dueAt.toISOString());
    expect(after.previousDueAt).toBeNull();
    expect(await prisma.guestCommitment.count()).toBe(1);
    const [sugg] = (await getConversationSuggestions(s.orgId, s.conversationId, NOW)).filter((x) => x.kind === "commitment");
    expect(sugg.kind === "commitment" && sugg.proposal.moveOptions?.map((o) => o.commitmentId)).toEqual([before.id]);
  });

  it("KONTROL: gün sözcüksüz yeni saat + eski söz AYNI günde (bugün) → tek okuma, aynı söz taşınır", async () => {
    const s = await setup();
    const NOW = new Date("2026-11-20T09:00:00Z");
    await hostSays(s.conversationId, "Klima için teknisyen bugün 16:00'da gelecek.", new Date(NOW.getTime() - 60 * 60_000));
    await applyHostCommitmentsAuto(s.orgId, s.conversationId, NOW);
    const before = await prisma.guestCommitment.findFirstOrThrow();
    await hostSays(s.conversationId, "Klima için teknisyen 17:00'de gelecek.", new Date(NOW.getTime() - 5 * 60_000));
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId, NOW)).rescheduled).toBe(1);
    const after = await prisma.guestCommitment.findUniqueOrThrow({ where: { id: before.id } });
    expect(dateKeyInTimeZone(after.dueAt, TZ)).toBe("2026-11-20");
    expect(after.dueAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: TZ })).toBe("17:00");
    expect(await prisma.guestCommitment.count()).toBe(1);
  });

  it("🚨 Haiku 2. tur: AYNI an + konu, FARKLI yapan ('Klima filtresini yarın 10:00'da getireceğim' ↔ teknisyen yarın 10:00) → gizlenmez, birleşmez: ayrı söz + görev", async () => {
    pinIstanbulNoonToday();
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.", new Date(Date.now() - 10 * 60_000));
    await applyHostCommitmentsAuto(s.orgId, s.conversationId);
    const tech = await prisma.guestCommitment.findFirstOrThrow();
    await hostSays(s.conversationId, "Klima filtresini yarın 10:00'da getireceğim.", new Date(Date.now() - 5 * 60_000));
    const [sugg] = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    expect(sugg.kind === "commitment" && sugg.proposal).toMatchObject({ actor: "delivery", dueAt: tech.dueAt.toISOString() });
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 1, rescheduled: 0, skipped: 0 });
    expect(await prisma.guestCommitment.count()).toBe(2);
    // Yapan kayıtta (migration 76): teknisyen = visit, filtre = delivery.
    expect((await prisma.guestCommitment.findMany({ orderBy: { createdAt: "asc" }, select: { actor: true } })).map((r) => r.actor)).toEqual(["visit", "delivery"]);
    expect(await prisma.task.count()).toBe(2);
    const techAfter = await prisma.guestCommitment.findUniqueOrThrow({ where: { id: tech.id } });
    expect(techAfter.previousDueAt).toBeNull();
    // Karar yazıldı → öneri listeden düşer (ölü düğme yok).
    expect((await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment")).toEqual([]);
  });

  it("🚨 Opus gece-3 F4: KONUSUZ teknisyen sözü (yarın 10:00) + aynı anda 'Klima filtresini getireceğim' → ayrı söz; teknisyen sözüne 'klima' YAZILMAZ", async () => {
    pinIstanbulNoonToday();
    const s = await setup();
    await hostSays(s.conversationId, "Teknisyen yarın 10:00'da gelecek.", new Date(Date.now() - 10 * 60_000));
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
    const tech = await prisma.guestCommitment.findFirstOrThrow();
    expect([tech.topic, tech.actor]).toEqual([null, "visit"]);
    await hostSays(s.conversationId, "Klima filtresini yarın 10:00'da getireceğim.", new Date(Date.now() - 5 * 60_000));
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 1, rescheduled: 0, skipped: 0 });
    expect(await prisma.guestCommitment.count()).toBe(2);
    expect(await prisma.task.count()).toBe(2);
    expect((await prisma.guestCommitment.findUniqueOrThrow({ where: { id: tech.id } })).topic).toBeNull();
  });

  it("🚨 Opus gece-3 F4 (yazma katmanı, kilit içinde): aynı andaki BAŞKA yapanın konusuz sözüne birleşmez; AYNI yapan / bilinmeyen yapan birleşir", async () => {
    const s = await setup();
    const dueAt = commitmentDueAt({ day: "tomorrow", time: "10:00" }, TZ, new Date())!;
    const base = { organizationId: s.orgId, conversationId: s.conversationId, propertyId: s.propertyId, reservationId: null, kind: "maintenance" as const, dueAt, actorUserId: null };
    const visit = await createGuestCommitment({ ...base, actor: "visit", clientRequestId: "r-visit" });
    const delivery = await createGuestCommitment({ ...base, topic: "ac", actor: "delivery", clientRequestId: "r-del", mergeSameSlot: true });
    expect(delivery.reused).toBe(false);
    expect((await prisma.guestCommitment.findUniqueOrThrow({ where: { id: visit.id } })).topic).toBeNull();
    // KONTROL: aynı yapan → birleşir (konu yazılır); yapanı bilinmeyen istek de birleşir (bugünkü kural).
    const sameActor = await createGuestCommitment({ ...base, topic: "faucet", actor: "visit", clientRequestId: "r-visit-2", mergeSameSlot: true });
    expect([sameActor.reused, sameActor.id]).toEqual([true, visit.id]);
    const unknown = await createGuestCommitment({ ...base, actor: null, clientRequestId: "r-unknown", mergeSameSlot: true });
    expect(unknown.reused).toBe(true);
  });

  it("🚨 Opus gece-4 F19b: yapanı bilinmeyen (elle) söze yapanı bilinen öneri bağlanınca yapan YAZILIR — sonra başka yapanın sözü ona birleşmez", async () => {
    const s = await setup();
    const dueAt = commitmentDueAt({ day: "tomorrow", time: "18:00" }, TZ, new Date())!;
    const base = { organizationId: s.orgId, conversationId: s.conversationId, propertyId: s.propertyId, reservationId: null, kind: "maintenance" as const, dueAt, actorUserId: null };
    const manual = await createGuestCommitment({ ...base, clientRequestId: "r-manual" });
    expect((await createGuestCommitment({ ...base, topic: "ac", actor: "visit", clientRequestId: "r-visit", mergeSameSlot: true })).id).toBe(manual.id);
    expect((await prisma.guestCommitment.findUniqueOrThrow({ where: { id: manual.id } })).actor).toBe("visit");
    const delivery = await createGuestCommitment({ ...base, topic: "ac", actor: "delivery", clientRequestId: "r-del", mergeSameSlot: true });
    expect(delivery.id).not.toBe(manual.id);
  });

  it("🚨 Haiku 2. tur: SONRAKİ mesajdan açılmış FARKLI yapanın sözü ('filtreyi akşam getireceğim') önceki teknisyen sözünün önerisini GİZLEMEZ", async () => {
    pinIstanbulNoonToday();
    // Otomatik işleme ÇAĞRILMAZ: iki öneri de kartta (ev sahibi ikinciyi önce onaylıyor).
    const s = await setup();
    const m1 = await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.", new Date(Date.now() - 10 * 60_000));
    const m2 = await hostSays(s.conversationId, "Klima filtresini yarın akşam getireceğim.", new Date(Date.now() - 5 * 60_000));
    const sugg = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    const second = sugg.find((x) => x.kind === "commitment" && x.proposal.messageId === m2.id)!;
    expect((await decide({ key: second.key, decision: "approve" })).status).toBe(200);
    const left = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    expect(left.map((x) => x.kind === "commitment" && x.proposal.messageId)).toEqual([m1.id]);
  });

  it("KONTROL: aynı an + aynı YAPAN ('Klima için teknisyen yarın 10:00'da gelecek' tekrarı) → öneri yok, ikinci söz yok", async () => {
    pinIstanbulNoonToday();
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.", new Date(Date.now() - 10 * 60_000));
    await applyHostCommitmentsAuto(s.orgId, s.conversationId);
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.", new Date(Date.now() - 5 * 60_000));
    expect((await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment")).toEqual([]);
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 0, rescheduled: 0, skipped: 0 });
    expect(await prisma.guestCommitment.count()).toBe(1);
  });

  it("🚨 Opus gece-3 F3: saatsiz TEKRAR ('Evet, klima için teknisyen gelecek') kayıtlı 15:00'ı SİLMEZ — öneri yok, taşıma yok", async () => {
    const s = await setup();
    const NOW = new Date("2026-11-20T09:00:00Z"); // İstanbul 12:00
    await hostSays(s.conversationId, "Klima için teknisyen bugün 15:00'te gelecek.", new Date(NOW.getTime() - 60 * 60_000));
    await applyHostCommitmentsAuto(s.orgId, s.conversationId, NOW);
    const before = await prisma.guestCommitment.findFirstOrThrow();
    expect(before.duePrecision).toBe("time");
    await hostSays(s.conversationId, "Evet, klima için teknisyen gelecek, merak etmeyin.", new Date(NOW.getTime() - 5 * 60_000));
    expect((await getConversationSuggestions(s.orgId, s.conversationId, NOW)).filter((x) => x.kind === "commitment")).toEqual([]);
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId, NOW)).toEqual({ created: 0, rescheduled: 0, skipped: 0 });
    const after = await prisma.guestCommitment.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.dueAt.toISOString()).toBe(before.dueAt.toISOString());
    expect(after.duePrecision).toBe("time");
    expect(after.previousDueAt).toBeNull();
    expect(await prisma.guestCommitment.count()).toBe(1);
  });

  it("KONTROL (F3): saatsiz söz, uyumlu açık söz YOKKEN yine gün sözü olarak kaydedilir; saatli yeni söz taşımaya devam eder", async () => {
    const s = await setup();
    const NOW = new Date("2026-11-20T09:00:00Z");
    await hostSays(s.conversationId, "Havlu getireceğim.", new Date(NOW.getTime() - 5 * 60_000));
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId, NOW)).created).toBe(1);
    expect((await prisma.guestCommitment.findFirstOrThrow()).duePrecision).toBe("day");
  });

  it("🚨 Opus O19: söz mesajdan SONRA kaydedildi ama kaynak mesajı daha eski → geç gelen saat değişikliği gizlenmez, taşınır", async () => {
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.", new Date(Date.now() - 10 * 60_000));
    await applyHostCommitmentsAuto(s.orgId, s.conversationId);
    const c = await prisma.guestCommitment.findFirstOrThrow();
    // İkinci mesaj gecikmeli içeri alındı: kanalda 5 dk önce yazıldı (söz kaydından ÖNCE), şimdi geldi.
    await hostSays(s.conversationId, "Klima için teknisyen yarın 11:00'de gelecek.", new Date(Date.now() - 5 * 60_000));
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).rescheduled).toBe(1);
    expect((await prisma.guestCommitment.findUniqueOrThrow({ where: { id: c.id } })).previousDueAt).not.toBeNull();
  });

  it("🚨 Opus O20: 'Havlu getireceğim' (gün) ile sonraki 'Akşam havlu getireceğim' (akşam) aynı 23:59'da biter ama AYRI an — birleşmez, kart sorar; 'Ayrı söz' ikinci söz açar", async () => {
    pinIstanbulNoonToday();
    const s = await setup();
    await hostSays(s.conversationId, "Havlu getireceğim.", new Date(Date.now() - 10 * 60_000));
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
    const day = await prisma.guestCommitment.findFirstOrThrow();
    await hostSays(s.conversationId, "Akşam havlu getireceğim.", new Date(Date.now() - 5 * 60_000));
    const evening = (await getConversationSuggestions(s.orgId, s.conversationId)).find((x) => x.kind === "commitment");
    // Ön koşul (an aynı, kesinlik farklı): iki pencere de aynı 23:59'da biter.
    expect(evening?.kind === "commitment" && evening.proposal.dueAt).toBe(day.dueAt.toISOString());
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toMatchObject({ created: 0, skipped: 1 });
    expect(await prisma.guestCommitment.count()).toBe(1);
    // Ev sahibi "ayrı söz" seçerse AYRI söz + görev (gün sözüne birleşmez — merge sorgusu da kesinliğe bakar).
    expect((await decide({ key: evening!.key, decision: "approve", attach: "new" })).status).toBe(200);
    expect(await prisma.guestCommitment.count()).toBe(2);
    expect(await prisma.task.count()).toBe(2);
  });

  it("🚨 Opus O9: mesajda birden çok saat ('10:00-12:00 arası') → kendiliğinden kaydedilmez, kart saati sorar", async () => {
    const s = await setup();
    await hostSays(s.conversationId, "Teknisyen yarın 10:00-12:00 arası gelecek.");
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 0, rescheduled: 0, skipped: 1 });
    const [sugg] = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    expect(sugg.kind === "commitment" && sugg.proposal.timeAmbiguous).toBe(true);
  });

  it("🚨 D3 (sert itirazcı 10-17 gece-4): sözün günü mesajdan okunamıyor → kendiliğinden kaydedilmez; kart günü sorar, gün seçilmeden onay YOK", async () => {
    pinIstanbulNoonToday();
    const s = await setup();
    // "Havlu getireceğim" kendi gün sözcüğü taşımıyor; mesajda "yarın" başka söze ait → gün tahmin edilmez (eskiden bugüne açılıyordu).
    await hostSays(s.conversationId, "Teknisyen yarın 10'da gelecek. Havlu getireceğim.", new Date(Date.now() - 5 * 60_000));
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 1, rescheduled: 0, skipped: 1 });
    expect(await prisma.guestCommitment.findMany({ select: { kind: true } })).toEqual([{ kind: "maintenance" }]);
    const towels = (await getConversationSuggestions(s.orgId, s.conversationId)).find((x) => x.kind === "commitment" && x.proposal.commitmentKind === "towels");
    expect(towels?.kind === "commitment" && towels.proposal.dayUnclear).toBe(true);
    expect(towels?.detail).toBe("Mesajınızda sözün günü belli değil — günü seçin");
    expect(towels?.title).toBe("Söz kaydet: Havlu / çarşaf — gün ve saat belirtilmedi");
    // Gün seçilmeden onay reddedilir (varsayılan "bugün" yok); seçilen günle açılır.
    const noDay = await decide({ key: towels!.key, decision: "approve" });
    expect(noDay.status).toBe(400);
    expect(await noDay.json()).toMatchObject({ fields: { day: "Sözün gününü seçin." } });
    expect(await prisma.guestCommitment.count()).toBe(1);
    expect((await decide({ key: towels!.key, decision: "approve", day: "tomorrow" })).status).toBe(200);
    const t = await prisma.guestCommitment.findFirstOrThrow({ where: { kind: "towels" } });
    expect(dateKeyInTimeZone(t.dueAt, TZ)).toBe(tomorrowKeyOf(new Date()));
  });

  it("🚨 R1: yeni pencere kayıtlı sözü KAPSIYORSA tekrardır — 'Evet, klima için teknisyen yarın gelecek' kayıtlı yarın 15:00'ı silmez, öneri yok", async () => {
    pinIstanbulNoonToday();
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen yarın 15:00'te gelecek.", new Date(Date.now() - 10 * 60_000));
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
    const c1 = await prisma.guestCommitment.findFirstOrThrow();
    await hostSays(s.conversationId, "Evet, klima için teknisyen yarın gelecek.", new Date(Date.now() - 5 * 60_000));
    expect((await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment")).toEqual([]);
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 0, rescheduled: 0, skipped: 0 });
    const after = await prisma.guestCommitment.findUniqueOrThrow({ where: { id: c1.id } });
    expect([after.dueAt.toISOString(), after.duePrecision]).toEqual([c1.dueAt.toISOString(), "time"]);
  });

  it("🚨 R1: kesinliği düşüren kesin taşıma (bugün 15:00 → bugün akşam) kendiliğinden uygulanmaz; kart kalır, onayla taşınır", async () => {
    pinIstanbulNoonToday();
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen bugün 15:00'te gelecek.", new Date(Date.now() - 10 * 60_000));
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
    const c1 = await prisma.guestCommitment.findFirstOrThrow();
    await hostSays(s.conversationId, "Klima için teknisyen bugün akşam gelecek.", new Date(Date.now() - 5 * 60_000));
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 0, rescheduled: 0, skipped: 1 });
    expect((await prisma.guestCommitment.findUniqueOrThrow({ where: { id: c1.id } })).duePrecision).toBe("time");
    const [card] = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    expect(card.kind === "commitment" && [card.proposal.reschedule?.commitmentId, card.proposal.lowersPrecision]).toEqual([c1.id, true]);
    expect((await decide({ key: card.key, decision: "approve" })).status).toBe(200);
    expect(await prisma.guestCommitment.findUniqueOrThrow({ where: { id: c1.id } })).toMatchObject({ duePrecision: "part", dayPart: "evening" });
  });

  it("🚨 F11: gün sözcüğü olmayan yeni saat yarınki sözü YARIN'a taşır (bugüne değil); seçenek etiketi sonucu yazar, gün seçimi kullanılmaz", async () => {
    pinIstanbulNoonToday();
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.", new Date(Date.now() - 10 * 60_000));
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
    const c1 = await prisma.guestCommitment.findFirstOrThrow();
    await hostSays(s.conversationId, "Klima için teknisyen 15:00'te gelecek.", new Date(Date.now() - 5 * 60_000));
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 0, rescheduled: 0, skipped: 1 });
    const [card] = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    const option = card.kind === "commitment" ? card.proposal.moveOptions?.[0] : undefined;
    expect(option?.label).toMatch(/— yarın 10:00 → yarın 15:00$/u);
    // Gün seçimi "bugün" gönderilse de taşıma seçeneğin kendi anına (yarın 15:00) gider.
    expect((await decide({ key: card.key, decision: "approve", attach: `move:${c1.id}`, day: "today" })).status).toBe(200);
    const moved = await prisma.guestCommitment.findUniqueOrThrow({ where: { id: c1.id } });
    expect(moved.dueAt.toISOString()).toBe(commitmentDueAt({ day: "tomorrow", time: "15:00" }, TZ, new Date())!.toISOString());
  });

  it("🚨 Opus gece-4 F9 (sunucu): taşımada önerinin KENDİ saati gönderilse de seçeneğin saati yazılır (eski panel / çift dokunma)", async () => {
    pinIstanbulNoonToday();
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.", new Date(Date.now() - 10 * 60_000));
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
    const c1 = await prisma.guestCommitment.findFirstOrThrow();
    // Öğlen yazıldı: "8'de" kendi okuması bugün 20:00; yarınki söze taşıma seçeneği yarın 08:00.
    await hostSays(s.conversationId, "Klima için teknisyen 8'de gelecek.", new Date(Date.now() - 5 * 60_000));
    await applyHostCommitmentsAuto(s.orgId, s.conversationId);
    const [card] = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    const ownTime = card.kind === "commitment" ? card.proposal.time : "";
    const option = card.kind === "commitment" ? card.proposal.moveOptions?.find((o) => o.commitmentId === c1.id) : undefined;
    expect(option?.time).toBe("08:00");
    expect(ownTime).not.toBe(option?.time);
    expect((await decide({ key: card.key, decision: "approve", attach: `move:${c1.id}`, time: ownTime })).status).toBe(200);
    const moved = await prisma.guestCommitment.findUniqueOrThrow({ where: { id: c1.id } });
    expect(moved.dueAt.toISOString()).toBe(commitmentDueAt({ day: "tomorrow", time: "08:00" }, TZ, new Date())!.toISOString());
  });

  it("🚨 Haiku gece-4: bağlanacak söz yokken 'Teknisyen 11'e kaydı.' → hangi günün saati? kendiliğinden açılmaz, kart günü sorar", async () => {
    pinIstanbulNoonToday();
    const s = await setup();
    await hostSays(s.conversationId, "Teknisyen 11'e kaydı.", new Date(Date.now() - 5 * 60_000));
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 0, rescheduled: 0, skipped: 1 });
    const [card] = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    expect(card.kind === "commitment" && card.proposal.dayUnclear).toBe(true);
    expect(await prisma.guestCommitment.count()).toBe(0);
  });

  it("🚨 Opus gece-4 F7: taşıma seçeneğinin hedef gündeki anı geçmişse seçenek DÜŞMEZ (sözün kendi anına taşır) — belirsiz durum otomatik İKİNCİ söz açmaz", async () => {
    // 20:00 İstanbul: açık klima sözü bugün 21:00; ev sahibi "Klima için teknisyen 10'da gelecek." yazıyor (bugün 10:00 geçti → kendi okuması yarın).
    const evening = new Date(`${dateKeyInTimeZone(new Date(), TZ)}T17:00:00.000Z`);
    vi.useFakeTimers({ toFake: ["Date"], now: evening });
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen bugün 21:00'de gelecek.", new Date(Date.now() - 30 * 60_000));
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
    const c1 = await prisma.guestCommitment.findFirstOrThrow();
    await hostSays(s.conversationId, "Klima için teknisyen 10'da gelecek.", new Date(Date.now() - 5 * 60_000));
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 0, rescheduled: 0, skipped: 1 });
    expect(await prisma.guestCommitment.count()).toBe(1);
    const [card] = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    expect(card.kind === "commitment" && card.proposal.moveOptions?.map((o) => [o.commitmentId, o.day, o.time])).toEqual([[c1.id, "tomorrow", "10:00"]]);
  });

  it("🚨 Opus gece-4 F8: 'birazdan' sözünün taşıma seçeneği hedef sözün gününe kaymaz (bugün, kısa süre içinde)", async () => {
    pinIstanbulNoonToday();
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.", new Date(Date.now() - 10 * 60_000));
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
    await hostSays(s.conversationId, "Klima için teknisyen birazdan gelecek.", new Date(Date.now() - 5 * 60_000));
    const [card] = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    const option = card.kind === "commitment" ? card.proposal.moveOptions?.[0] : undefined;
    expect([option?.day, option?.precision, option?.dayPart]).toEqual(["today", "part", "soon"]);
  });

  it("🚨 Opus gece-4 F10: gün belirsiz kart, tahmini 'bugün' saati geçince KAYBOLMAZ (yarın okuması hâlâ ileride)", async () => {
    const morning = new Date(`${dateKeyInTimeZone(new Date(), TZ)}T06:00:00.000Z`); // 09:00 İstanbul
    vi.useFakeTimers({ toFake: ["Date"], now: morning });
    const s = await setup();
    await hostSays(s.conversationId, "Teknisyen yarın 10'da gelecek. Havluları 11'de getireceğim.", new Date(morning.getTime() - 60_000));
    const later = new Date(morning.getTime() + 2 * 3_600_000 + 6 * 60_000); // 11:06
    const cards = (await getConversationSuggestions(s.orgId, s.conversationId, later)).filter((x) => x.kind === "commitment");
    const towels = cards.find((x) => x.kind === "commitment" && x.proposal.commitmentKind === "towels");
    expect(towels?.kind === "commitment" && [towels.proposal.dayUnclear, towels.proposal.day]).toEqual([true, "tomorrow"]);
  });

  it("KONTROL D3: kendi günü olan ya da şimdiye bağlı söz kendiliğinden açılır ('Teknisyen bugün 15'te gelecek. Havlu getireceğim.' · 'hemen')", async () => {
    pinIstanbulNoonToday();
    const s = await setup();
    await hostSays(s.conversationId, "Teknisyen bugün 15'te gelecek. Havlu getireceğim.", new Date(Date.now() - 5 * 60_000));
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 2, rescheduled: 0, skipped: 0 });
    const s2 = await setup();
    await hostSays(s2.conversationId, "Teknisyen yarın 10'da gelecek. Havluları hemen getireceğim.", new Date(Date.now() - 5 * 60_000));
    expect(await applyHostCommitmentsAuto(s2.orgId, s2.conversationId)).toEqual({ created: 2, rescheduled: 0, skipped: 0 });
  });

  it("🚨 BELİRSİZ (konusuz, sözcüksüz yeni saat + açık söz) → KENDİLİĞİNDEN hiçbir şey değişmez; kart seçim ister; seçimle taşınır", async () => {
    const s = await setup();
    const c1 = await createGuestCommitment({
      organizationId: s.orgId,
      conversationId: s.conversationId,
      propertyId: s.propertyId,
      reservationId: null,
      kind: "maintenance",
      dueAt: commitmentDueAt({ day: "tomorrow", time: "09:00" }, TZ, new Date())!,
      actorUserId: null,
      source: "manual",
    });
    // Mesaj sözden SONRA (bağlam: önce açılmış söz) — gerçek saat.
    await hostSays(s.conversationId, "Teknisyen yarın 15:00'te gelecek.", new Date());
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 0, rescheduled: 0, skipped: 1 });
    expect(await prisma.guestCommitment.count()).toBe(1);
    const [sugg] = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    // Seçenek etiketi taşımanın SONUCUNU da yazar (F11, gece-4).
    expect(sugg.kind === "commitment" && sugg.proposal.moveOptions).toEqual([
      expect.objectContaining({ commitmentId: c1.id, label: expect.stringMatching(/^Arıza \/ bakım — yarın 09:00 → yarın 15:00$/u) }),
    ]);
    // Seçimsiz onay reddedilir; seçimle o söz taşınır.
    expect((await decide({ key: sugg.key, decision: "approve" })).status).toBe(400);
    expect((await decide({ key: sugg.key, decision: "approve", attach: `move:${c1.id}` })).status).toBe(200);
    const moved = await prisma.guestCommitment.findUniqueOrThrow({ where: { id: c1.id } });
    expect(moved.previousDueAt).not.toBeNull();
    expect(moved.dueAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: TZ })).toBe("15:00");
    expect(await prisma.task.count()).toBe(1);
  });

  it("BELİRSİZ + 'Ayrı söz olarak kaydet' → mevcut söz DEĞİŞMEZ, yeni söz + görev", async () => {
    const s = await setup();
    const c1 = await createGuestCommitment({
      organizationId: s.orgId,
      conversationId: s.conversationId,
      propertyId: s.propertyId,
      reservationId: null,
      kind: "maintenance",
      dueAt: commitmentDueAt({ day: "tomorrow", time: "09:00" }, TZ, new Date())!,
      actorUserId: null,
      source: "manual",
    });
    await hostSays(s.conversationId, "Teknisyen yarın 15:00'te gelecek.", new Date());
    const [sugg] = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    expect((await decide({ key: sugg.key, decision: "approve", attach: "new" })).status).toBe(200);
    const before = await prisma.guestCommitment.findUniqueOrThrow({ where: { id: c1.id } });
    expect(before.previousDueAt).toBeNull();
    expect(await prisma.guestCommitment.count()).toBe(2);
    expect(await prisma.task.count()).toBe(2);
  });
});

describe("teslim edilmemiş mesaj", () => {
  it("🚨 kalıcı kuyrukta TESLİM EDİLMEMİŞ ev sahibi mesajından söz açılmaz; teslim edilince açılır", async () => {
    const s = await setup();
    const msg = await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.");
    const ob = await prisma.messageOutbox.create({
      data: { organizationId: s.orgId, conversationId: s.conversationId, messageId: msg.id, channel: "airbnb", body: msg.body, idempotencyKey: "k-1", status: "pending" },
    });
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 0, rescheduled: 0, skipped: 1 });
    await prisma.messageOutbox.update({ where: { id: ob.id }, data: { status: "failed" } });
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(0);
    await prisma.messageOutbox.update({ where: { id: ob.id }, data: { status: "sent" } });
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
  });
});

describe("konaklama bitince (kurucu: havlu / temizlik / eksik eşya kapansın, arıza kalsın)", () => {
  // Sabit an (İstanbul 12:00) — gece yarısını aşan koşuda gün kaymasın.
  const NOW = new Date("2026-11-20T09:00:00Z");
  const todayKey = () => dateKeyInTimeZone(NOW, TZ);
  const yesterdayKey = () => dateKeyInTimeZone(addZonedDays(NOW, -1, TZ), TZ);

  async function seed(departureKey: string) {
    const s = await setup({ reservationDepartureKey: departureKey });
    const base = {
      organizationId: s.orgId,
      conversationId: s.conversationId,
      propertyId: s.propertyId,
      reservationId: s.reservationId,
      dueAt: new Date(NOW.getTime() - 3_600_000),
      actorUserId: null,
      source: "auto" as const,
    };
    const towels = await createGuestCommitment({ ...base, kind: "towels" });
    const cleaning = await createGuestCommitment({ ...base, kind: "cleaning" });
    const maintenance = await createGuestCommitment({ ...base, kind: "maintenance" });
    return { s, towels, cleaning, maintenance };
  }

  it("🚨 çıkış günü geçti → havlu / temizlik kapanır (iz: stay_ended), dokunulmamış görev silinir; ARIZA açık kalır; üzerinde çalışılan söz AÇIK (O14)", async () => {
    const { towels, cleaning, maintenance } = await seed(yesterdayKey());
    // Temizlik görevi üzerinde çalışılıyor → söz kapanmaz (görev bitince zaten kapanır), görev kalır (Opus O14).
    await prisma.task.update({ where: { id: cleaning.taskId }, data: { status: "in_progress" } });
    expect(await closeStayEndedCommitments(NOW)).toEqual({ closed: 1 });
    const rows = await prisma.guestCommitment.findMany({ orderBy: { kind: "asc" } });
    expect(rows.map((r) => [r.kind, r.status, r.closedReason])).toEqual([
      ["cleaning", "open", null],
      ["maintenance", "open", null],
      ["towels", "cancelled", "stay_ended"],
    ]);
    expect(await prisma.task.findUnique({ where: { id: towels.taskId } })).toBeNull();
    expect(await prisma.task.findUnique({ where: { id: cleaning.taskId } })).not.toBeNull();
    expect(await prisma.task.findUnique({ where: { id: maintenance.taskId } })).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "commitment.stay_ended" } })).toBe(1);
    // Tekrar koşu: kapanmış söze dokunmaz.
    expect(await closeStayEndedCommitments(NOW)).toEqual({ closed: 0 });
  });

  it("KONTROL: çıkış günü BUGÜN → hiçbiri kapanmaz (çıkış günü boyunca söz açık); başlığı ev sahibince değiştirilmiş görev silinmez", async () => {
    await seed(todayKey());
    expect(await closeStayEndedCommitments(NOW)).toEqual({ closed: 0 });
    expect(await prisma.guestCommitment.count({ where: { status: "open" } })).toBe(3);
  });

  it("başlığı ev sahibince değiştirilmiş / atanmış / notu ya da fotoğrafı olan (yapılacak) görev silinmez — söz yine kapanır (Opus O2)", async () => {
    const { s, towels, cleaning } = await seed(yesterdayKey());
    await prisma.task.update({ where: { id: towels.taskId }, data: { title: "Havluları 3. kata götür" } });
    const staff = await prisma.user.create({ data: { organizationId: s.orgId, name: "T", email: `t-${s.orgId}@x.com`, passwordHash: "x", role: "staff" } });
    await prisma.task.update({ where: { id: cleaning.taskId }, data: { assignedToId: staff.id } });
    expect(await closeStayEndedCommitments(NOW)).toEqual({ closed: 2 });
    expect(await prisma.task.findUnique({ where: { id: towels.taskId } })).not.toBeNull();
    expect(await prisma.task.findUnique({ where: { id: cleaning.taskId } })).not.toBeNull();
  });

  it("notu / fotoğrafı olan görev silinmez (depoda yetim dosya kalmasın — O2); işletme ayarı kapalıysa / demo hesabında kapatma yok (O14 / O17)", async () => {
    const { s, towels } = await seed(yesterdayKey());
    await prisma.taskUpdate.create({ data: { taskId: towels.taskId, note: "Kapıya bırakıldı", photoUrl: "uploads/x.jpg" } });
    await prisma.organization.update({ where: { id: s.orgId }, data: { autoCommitmentsEnabled: false } });
    expect(await closeStayEndedCommitments(NOW)).toEqual({ closed: 0 });
    await prisma.organization.update({ where: { id: s.orgId }, data: { autoCommitmentsEnabled: true } });
    expect(await closeStayEndedCommitments(NOW)).toEqual({ closed: 2 });
    expect(await prisma.task.findUnique({ where: { id: towels.taskId } })).not.toBeNull();
  });
});

describe("gece-4 S1-17: kilit sırası görev → söz + satır başına hata", () => {
  const NOW = new Date("2026-11-20T09:00:00Z");
  const yesterdayKey = () => dateKeyInTimeZone(addZonedDays(NOW, -1, TZ), TZ);

  async function seedTowels() {
    const s = await setup({ reservationDepartureKey: yesterdayKey() });
    const base = { organizationId: s.orgId, conversationId: s.conversationId, propertyId: s.propertyId, reservationId: s.reservationId, actorUserId: null };
    const towels = await createGuestCommitment({ ...base, dueAt: new Date(NOW.getTime() - 3_600_000), source: "auto" as const, kind: "towels" });
    const cleaning = await createGuestCommitment({ ...base, dueAt: new Date(NOW.getTime() - 3_000_000), source: "auto" as const, kind: "cleaning" });
    return { s, towels, cleaning };
  }

  /** Görev düzenlemesinin kilit sırası (`api/tasks/[id]`): önce görev satırı, kapı açılınca bağlı söz güncellenir. */
  function taskEditHoldingLock(taskId: string) {
    let release!: () => void;
    let markLocked!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const locked = new Promise<void>((r) => (markLocked = r));
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id" = ${taskId} FOR UPDATE`;
        markLocked();
        await gate;
        await tx.guestCommitment.updateMany({ where: { taskId }, data: { closedAt: null } });
      },
      { timeout: 20_000 },
    );
    return { locked, release, done };
  }

  it("🚨 konaklama kapatması eşzamanlı görev düzenlemesiyle kilitlenmez (deadlock yok); ikisi de tamamlanır", async () => {
    const { towels } = await seedTowels();
    const edit = taskEditHoldingLock(towels.taskId!);
    await edit.locked;
    const closing = closeStayEndedCommitments(NOW);
    await new Promise((r) => setTimeout(r, 300)); // kapatma görev kilidini beklesin (eski sıra: sözü kilitleyip görevde beklerdi)
    edit.release();
    await expect(edit.done).resolves.toBeUndefined();
    expect(await closing).toEqual({ closed: 2 });
  });

  it("🚨 'Yanlış, kaldır' da aynı sırada — eşzamanlı görev düzenlemesiyle kilitlenmez", async () => {
    const { s, towels } = await seedTowels();
    const edit = taskEditHoldingLock(towels.taskId!);
    await edit.locked;
    const removing = patchCommitment(s.conversationId, towels.id, { status: "cancelled", reason: "wrong" });
    await new Promise((r) => setTimeout(r, 300));
    edit.release();
    await expect(edit.done).resolves.toBeUndefined();
    expect((await removing).status).toBe(200);
  });

  it("tek satırın hatası öteki sözlerin kapanmasını durdurmaz (satır sonraki saatte denenir)", async () => {
    const { towels } = await seedTowels();
    __stayEndHooks.beforeRow = (id) => {
      if (id === towels.id) throw new Error("satır hatası (test)");
    };
    try {
      expect(await closeStayEndedCommitments(NOW)).toEqual({ closed: 1 });
    } finally {
      __stayEndHooks.beforeRow = undefined;
    }
    expect((await prisma.guestCommitment.findUniqueOrThrow({ where: { id: towels.id } })).status).toBe("open");
    expect(await closeStayEndedCommitments(NOW)).toEqual({ closed: 1 });
  });
});

describe("'Yanlış, kaldır' (kendiliğinden kaydedilen söz)", () => {
  it("🚨 otomatik söz → kapanır (neden 'wrong'), sistemin açtığı görev silinir; aynı mesajdan söz YENİDEN açılmaz", async () => {
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.");
    await applyHostCommitmentsAuto(s.orgId, s.conversationId);
    const c = await prisma.guestCommitment.findFirstOrThrow();
    expect((await patchCommitment(s.conversationId, c.id, { status: "cancelled", reason: "wrong" })).status).toBe(200);
    expect(await prisma.guestCommitment.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "cancelled", closedReason: "wrong" });
    expect(await prisma.task.findUnique({ where: { id: c.taskId! } })).toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "commitment.removed_wrong" } });
    expect(JSON.parse(audit.metadataJson ?? "{}")).toEqual({ commitmentId: c.id, taskRemoved: true });
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(0);
    expect(await prisma.guestCommitment.count({ where: { status: "open" } })).toBe(0);
  });

  it("KONTROL: elle kaydedilmiş sözde 'wrong' 404 (söz açık kalır); geçersiz neden 400; nedensiz iptal görevi SİLMEZ (bugünkü)", async () => {
    const s = await setup();
    const manual = await createGuestCommitment({
      organizationId: s.orgId,
      conversationId: s.conversationId,
      propertyId: s.propertyId,
      reservationId: null,
      kind: "towels",
      dueAt: new Date(Date.now() + 3_600_000),
      actorUserId: null,
      source: "manual",
    });
    expect((await patchCommitment(s.conversationId, manual.id, { status: "cancelled", reason: "wrong" })).status).toBe(404);
    expect((await patchCommitment(s.conversationId, manual.id, { status: "cancelled", reason: "x" })).status).toBe(400);
    expect((await prisma.guestCommitment.findUniqueOrThrow({ where: { id: manual.id } })).status).toBe("open");
    expect((await patchCommitment(s.conversationId, manual.id, { status: "cancelled" })).status).toBe(200);
    expect(await prisma.task.findUnique({ where: { id: manual.taskId } })).not.toBeNull();
  });

  it("görev atanmışsa 'Yanlış, kaldır' sözü kapatır ama görevi BIRAKIR (O2)", async () => {
    const s = await setup();
    await hostSays(s.conversationId, "Havlu getireceğim.");
    await applyHostCommitmentsAuto(s.orgId, s.conversationId);
    const c = await prisma.guestCommitment.findFirstOrThrow();
    const staff = await prisma.user.create({ data: { organizationId: s.orgId, name: "T", email: `t2-${s.orgId}@x.com`, passwordHash: "x", role: "staff" } });
    await prisma.task.update({ where: { id: c.taskId! }, data: { assignedToId: staff.id } });
    expect((await patchCommitment(s.conversationId, c.id, { status: "cancelled", reason: "wrong" })).status).toBe(200);
    expect(await prisma.task.findUnique({ where: { id: c.taskId! } })).not.toBeNull();
  });

  it("görev üzerinde çalışılıyorsa 'Yanlış, kaldır' sözü kapatır ama görevi BIRAKIR", async () => {
    const s = await setup();
    await hostSays(s.conversationId, "Havlu getireceğim.");
    await applyHostCommitmentsAuto(s.orgId, s.conversationId);
    const c = await prisma.guestCommitment.findFirstOrThrow();
    await prisma.task.update({ where: { id: c.taskId! }, data: { status: "in_progress" } });
    expect((await patchCommitment(s.conversationId, c.id, { status: "cancelled", reason: "wrong" })).status).toBe(200);
    expect(await prisma.task.findUnique({ where: { id: c.taskId! } })).not.toBeNull();
  });
});

describe("öneri türü ve gün düzenlemesi (Opus O7 / O13)", () => {
  it("🚨 yalnız söz önerisi istenince görev önerisi ÜRETİLMEZ (görünmeyen görev önerileri 5 yerlik tavanı doldurmasın)", async () => {
    const s = await setup();
    await prisma.message.create({
      data: { conversationId: s.conversationId, direction: "inbound", authorType: "guest", senderName: "Misafir", body: "Klima çalışmıyor, çok sıcak.", createdAt: new Date(Date.now() - 60_000) },
    });
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.");
    const all = await getConversationSuggestions(s.orgId, s.conversationId);
    expect(all.map((x) => x.kind).sort()).toEqual(["commitment", "task"]);
    expect((await getConversationSuggestions(s.orgId, s.conversationId, new Date(), { only: "commitment" })).map((x) => x.kind)).toEqual(["commitment"]);
    expect((await getConversationSuggestions(s.orgId, s.conversationId, new Date(), { only: "task" })).map((x) => x.kind)).toEqual(["task"]);
  });

  it("gün sözünde ev sahibi günü değiştirirse görevin yalnız-tarih vadesi TAKVİMLE kayar (UTC+12…14'te de doğru gün — O13)", async () => {
    const s = await setup();
    const msg = await hostSays(s.conversationId, "Havlu getireceğim.");
    const [sugg] = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    expect(sugg.kind === "commitment" && sugg.proposal.day).toBe("today");
    expect((await decide({ key: sugg.key, decision: "approve", day: "tomorrow" })).status).toBe(200);
    const c = await prisma.guestCommitment.findFirstOrThrow();
    const tomorrowKey = tomorrowKeyOf(msg.createdAt);
    expect(dateKeyInTimeZone(c.dueAt, TZ)).toBe(tomorrowKey);
    // Gece-4 S1-03: pencere sonu (23:59) korunur — gece yarısına düşüp yarın bütün gün "gecikti" görünmez.
    expect(wallClock(c.dueAt)).toBe("23:59");
    expect((await prisma.task.findUniqueOrThrow({ where: { id: c.taskId! } })).dueAt?.toISOString()).toBe(`${tomorrowKey}T12:00:00.000Z`);
  });

  it("🚨 gece-4 S1-02: 00:00–04:59 arasında yazılan 'yarın' kendiliğinden kaydedilmez, kart günü sorar; sabah yazılan aynı söz kaydedilir", async () => {
    const lateNight = new Date(`${dateKeyInTimeZone(new Date(), TZ)}T21:40:00.000Z`); // ertesi gün 00:40 İstanbul
    vi.useFakeTimers({ toFake: ["Date"], now: lateNight });
    const s = await setup();
    await hostSays(s.conversationId, "Yarın sabah 9'da teknisyen gelecek.", new Date(lateNight.getTime() - 60_000));
    expect(await applyHostCommitmentsAuto(s.orgId, s.conversationId)).toEqual({ created: 0, rescheduled: 0, skipped: 1 });
    const [card] = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    expect(card.kind === "commitment" && card.proposal.dayUnclear).toBe(true);
    expect(await prisma.guestCommitment.count()).toBe(0);
    // KONTROL: sabah 08:00'de yazılan aynı söz yarına kendiliğinden kaydedilir.
    const morning = new Date(`${dateKeyInTimeZone(new Date(), TZ)}T05:00:00.000Z`);
    vi.setSystemTime(morning);
    const s2 = await setup();
    await hostSays(s2.conversationId, "Yarın sabah 9'da teknisyen gelecek.", new Date(morning.getTime() - 60_000));
    expect((await applyHostCommitmentsAuto(s2.orgId, s2.conversationId)).created).toBe(1);
  });

  it("🚨 gece-4 S1-12: tek turda iki mesaj ESKİDEN yeniye işlenir — 'Havlu bugün 6'ya kadar' + 'Çarşafları da getiririm' 18:00'ı kaybetmez", async () => {
    pinIstanbulNoonToday();
    const s = await setup();
    await hostSays(s.conversationId, "Havlu bugün 6'ya kadar getiririm.", new Date(Date.now() - 10 * 60_000));
    await hostSays(s.conversationId, "Çarşafları da getiririm.", new Date(Date.now() - 5 * 60_000));
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
    const [c] = await prisma.guestCommitment.findMany();
    expect([c.kind, c.duePrecision, wallClock(c.dueAt)]).toEqual(["towels", "time", "18:00"]);
  });

  it("🚨 gece-4 S1-03: 'yarın sabah' sözünü ev sahibi BUGÜNE çekerse 'Geçmiş bir saat' hatası yok — bugün sabah penceresinin sonu (12:00)", async () => {
    const morning = new Date(`${dateKeyInTimeZone(new Date(), TZ)}T06:00:00.000Z`); // 09:00 İstanbul
    vi.useFakeTimers({ toFake: ["Date"], now: morning });
    const s = await setup();
    await hostSays(s.conversationId, "Yarın sabah havlu getireceğim.", new Date(morning.getTime() - 60_000));
    const [sugg] = (await getConversationSuggestions(s.orgId, s.conversationId)).filter((x) => x.kind === "commitment");
    expect(sugg.kind === "commitment" && [sugg.proposal.day, sugg.proposal.precision]).toEqual(["tomorrow", "part"]);
    expect((await decide({ key: sugg.key, decision: "approve", day: "today" })).status).toBe(200);
    const c = await prisma.guestCommitment.findFirstOrThrow();
    expect([dateKeyInTimeZone(c.dueAt, TZ), wallClock(c.dueAt), c.duePrecision, c.dayPart]).toEqual([dateKeyInTimeZone(morning, TZ), "12:00", "part", "morning"]);
  });
});

describe("eşzamanlılık ve demo (Opus O15 / O17)", () => {
  it("🚨 aynı konuşma işlenirken (kanca + tur) ikinci işleme ATLANIR — iki söz açılmaz; kilit bırakılınca işlenir", async () => {
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.");
    const inner = await __autoCommitmentInternals.withConversationLock(s.conversationId, () => applyHostCommitmentsAuto(s.orgId, s.conversationId));
    expect(inner).toEqual({ created: 0, rescheduled: 0, skipped: 1 });
    expect(await prisma.guestCommitment.count()).toBe(0);
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
    expect(await prisma.systemLock.count({ where: { name: { startsWith: "commitment-auto:" } } })).toBe(0);
  });

  it("süresi dolmuş kilit devralınır (çöken süreç konuşmayı kilitli bırakmaz)", async () => {
    const s = await setup();
    await prisma.systemLock.create({ data: { name: `commitment-auto:${s.conversationId}`, holder: "dead", lockedUntil: new Date(Date.now() - 1_000) } });
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.");
    expect((await applyHostCommitmentsAuto(s.orgId, s.conversationId)).created).toBe(1);
  });

  it("demo hesabında (Airbnb inceleme) söz kendiliğinden açılmaz", async () => {
    await prisma.organization.create({ data: { id: DEMO_ORG_ID, name: "Demo" } });
    const property = await prisma.property.create({ data: { organizationId: DEMO_ORG_ID, name: "Lale" } });
    const conv = await prisma.conversation.create({ data: { propertyId: property.id, guestIdentifier: "M", channel: "airbnb", status: "new" } });
    await hostSays(conv.id, "Klima için teknisyen yarın 10:00'da gelecek.");
    expect(await applyHostCommitmentsAuto(DEMO_ORG_ID, conv.id)).toEqual({ created: 0, rescheduled: 0, skipped: 0 });
    expect(await sweepHostCommitmentsAuto(new Date(), SWEEP_CATCHUP_MINUTES)).toMatchObject({ conversations: 0 });
  });
});

describe("tarama ve gönderim kancası", () => {
  it("🚨 her turdaki kısa tarama yakın zamanda mesajı olan konuşmayı işler; eski etkinlik yalnız saatlik telafide", async () => {
    const s = await setup();
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.");
    await prisma.conversation.update({ where: { id: s.conversationId }, data: { lastMessageAt: new Date(Date.now() - 2 * 3_600_000) } });
    expect(await sweepHostCommitmentsAuto()).toMatchObject({ conversations: 0, created: 0 });
    expect(await sweepHostCommitmentsAuto(new Date(), SWEEP_CATCHUP_MINUTES)).toMatchObject({ conversations: 1, created: 1 });
    await prisma.conversation.update({ where: { id: s.conversationId }, data: { lastMessageAt: new Date() } });
    expect(await sweepHostCommitmentsAuto()).toMatchObject({ conversations: 1, created: 0 });
  });

  it("KONTROL: tarama ayarı kapalı işletmeyi ve ev sahibi mesajı olmayan konuşmayı almaz", async () => {
    const s = await setup();
    await prisma.organization.update({ where: { id: s.orgId }, data: { autoCommitmentsEnabled: false } });
    await hostSays(s.conversationId, "Klima için teknisyen yarın 10:00'da gelecek.");
    await prisma.conversation.update({ where: { id: s.conversationId }, data: { lastMessageAt: new Date() } });
    const t = await setup();
    await prisma.message.create({ data: { conversationId: t.conversationId, direction: "inbound", authorType: "guest", senderName: "M", body: "Merhaba" } });
    await prisma.conversation.update({ where: { id: t.conversationId }, data: { lastMessageAt: new Date() } });
    expect(await sweepHostCommitmentsAuto()).toMatchObject({ conversations: 0 });
  });

  it("🚨 uygulamadan gönderilen ev sahibi mesajı TESLİM edilince söz hemen açılır; teslim başarısızsa açılmaz", async () => {
    const s = await setup();
    const conv = await prisma.conversation.update({ where: { id: s.conversationId }, data: { externalReservationId: "res-1" } });
    const input = {
      organizationId: s.orgId,
      conversation: { id: conv.id, channel: conv.channel, guestIdentifier: conv.guestIdentifier, externalReservationId: "res-1" },
      body: "Klima için teknisyen yarın 10:00'da gelecek.",
      claimBody: "Klima için teknisyen yarın 10:00'da gelecek.",
      senderName: "Ev Sahibi",
      aiAssisted: false,
      idempotencyKey: "i-1",
      strictIdempotency: false,
    };
    mockSend.mockResolvedValueOnce({ ok: false, error: "HTTP 400" } as never);
    expect((await sendHostMessage(input)).status).toBe("failed_definitive");
    expect(await prisma.guestCommitment.count()).toBe(0);
    mockSend.mockResolvedValueOnce({ ok: true, providerMessageId: "pm-1" } as never);
    expect((await sendHostMessage({ ...input, idempotencyKey: "i-2" })).status).toBe("sent");
    expect(await prisma.guestCommitment.findFirstOrThrow()).toMatchObject({ source: "auto", topic: "ac" });
  });
});

describe("Dikkat Gerektirenler — kesinlik + gecikme payı + 1 gün hatırlatma", () => {
  const now = new Date("2026-10-10T12:00:00Z"); // İstanbul 15:00
  async function row(s: { orgId: string; conversationId: string }, dueAt: Date, extra: { duePrecision?: string; dayPart?: string } = {}) {
    return prisma.guestCommitment.create({ data: { organizationId: s.orgId, conversationId: s.conversationId, kind: "towels", dueAt, ...extra } });
  }
  const items = async (orgId: string) => (await findAttentionItems(orgId, { now })).filter((i) => i.kind === "commitment_due");

  it("🚨 açık saatte 30 dk pay: 10 dk geçti → 'zamanı geldi' (kalan 0, gecikti değil); 31 dk geçti → gecikti", async () => {
    const s = await setup();
    await row(s, new Date("2026-10-10T11:50:00Z"), { duePrecision: "time" });
    expect((await items(s.orgId)).map((r) => r.minutesLeft)).toEqual([0]);
    await prisma.guestCommitment.deleteMany();
    await row(s, new Date("2026-10-10T11:29:00Z"), { duePrecision: "time" });
    expect((await items(s.orgId)).map((r) => [r.minutesLeft, r.severity])).toEqual([[-31, 96]]);
  });

  it("🚨 saatsiz (gün) söz gün bitmeden satır OLMAZ ('hostu rahatsız etmesin'); gün geçince altta (önem 60) ve saat uydurmadan", async () => {
    const s = await setup();
    await row(s, new Date("2026-10-10T20:59:00Z"), { duePrecision: "day" }); // bugün 23:59 — henüz değil
    expect(await items(s.orgId)).toEqual([]);
    await row(s, new Date("2026-10-09T20:59:00Z"), { duePrecision: "day" }); // dün 23:59 — geçti
    const r = await items(s.orgId);
    expect(r.map((x) => [x.severity, x.commitmentTime])).toEqual([[60, "dün (saat belirtilmedi)"]]);
  });

  it("dilim sözü dilimle gösterilir ('bugün akşam'); 'gece' penceresi ertesi güne taşsa da gün doğru", async () => {
    const s = await setup();
    await row(s, new Date("2026-10-10T20:59:00Z"), { duePrecision: "part", dayPart: "evening" });
    await row(s, new Date("2026-10-11T03:00:00Z"), { duePrecision: "part", dayPart: "night" }); // bu gece (06:00'ya kadar)
    expect((await items(s.orgId)).map((x) => x.commitmentTime)).toEqual(["bugün akşam", "bugün gece"]);
  });

  it("gece-4 S1-15: aynı konuşma + aynı andaki iki söz satırı ayrı kararlı kimlik taşır (söz kimliği)", async () => {
    const s = await setup();
    const a = await row(s, new Date("2026-10-10T13:00:00Z"), { duePrecision: "time" });
    const b = await row(s, new Date("2026-10-10T13:00:00Z"), { duePrecision: "time" });
    expect((await items(s.orgId)).map((x) => x.rowKey).sort()).toEqual([a.id, b.id].sort());
  });

  it("🚨 dünden kalan saatsiz sözler (önem 60) bugün geciken saatli sözü (96) üç satırlık tavandan DÜŞÜRMEZ (Haiku 10-17 gece)", async () => {
    const s = await setup();
    for (const m of ["20:56", "20:57", "20:58"]) await row(s, new Date(`2026-10-09T${m}:00Z`), { duePrecision: "day" });
    await row(s, new Date("2026-10-10T11:00:00Z"), { duePrecision: "time" }); // bugün 14:00 — 1 sa gecikti
    const r = await items(s.orgId);
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.severity).sort()).toEqual([60, 60, 96]);
    expect(r.find((x) => x.severity === 96)?.commitmentTime).toBe("14:00");
  });

  it("1 günden uzun geciken söz satırda kalır + TEK hatırlatma işareti; kendiliğinden kapanmaz", async () => {
    const s = await setup();
    await row(s, new Date("2026-10-09T10:00:00Z"), { duePrecision: "time" }); // 26 sa önce
    const [r] = await items(s.orgId);
    expect(r.minutesLeft).toBe(-26 * 60);
    expect(r.commitmentReminder).toBe(true);
    expect((await prisma.guestCommitment.findFirstOrThrow()).status).toBe("open");
  });

  it("🚨 Opus O16: anahtar KAPALIYKEN bugünkü görünüm — pay yok ('gecikti' hemen), hatırlatma işareti yok", async () => {
    vi.stubEnv("HOST_COMMITMENT_AUTO_ENABLED", "");
    const s = await setup();
    await row(s, new Date("2026-10-10T11:50:00Z"), { duePrecision: "time" }); // 10 dk önce
    await row(s, new Date("2026-10-09T10:00:00Z"));
    const r = await items(s.orgId);
    expect(r.map((x) => x.minutesLeft)).toEqual([-26 * 60, -10]);
    expect(r.every((x) => !x.commitmentReminder)).toBe(true);
  });

  it("dilim / gün sözünde satır kesinliği taşır (panel kalan süreyi göstermez — O12)", async () => {
    const s = await setup();
    await row(s, new Date("2026-10-10T20:59:00Z"), { duePrecision: "part", dayPart: "evening" });
    await row(s, new Date("2026-10-10T13:00:00Z"), { duePrecision: "time" });
    expect((await items(s.orgId)).map((x) => [x.commitmentTime, x.commitmentPrecise])).toEqual([
      ["16:00", true],
      ["bugün akşam", false],
    ]);
  });
});

describe("görev başlığı tek kaynak", () => {
  it("konaklama kapatması ve 'Yanlış, kaldır' aynı başlık kuralıyla eşleşir (dilimli başlık dahil)", () => {
    expect(commitmentTaskTitle("towels", null, "evening")).toBe("Misafire söz: Havlu / çarşaf · akşam");
    expect(commitmentTaskTitle("towels", null, null)).toBe("Misafire söz: Havlu / çarşaf");
  });
});
