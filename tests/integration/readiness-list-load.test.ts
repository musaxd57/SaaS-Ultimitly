import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { loadArrivalReadiness } from "@/lib/readiness-list/load";
import { loadEarlyCheckinFacts } from "@/lib/early-checkin/load";
import { todayKey, addNights } from "@/modules/availability/core";

// ---------------------------------------------------------------------------
// Giriş hazırlığı listesi — yükleyici (gerçek PostgreSQL). Kurucu H1 (11-05): kayıtlardan türer; eksik veri asla hazır değil; atanmış
// olmak kanıt değil; temizlik hükmü misafire giden "Daireniz hazır" kararıyla AYNI yoldan (tek-konaklama yükleyicisi). Salt-okuma.
// ---------------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const NOW = new Date(); // gerçek "bugün" — tarihler aşağıda bugünün anahtarından kurulur (sabit tarih + Date.now penceresi = zaman bombası)
const TODAY = todayKey(NOW, TZ);
const dayDate = (key: string) => new Date(`${key}T12:00:00Z`); // iCal / CSV öğle çapası (`calendarDateOf` aynı güne okur)
/** Bugün, işletme saatiyle HH:MM anı (İstanbul UTC+3). */
const localToday = (hh: number, mm = 0) => new Date(`${TODAY}T${String(hh - 3).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);

let orgId: string;
let propertyId: string;
let staffId: string;

async function reservation(arrivalKey: string, departureKey: string, guestName: string, pid = propertyId) {
  return prisma.reservation.create({
    data: { propertyId: pid, guestName, arrivalDate: dayDate(arrivalKey), departureDate: dayDate(departureKey), status: "confirmed", channel: "airbnb" },
  });
}

/** Aynı gün devir: önceki misafir bugün çıkar, yeni misafir bugün girer. */
async function sameDayTurnover() {
  const prev = await reservation(addNights(TODAY, -3), TODAY, "Önceki Misafir");
  const next = await reservation(TODAY, addNights(TODAY, 2), "Yeni Misafir");
  return { prev, next };
}

async function cleaningTask(reservationId: string, over: Record<string, unknown> = {}) {
  return prisma.task.create({
    data: { propertyId, reservationId, type: "cleaning", title: "Çıkış temizliği", origin: "system", status: "todo", dueAt: dayDate(TODAY), ...over },
  });
}

beforeEach(async () => {
  await resetDb();
  const made = await makeOrgWithProperty({ checkInTime: "15:00", checkOutTime: "11:00" });
  orgId = made.orgId;
  propertyId = made.propertyId;
  staffId = (await prisma.user.create({ data: { organizationId: orgId, name: "Ayşe", email: "ayse@example.test", passwordHash: "x", role: "staff" } })).id;
});

const rowOf = async (now = localToday(14)) => (await loadArrivalReadiness(orgId, now)).rows;
const factor = (row: { readiness: { factors: { key: string; state: string; label: string }[] } }, key: string) => row.readiness.factors.find((f) => f.key === key);

describe("giriş hazırlığı listesi — yükleyici", () => {
  it("🚨 ATANMIŞ ama bitmemiş devir temizliği → HAZIR DEĞİL ('atanan: Ayşe · başlanmadı'), eksik şart çıkıştan sonra 'bitti'", async () => {
    const { prev, next } = await sameDayTurnover();
    await cleaningTask(prev.id, { assignedToId: staffId });
    const rows = await rowOf();
    expect(rows).toHaveLength(1);
    expect(rows[0].reservationId).toBe(next.id);
    expect(rows[0].readiness.overall).toBe("not_ready");
    const c = rows[0].readiness.factors.find((f) => f.key === "cleaning")!;
    expect(c.label).toBe("Temizlik açık · atanan: Ayşe · başlanmadı");
    expect(c.missing).toBe('çıkıştan (11:00) sonra "bitti" kaydı');
  });

  it("🚨 çıkıştan SONRA kimlikli 'bitti' (oturmuş) → TEMİZLİK HAZIR; kim, saat kaçta — genel durum yine 'HAZIR' değil", async () => {
    const { prev } = await sameDayTurnover();
    const t = await cleaningTask(prev.id, { assignedToId: staffId, status: "done" });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "in_progress", createdAt: localToday(11, 20) } });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "done", createdAt: localToday(12, 40) } });
    const rows = await rowOf(localToday(14));
    expect(rows[0].readiness.overall).toBe("cleaning_ready");
    expect(rows[0].readiness.factors.find((f) => f.key === "cleaning")).toMatchObject({
      state: "ok",
      label: "Temizlik bitti 12:40 · Ayşe · çıkıştan (11:00) sonra",
    });
  });

  it("KONTROL — kullanıcısız (sistem) 'bitti' kaydı kanıt değil: hazır SAYILMAZ (çekirdekle aynı kural)", async () => {
    const { prev } = await sameDayTurnover();
    const t = await cleaningTask(prev.id, { status: "done" });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: null, status: "done", createdAt: localToday(12, 40) } });
    const rows = await rowOf(localToday(14));
    expect(rows[0].readiness.overall).not.toBe("cleaning_ready");
    expect(rows[0].readiness.factors.find((f) => f.key === "cleaning")!.state).not.toBe("ok");
  });

  it("🚨 devir temizliği görevi YOK → BİLİNMİYOR (asla yeşil değil), eksik şart yazılı", async () => {
    await sameDayTurnover();
    const rows = await rowOf();
    expect(rows[0].readiness.overall).toBe("unknown");
    expect(rows[0].readiness.factors.find((f) => f.key === "cleaning")).toMatchObject({ state: "unknown", missing: "devir temizliği görevi" });
  });

  it("temizlik hazır olsa da varış günü vadeli açık SÖZ → HAZIR DEĞİL; açık ihtiyaç yalnız bilgi", async () => {
    const { prev, next } = await sameDayTurnover();
    const t = await cleaningTask(prev.id, { status: "done" });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "done", createdAt: localToday(12, 0) } });
    const conv = await prisma.conversation.create({ data: { propertyId, reservationId: next.id, guestIdentifier: "Yeni Misafir", channel: "airbnb" } });
    await prisma.guestCommitment.create({ data: { organizationId: orgId, conversationId: conv.id, kind: "supplies", dueAt: localToday(15) } });
    await prisma.conversationItem.create({
      data: { organizationId: orgId, conversationId: conv.id, messageId: "m-park", kind: "parking", sources: "understanding", status: "pending_host" },
    });
    const rows = await rowOf(localToday(14));
    expect(rows[0].readiness.overall).toBe("not_ready");
    expect(rows[0].readiness.factors.find((f) => f.key === "commitment")!.state).toBe("blocking");
    expect(rows[0].readiness.factors.find((f) => f.key === "need")).toMatchObject({ state: "info" });
    expect(rows[0].conversationId).toBe(conv.id);
  });

  it("söz yalnız varış gününün sonuna kadar vadeliyse ENGEL; sonraki günlere vadeli söz ve cevaplanmış ihtiyaç listeye girmez", async () => {
    const { prev, next } = await sameDayTurnover();
    const t = await cleaningTask(prev.id, { status: "done" });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "done", createdAt: localToday(12, 0) } });
    const conv = await prisma.conversation.create({ data: { propertyId, reservationId: next.id, guestIdentifier: "Yeni Misafir", channel: "airbnb" } });
    await prisma.guestCommitment.create({ data: { organizationId: orgId, conversationId: conv.id, kind: "towels", dueAt: dayDate(addNights(TODAY, 1)) } });
    await prisma.conversationItem.create({
      data: { organizationId: orgId, conversationId: conv.id, messageId: "m-wifi", kind: "wifi", sources: "understanding", status: "answered" },
    });
    const rows = await rowOf(localToday(14));
    expect(rows[0].readiness.overall).toBe("cleaning_ready");
    expect(factor(rows[0], "commitment")).toBeUndefined();
    expect(factor(rows[0], "need")).toBeUndefined();
  });

  it("🚨 hükmün okuduğu BAĞSIZ devir günü temizlik görevi de gösterilir (atanan doğru; Haiku 11-05)", async () => {
    await sameDayTurnover();
    await prisma.task.create({
      data: { propertyId, reservationId: null, type: "cleaning", title: "Temizlik", origin: "manual", status: "todo", dueAt: dayDate(TODAY), assignedToId: staffId },
    });
    const rows = await rowOf();
    expect(rows[0].readiness.overall).toBe("not_ready");
    expect(factor(rows[0], "cleaning")!.label).toBe("Temizlik açık · atanan: Ayşe · başlanmadı");
  });

  it("temizlikçinin bugün devir temizliğine yazdığı not BİLGİ olarak görünür (içerik okunmaz)", async () => {
    const { prev } = await sameDayTurnover();
    const t = await cleaningTask(prev.id, { assignedToId: staffId });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, note: "Klozet kapağı kırık", createdAt: localToday(11, 30) } });
    const rows = await rowOf(localToday(14));
    expect(factor(rows[0], "cleaning_note")).toMatchObject({ state: "info", label: "Temizlikçi bugün bu temizliğe not yazdı — görevde bakın" });
    expect(JSON.stringify(rows)).not.toContain("Klozet");
  });

  it("iki dairenin devri karışmaz: her satır KENDİ devir görevinin atananını gösterir", async () => {
    const { prev } = await sameDayTurnover();
    await cleaningTask(prev.id, { assignedToId: staffId });
    const p2 = (await prisma.property.create({ data: { organizationId: orgId, name: "Lale 7", checkInTime: "15:00", checkOutTime: "11:00" } })).id;
    const prev2 = await reservation(addNights(TODAY, -2), TODAY, "Önceki 2", p2);
    await reservation(TODAY, addNights(TODAY, 3), "Yeni 2", p2);
    await prisma.task.create({ data: { propertyId: p2, reservationId: prev2.id, type: "cleaning", title: "Çıkış temizliği", origin: "system", status: "todo", dueAt: dayDate(TODAY) } });
    const rows = await rowOf();
    const byGuest = new Map(rows.map((r) => [r.guestName, factor(r, "cleaning")!.label]));
    expect(byGuest.get("Yeni Misafir")).toBe("Temizlik açık · atanan: Ayşe · başlanmadı");
    expect(byGuest.get("Yeni 2")).toBe("Temizlik açık · kimseye atanmadı · başlanmadı");
  });

  it("onaylı erken giriş saati giriş saatinin yerine geçer (zaman satırı ve başlık)", async () => {
    const { next } = await sameDayTurnover();
    const conv = await prisma.conversation.create({ data: { propertyId, reservationId: next.id, guestIdentifier: "Yeni Misafir", channel: "airbnb" } });
    await prisma.decisionRequest.create({
      data: { organizationId: orgId, conversationId: conv.id, messageId: "m-early", reservationId: next.id, kind: "early_checkin", lang: "tr", status: "approved", decidedTime: "12:00" },
    });
    const rows = await rowOf();
    expect(rows[0].checkInTime).toBe("12:00");
    expect(factor(rows[0], "timing")!.label).toBe("Önceki çıkış 11:00 → giriş 12:00");
  });

  it("sığmayan giriş sayısı söylenir (sessiz kesme yok)", async () => {
    await reservation(TODAY, addNights(TODAY, 1), "Bir");
    await reservation(addNights(TODAY, 1), addNights(TODAY, 2), "İki");
    const list = await loadArrivalReadiness(orgId, localToday(14), { max: 1 });
    expect(list.rows.map((r) => r.guestName)).toEqual(["Bir"]);
    expect(list.truncated).toBe(1);
  });

  it("giriş talimatı kalemi varsa 'var · kontrol edilmedi' — değeri OKUNMAZ / gösterilmez", async () => {
    await sameDayTurnover();
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "checkin", title: "Giriş", content: "Kapı kodu 4512" } });
    const rows = await rowOf();
    const access = rows[0].readiness.factors.find((f) => f.key === "access")!;
    expect(access.label).toBe("Giriş talimatı bilgi tabanında var · kapıya / kutuya yerleştiği kontrol edilmedi");
    expect(JSON.stringify(rows)).not.toContain("4512");
  });

  it("KONTROL — yalnız ETKİN 'giriş talimatı' kalemi sayılır (Wi-Fi kalemi ya da pasif kalem 'var' saydırmaz)", async () => {
    await sameDayTurnover();
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ" } });
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "checkin", title: "Eski giriş", content: "eski", isActive: false } });
    const rows = await rowOf();
    expect(factor(rows[0], "access")!.label).toBe("Giriş talimatı bilgi tabanında yok · erişim kontrol edilmedi");
  });

  it("pencere: bugün + 2 gün; 3. gün ve geçmiş dışarıda; iptal edilen konaklama listede yok", async () => {
    await reservation(addNights(TODAY, 2), addNights(TODAY, 4), "Sınırda");
    await reservation(addNights(TODAY, 3), addNights(TODAY, 5), "Dışarıda");
    await reservation(addNights(TODAY, -1), addNights(TODAY, 1), "Geçmiş");
    await prisma.reservation.create({
      data: { propertyId, guestName: "İptal", arrivalDate: dayDate(TODAY), departureDate: dayDate(addNights(TODAY, 1)), status: "cancelled", channel: "airbnb" },
    });
    const rows = await rowOf();
    expect(rows.map((r) => r.guestName)).toEqual(["Sınırda"]);
  });

  it("🚨 kiracılar arası: başka işletmenin girişleri listelenmez", async () => {
    await sameDayTurnover();
    const other = await makeOrgWithProperty();
    await prisma.reservation.create({
      data: { propertyId: other.propertyId, guestName: "Başka İşletme", arrivalDate: dayDate(TODAY), departureDate: dayDate(addNights(TODAY, 1)), status: "confirmed", channel: "airbnb" },
    });
    const rows = await rowOf();
    expect(rows.map((r) => r.guestName)).toEqual(["Yeni Misafir"]);
    const otherRows = (await loadArrivalReadiness(other.orgId, localToday(14))).rows;
    expect(otherRows.map((r) => r.guestName)).toEqual(["Başka İşletme"]);
  });

  it("🚨 temizlik hükmü misafire giden kararla AYNI: liste satırı = tek-konaklama yükleyicisinin hükmü (dört kurulum)", async () => {
    const { prev, next } = await sameDayTurnover();
    const t = await cleaningTask(prev.id, { assignedToId: staffId });
    const expectSame = async (now: Date) => {
      const row = (await loadArrivalReadiness(orgId, now)).rows[0];
      const single = await loadEarlyCheckinFacts({
        organizationId: orgId,
        propertyId,
        reservationId: next.id,
        now,
        requested: { time: null, sources: 0, conflict: false },
        singleIntent: true,
      });
      const state = row.readiness.factors.find((f) => f.key === "cleaning")!.state;
      const expected = single!.facts.readiness === "ready" ? "ok" : single!.facts.readiness === "not_ready" ? "blocking" : "unknown";
      expect(state).toBe(expected);
    };
    await expectSame(localToday(14)); // açık
    await prisma.task.update({ where: { id: t.id }, data: { status: "done" } });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "done", createdAt: localToday(10, 30) } });
    await expectSame(localToday(14)); // çıkıştan önce bitti
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "done", createdAt: localToday(13, 58) } });
    await expectSame(localToday(14)); // taze (5 dk dolmadı)
    await expectSame(localToday(14, 10)); // oturdu → hazır
  });
});
