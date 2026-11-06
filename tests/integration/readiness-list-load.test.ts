import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { loadArrivalReadiness } from "@/lib/readiness-list/load";
import { loadEarlyCheckinFacts } from "@/lib/early-checkin/load";
import { todayKey, addNights } from "@/modules/availability/core";
import { encryptSecret } from "@/lib/crypto-core";
import { tombstoneKeyHash, currentKeyFingerprint } from "@/lib/erasure";

// ---------------------------------------------------------------------------
// Giriş hazırlığı listesi — yükleyici (gerçek PostgreSQL). Kurucu H1 (11-05): kayıtlardan türer; eksik veri asla hazır değil; atanmış
// olmak kanıt değil; temizlik hükmü misafire giden "erken giriş onayı" kararıyla AYNI yoldan (tek-konaklama yükleyicisi). Salt-okuma.
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

afterEach(() => vi.unstubAllEnvs());

/**
 * Otomatik giriş mesajının GERÇEKTEN gideceği kurulum (gönderici `sendDueCheckins`in şartları — Opus 11-06 N2): genel anahtar açık, işletmede
 * otomatik giriş açık + açılış anı, kanal bağlantısı (çözülebilir belirteç), daire açılıştan önce kurulmuş, rezervasyon kanaldan
 * mesajlaşabilir (kaynak kimliği dolu, takvimden değil).
 */
async function autoCheckinSendable(arrivalId: string) {
  vi.stubEnv("AUTO_REPLY_ENABLED", "1");
  const longAgo = new Date(Date.now() - 60 * 86_400_000);
  await prisma.property.update({ where: { id: propertyId }, data: { createdAt: longAgo } });
  await prisma.organization.update({
    where: { id: orgId },
    data: { autoCheckin: true, autoCheckinEnabledAt: new Date(Date.now() - 30 * 86_400_000), hospitableTokenEnc: encryptSecret("tok-readiness") },
  });
  await prisma.reservation.update({ where: { id: arrivalId }, data: { sourceReference: `ref-${arrivalId}` } });
}

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

  it("temizlikçinin bugün devir temizliğine yazdığı not BİLGİ olarak görünür: yazan + saat (içerik okunmaz; Opus F7 dayanak)", async () => {
    const { prev } = await sameDayTurnover();
    const t = await cleaningTask(prev.id, { assignedToId: staffId });
    const note = await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, note: "Klozet kapağı kırık", createdAt: localToday(11, 30) } });
    // Kimliksiz (sistem) not çekirdekte sayılmaz → dayanak da o olamaz (daha yeni olsa bile).
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: null, note: "sistem notu", createdAt: localToday(12, 0) } });
    const rows = await rowOf(localToday(14));
    expect(factor(rows[0], "cleaning_note")).toMatchObject({
      state: "info",
      label: "Temizlik görevine not yazıldı · Ayşe · 11:30 — görevde okuyun",
      basis: [{ kind: "task_update", id: note.id, at: localToday(11, 30) }],
    });
    expect(JSON.stringify(rows)).not.toContain("Klozet");
    expect(JSON.stringify(rows)).not.toContain("sistem notu");
  });

  // ---- Codex 11-05 teknik doğrulama: eski kanıt kendiliğinden geçerli kalmaz (misafire giden "erken giriş onayı"yla AYNI çekirdek) ----

  it("🚨 Codex (kurucu örneği): 'bitti' 12:40'ta atıldı, SONRA geç çıkış 14:00'e onaylandı → eski 'bitti' kanıt DEĞİL (çıkıştan önce)", async () => {
    const { prev, next } = await sameDayTurnover();
    const t = await cleaningTask(prev.id, { assignedToId: staffId, status: "done" });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "done", createdAt: localToday(12, 40) } });
    expect((await rowOf(localToday(15)))[0].readiness.overall).toBe("cleaning_ready"); // onaydan önce: 11:00 çıkışından sonra bitti
    const conv = await prisma.conversation.create({ data: { propertyId, reservationId: prev.id, guestIdentifier: "Önceki Misafir", channel: "airbnb" } });
    await prisma.decisionRequest.create({
      data: { organizationId: orgId, conversationId: conv.id, messageId: "m-late", reservationId: prev.id, kind: "late_checkout", lang: "tr", status: "approved", decidedTime: "14:00" },
    });
    const rows = await rowOf(localToday(15));
    expect(rows[0].readiness.overall).toBe("not_ready");
    expect(factor(rows[0], "cleaning")).toMatchObject({ state: "blocking", label: '"Bitti" işareti çıkıştan önce (12:40)' });
    expect(factor(rows[0], "timing")!.label).toBe("Önceki çıkış 14:00 → giriş 15:00");
    // Misafire giden karar da aynı kanıtı okur.
    const single = await loadEarlyCheckinFacts({ organizationId: orgId, propertyId, reservationId: next.id, now: localToday(15), requested: { time: null, sources: 0, conflict: false }, singleIntent: true });
    expect(single!.facts.readiness).toBe("not_ready");
  });

  it("🚨 Codex: araya YENİ bir konaklama girerse eski devrin 'bitti'si bu varış için geçmez (devir değişti)", async () => {
    const a = await reservation(addNights(TODAY, -6), addNights(TODAY, -3), "A");
    await reservation(TODAY, addNights(TODAY, 2), "Yeni Misafir");
    const t = await prisma.task.create({
      data: { propertyId, reservationId: a.id, type: "cleaning", title: "Çıkış temizliği", origin: "system", status: "done", dueAt: dayDate(addNights(TODAY, -3)) },
    });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "done", createdAt: new Date(`${addNights(TODAY, -3)}T10:00:00Z`) } });
    expect((await rowOf(localToday(14)))[0].readiness.overall).toBe("cleaning_ready");
    await reservation(addNights(TODAY, -2), addNights(TODAY, -1), "Araya giren"); // A'dan sonra, varıştan önce
    const rows = await rowOf(localToday(14));
    expect(rows.find((r) => r.guestName === "Yeni Misafir")!.readiness.overall).not.toBe("cleaning_ready");
    expect(factor(rows.find((r) => r.guestName === "Yeni Misafir")!, "cleaning")).toMatchObject({ state: "unknown", label: "Devir temizliği görevi yok" });
  });

  it("🚨 Codex: aynı gün tarihli ama BAŞKA bir konaklamaya bağlı temizlik 'bitti'si bu devrin kanıtı DEĞİL", async () => {
    await sameDayTurnover();
    const other = await reservation(addNights(TODAY, -20), addNights(TODAY, -17), "Başka konaklama");
    const t = await prisma.task.create({
      data: { propertyId, reservationId: other.id, type: "cleaning", title: "Temizlik", origin: "manual", status: "done", dueAt: dayDate(TODAY) },
    });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "done", createdAt: localToday(12, 0) } });
    const rows = await rowOf(localToday(14));
    expect(rows[0].readiness.overall).not.toBe("cleaning_ready");
    expect(factor(rows[0], "cleaning")!.state).not.toBe("ok");
  });

  it("🚨 Codex: 'bitti'den SONRA görev yeniden açıldıysa (en son kayıt 'yapılacak') hazır SAYILMAZ", async () => {
    const { prev } = await sameDayTurnover();
    const t = await cleaningTask(prev.id, { assignedToId: staffId, status: "todo" });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "done", createdAt: localToday(12, 0) } });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "todo", createdAt: localToday(12, 30) } });
    const rows = await rowOf(localToday(14));
    expect(rows[0].readiness.overall).toBe("not_ready");
    expect(factor(rows[0], "cleaning")!.label).toBe("Temizlik açık · atanan: Ayşe · başlanmadı");
  });

  it("🚨 N6: önceki çıkış BAŞKA gündeyse (araya boş gün) zaman satırı ve 'bitti' kaydı GÜNÜYLE yazılır", async () => {
    const day = addNights(TODAY, -2);
    const prev = await reservation(addNights(TODAY, -5), day, "Eski Çıkan");
    await reservation(TODAY, addNights(TODAY, 2), "Yeni Misafir");
    const t = await prisma.task.create({
      data: { propertyId, reservationId: prev.id, type: "cleaning", title: "Çıkış temizliği", origin: "system", status: "done", dueAt: dayDate(day) },
    });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "done", createdAt: new Date(`${day}T10:10:00Z`) } }); // 13:10 İstanbul
    const rows = await rowOf(localToday(14));
    const d = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
    expect(rows[0].readiness.overall).toBe("cleaning_ready");
    expect(factor(rows[0], "cleaning")!.label).toBe(`Temizlik bitti ${d} 13:10 · Ayşe · çıkıştan (${d} 11:00) sonra`);
    expect(factor(rows[0], "timing")!.label).toBe(`Önceki çıkış ${d} 11:00 → giriş 15:00`); // eskiden "Önceki çıkış bilinmiyor"
  });

  it("🚨 N2: sözden doğan bakım görevi 'Söz açık' satırında yazılır, sorun satırı olarak İKİNCİ kez (çelişen vadeyle) yazılmaz", async () => {
    const { next } = await sameDayTurnover();
    const promised = await prisma.task.create({
      data: { propertyId, reservationId: next.id, type: "maintenance", title: "Misafire söz: klima", origin: "ai", status: "todo", dueAt: dayDate(TODAY) },
    });
    const conv = await prisma.conversation.create({ data: { propertyId, reservationId: next.id, guestIdentifier: "Yeni Misafir", channel: "airbnb" } });
    await prisma.guestCommitment.create({ data: { organizationId: orgId, conversationId: conv.id, kind: "maintenance", topic: "ac", dueAt: localToday(18), taskId: promised.id } });
    const rows = await rowOf();
    expect(rows[0].readiness.factors.filter((f) => f.key === "issue")).toHaveLength(0);
    expect(rows[0].readiness.factors.filter((f) => f.key === "commitment")).toHaveLength(1);
    expect(rows[0].readiness.overall).toBe("not_ready");
  });

  it("iki dairede ayrı not: her satır KENDİ devrinin notunu (yazan + saat) gösterir", async () => {
    const { prev } = await sameDayTurnover();
    const t1 = await cleaningTask(prev.id);
    await prisma.taskUpdate.create({ data: { taskId: t1.id, userId: staffId, note: "a", createdAt: localToday(11, 30) } });
    const p2 = (await prisma.property.create({ data: { organizationId: orgId, name: "Lale 7", checkInTime: "15:00", checkOutTime: "11:00" } })).id;
    const prev2 = await reservation(addNights(TODAY, -2), TODAY, "Önceki 2", p2);
    await reservation(TODAY, addNights(TODAY, 3), "Yeni 2", p2);
    const mehmet = await prisma.user.create({ data: { organizationId: orgId, name: "Mehmet", email: "mehmet2@example.test", passwordHash: "x", role: "staff" } });
    const t2 = await prisma.task.create({ data: { propertyId: p2, reservationId: prev2.id, type: "cleaning", title: "Çıkış temizliği", origin: "system", status: "todo", dueAt: dayDate(TODAY) } });
    await prisma.taskUpdate.create({ data: { taskId: t2.id, userId: mehmet.id, note: "b", createdAt: localToday(11, 45) } });
    const rows = await rowOf(localToday(14));
    const noteOf = new Map(rows.map((r) => [r.guestName, factor(r, "cleaning_note")!.label]));
    expect(noteOf.get("Yeni Misafir")).toBe("Temizlik görevine not yazıldı · Ayşe · 11:30 — görevde okuyun");
    expect(noteOf.get("Yeni 2")).toBe("Temizlik görevine not yazıldı · Mehmet · 11:45 — görevde okuyun");
  });

  it("🚨 kurucu / Codex 11-05 gece: ESKİ bir konaklamadan kalan açık bakım satırı KIRMIZI yapmaz — gri, adıyla + 'bu girişi etkiliyor mu?'", async () => {
    const { prev } = await sameDayTurnover();
    const t = await cleaningTask(prev.id, { status: "done" });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "done", createdAt: localToday(12, 0) } });
    const old = await reservation(addNights(TODAY, -30), addNights(TODAY, -27), "Eski Misafir");
    const mehmet = await prisma.user.create({ data: { organizationId: orgId, name: "Mehmet", email: "mehmet@example.test", passwordHash: "x", role: "staff" } });
    const m = await prisma.task.create({
      data: { propertyId, reservationId: old.id, type: "maintenance", title: "Klima arızası", origin: "manual", status: "todo", assignedToId: mehmet.id },
    });
    const rows = await rowOf(localToday(14));
    expect(rows[0].readiness.overall).toBe("unknown"); // eskiden "HAZIR DEĞİL"
    const issues = rows[0].readiness.factors.filter((f) => f.key === "issue");
    const d = (k: string) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${k}T12:00:00Z`));
    expect(issues.map((f) => [f.state, f.label])).toEqual([
      ["unknown", `Bakım açık: Klima arızası · eski konaklamadan (${d(addNights(TODAY, -30))} – ${d(addNights(TODAY, -27))}) · atanan: Mehmet — bu girişi etkiliyor mu?`],
    ]);
    expect(issues[0].basis).toEqual([{ kind: "task", id: m.id, at: null }]);
  });

  it("🚨 Opus 11-06 N4: önceki konaklaması OLMAYAN dairede gelen konaklamanın KENDİ bakımı → ENGEL ('eski konaklamadan' YAZMAZ)", async () => {
    const own = await reservation(TODAY, addNights(TODAY, 3), "İlk Misafir");
    await prisma.task.create({ data: { propertyId, reservationId: own.id, type: "maintenance", title: "Klima", origin: "ai", status: "todo" } });
    const rows = await rowOf();
    const issue = rows[0].readiness.factors.find((f) => f.key === "issue")!;
    expect(issue.state).toBe("blocking");
    expect(issue.label).not.toContain("konaklamadan");
    expect(rows[0].readiness.overall).toBe("not_ready");
  });

  it("Opus 11-06 N4: SONRAKİ bir konaklamaya bağlı tarihsiz bakım 'sonraki konaklamadan' yazar (eski değil)", async () => {
    await sameDayTurnover();
    const later = await reservation(addNights(TODAY, 5), addNights(TODAY, 7), "Sonraki Misafir");
    await prisma.task.create({ data: { propertyId, reservationId: later.id, type: "maintenance", title: "Perde", origin: "manual", status: "todo" } });
    const issue = (await rowOf())[0].readiness.factors.find((f) => f.key === "issue" && f.label.includes("Perde"))!;
    const d = (k: string) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${k}T12:00:00Z`));
    expect(issue.state).toBe("unknown");
    expect(issue.label).toContain(`sonraki konaklamadan (${d(addNights(TODAY, 5))} – ${d(addNights(TODAY, 7))})`);
  });

  it("bakım ayrımı: bu devre bağlı / tarihli bağsız / ACİL → engel; tarihsiz bağsız → gri; DÜŞÜK öncelik → bilgi", async () => {
    const { next } = await sameDayTurnover();
    const mk = (title: string, over: Record<string, unknown>) =>
      prisma.task.create({ data: { propertyId, type: "maintenance", title, origin: "manual", status: "todo", ...over } });
    await mk("Kapı kilidi", { reservationId: next.id });
    await mk("Ampul", { dueAt: dayDate(TODAY) });
    await mk("Dolap kulpu", {});
    await mk("Su kaçağı", { priority: "urgent" });
    await mk("Boya rötuşu", { priority: "low" });
    const rows = await rowOf();
    const stateOf = (title: string) => rows[0].readiness.factors.find((f) => f.key === "issue" && f.label.includes(title))!.state;
    expect(stateOf("Kapı kilidi")).toBe("blocking");
    expect(stateOf("Ampul")).toBe("blocking");
    expect(stateOf("Su kaçağı")).toBe("blocking");
    expect(stateOf("Dolap kulpu")).toBe("unknown");
    expect(stateOf("Boya rötuşu")).toBe("info");
    expect(rows[0].readiness.factors.find((f) => f.label.includes("Boya rötuşu"))!.label).toContain("(düşük öncelik)");
  });

  it("dayanak: devirdeki açık kontrol görevi (önceki konaklamaya bağlı) adı + vadesiyle; bakım görevi aynı satırda iki kez yazılmaz", async () => {
    const { prev } = await sameDayTurnover();
    const k = await prisma.task.create({
      data: { propertyId, reservationId: prev.id, type: "checkout_review", title: "Çıkış kontrolü", origin: "system", status: "todo", dueAt: dayDate(TODAY) },
    });
    // Bağsız + devir günü vadeli bakım: hem `openIssue` hem `maintenanceOpen` kümesine girer → tek satır.
    const b = await prisma.task.create({ data: { propertyId, reservationId: null, type: "maintenance", title: "Ampul", origin: "manual", status: "todo", dueAt: dayDate(TODAY) } });
    const rows = await rowOf();
    const issues = rows[0].readiness.factors.filter((f) => f.key === "issue");
    expect(issues.map((f) => f.label).sort()).toEqual(
      ["Bakım açık: Ampul · kimseye atanmadı · vade bugün", "Check-out Kontrol açık: Çıkış kontrolü · kimseye atanmadı · vade bugün"].sort(),
    );
    expect(issues.map((f) => f.basis[0].id).sort()).toEqual([k.id, b.id].sort());
  });

  it("dayanak: gösterilenden fazla açık bakım görevi varsa 'başkaları da var' satırı (sessiz kesme yok)", async () => {
    await sameDayTurnover();
    for (let i = 0; i < 6; i++) {
      await prisma.task.create({ data: { propertyId, reservationId: null, type: "maintenance", title: `Bakım ${i}`, origin: "manual", status: "todo" } });
    }
    const rows = await rowOf();
    const labels = rows[0].readiness.factors.filter((f) => f.key === "issue").map((f) => f.label);
    expect(labels).toHaveLength(6);
    expect(labels.at(-1)).toBe("Bu mülkte başka açık bakım görevleri de var");
  });

  it("KONTROL — tam 5 açık bakım görevi: hepsi yazılır, 'başkaları da var' YAZILMAZ", async () => {
    await sameDayTurnover();
    for (let i = 0; i < 5; i++) {
      await prisma.task.create({ data: { propertyId, reservationId: null, type: "maintenance", title: `Bakım ${i}`, origin: "manual", status: "todo" } });
    }
    const rows = await rowOf();
    const labels = rows[0].readiness.factors.filter((f) => f.key === "issue").map((f) => f.label);
    expect(labels).toHaveLength(5);
    expect(labels).not.toContain("Bu mülkte başka açık bakım görevleri de var");
  });

  it("🚨 dayanak: varış gecesini işgal eden konaklamanın adı + tarihleri; aynı gün İKİ ayrılış da çakışmadır (ikisi de yazılır)", async () => {
    const { prev } = await sameDayTurnover();
    const occ = await reservation(addNights(TODAY, -1), addNights(TODAY, 1), "Çakışan Misafir");
    let rows = await rowOf();
    let lines = rows[0].readiness.factors.filter((f) => f.key === "overlap");
    expect(lines).toHaveLength(1);
    expect(lines[0].label.startsWith("Çakışan konaklama: Çakışan Misafir · ")).toBe(true);
    expect(lines[0].basis).toEqual([{ kind: "reservation", id: occ.id, at: null }]);
    await prisma.reservation.delete({ where: { id: occ.id } });
    const second = await reservation(addNights(TODAY, -2), TODAY, "İkinci Ayrılan");
    rows = await rowOf();
    lines = rows[0].readiness.factors.filter((f) => f.key === "overlap");
    expect(lines.map((f) => f.basis[0].id).sort()).toEqual([prev.id, second.id].sort());
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

  // ---- Erişim satırı = misafire GİDECEK otomatik giriş mesajı (Codex 11-05: bilgi tabanında giriş kaydı olması yetmez) ----

  it("🚨 Codex: bilgi tabanında giriş kaydı OLSA da otomatik giriş mesajı kapalıysa satır bunu söyler; değer OKUNMAZ / gösterilmez", async () => {
    await sameDayTurnover();
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "checkin", title: "Giriş", content: "Kapı kodu 4512" } });
    const rows = await rowOf();
    expect(factor(rows[0], "access")!.label).toBe("Otomatik giriş mesajı kapalı · giriş bilgisini siz gönderin");
    expect(JSON.stringify(rows)).not.toContain("4512");
  });

  it("otomatik giriş mesajı: açık ama yazılmamış → bilgi; hazır → 'hazır · kontrol edilmedi'; metni gösterilmez", async () => {
    const { next } = await sameDayTurnover();
    await autoCheckinSendable(next.id);
    expect(factor((await rowOf())[0], "access")!.label).toBe("Otomatik giriş mesajı yazılmamış · giriş bilgisini siz gönderin");
    const tpl = await prisma.autoMessageTemplate.create({ data: { organizationId: orgId, propertyId, kind: "checkin", body: "Kapı kodu 4512" } });
    const rows = await rowOf();
    expect(factor(rows[0], "access")).toMatchObject({
      state: "info",
      label: "Otomatik giriş mesajı hazır · kapıya / kutuya yerleştiği kontrol edilmedi",
      basis: [{ kind: "auto_message", id: tpl.id, at: tpl.updatedAt }],
    });
    expect(JSON.stringify(rows)).not.toContain("4512");
  });

  it("🚨 otomatik giriş mesajı GÖNDERİLEMİYORSA (doldurulmamış alan) satır ENGEL; gözden geçirme bekliyorsa gri", async () => {
    const { prev, next } = await sameDayTurnover();
    await autoCheckinSendable(next.id);
    const t = await cleaningTask(prev.id, { status: "done" });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "done", createdAt: localToday(12, 0) } });
    const tpl = await prisma.autoMessageTemplate.create({
      data: { organizationId: orgId, propertyId, kind: "checkin", body: "Kapı kodu: {kod}", lastSkipReason: "unfilled", lastSkippedAt: localToday(9, 0) },
    });
    let rows = await rowOf(localToday(14));
    expect(factor(rows[0], "access")).toMatchObject({ state: "blocking", label: "Otomatik giriş mesajı gönderilemiyor: doldurulmamış alan var" });
    expect(rows[0].readiness.overall).toBe("not_ready");
    await prisma.autoMessageTemplate.update({ where: { id: tpl.id }, data: { body: "Kapı kodu 4512", lastSkipReason: null, needsReview: true } });
    rows = await rowOf(localToday(14));
    expect(factor(rows[0], "access")!.state).toBe("unknown");
    expect(rows[0].readiness.overall).toBe("unknown");
  });

  it("🚨 Opus 11-06 N3: eski 'atlandı' kaydı DÜZELTİLMİŞ metni kırmızı tutmaz (sebep metnin bugünkü hâlinden — kartla aynı kural)", async () => {
    const { prev, next } = await sameDayTurnover();
    await autoCheckinSendable(next.id);
    const t = await cleaningTask(prev.id, { status: "done" });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: staffId, status: "done", createdAt: localToday(12, 0) } });
    // Bir kez atlanmış (eski sebep duruyor), metin sonradan düzelmiş: artık gönderilecek.
    await prisma.autoMessageTemplate.create({
      data: { organizationId: orgId, propertyId, kind: "checkin", body: "Kapı kodu 4512", lastSkipReason: "unfilled", lastSkippedAt: localToday(9, 0) },
    });
    const rows = await rowOf(localToday(14));
    expect(factor(rows[0], "access")).toMatchObject({ state: "info", label: "Otomatik giriş mesajı hazır · kapıya / kutuya yerleştiği kontrol edilmedi" });
    expect(rows[0].readiness.overall).toBe("cleaning_ready");
  });

  it("🚨 Opus 11-06 N2: TAKVİMDEN gelen (kanaldan mesajlaşamayan) rezervasyon + dolu şablon → 'hazır' DEMEZ; siz gönderin", async () => {
    const { next } = await sameDayTurnover();
    await autoCheckinSendable(next.id);
    await prisma.autoMessageTemplate.create({ data: { organizationId: orgId, propertyId, kind: "checkin", body: "Kapı kodu 4512" } });
    await prisma.reservation.update({ where: { id: next.id }, data: { sourceReference: null } });
    expect(factor((await rowOf())[0], "access")).toMatchObject({
      state: "info",
      label: "Bu rezervasyona otomatik mesaj gönderilemiyor (takvimden ya da elle eklendi) · giriş bilgisini siz gönderin",
    });
  });

  it("Haiku 11-06: gönderici yalnız ONAYLI ve SİLİNMEMİŞ misafire gönderir — liste de 'hazır' demez", async () => {
    vi.stubEnv("ERASURE_HMAC_SECRET", "x".repeat(48));
    const { next } = await sameDayTurnover();
    await autoCheckinSendable(next.id);
    await prisma.autoMessageTemplate.create({ data: { organizationId: orgId, propertyId, kind: "checkin", body: "Kapı kodu 4512" } });
    const label = async () => factor((await rowOf())[0], "access")!.label;
    expect(await label()).toBe("Otomatik giriş mesajı hazır · kapıya / kutuya yerleştiği kontrol edilmedi");
    await prisma.erasureTombstone.create({
      data: {
        organizationId: orgId,
        keyType: "source_reference",
        keyHash: tombstoneKeyHash(orgId, "source_reference", `ref-${next.id}`)!,
        keyFingerprint: currentKeyFingerprint(),
        erasedAt: new Date(),
      },
    });
    expect(await label()).toBe("Misafirin verileri silindiği için otomatik mesaj gitmez · giriş bilgisini siz gönderin");
    await prisma.erasureTombstone.deleteMany({});
    await prisma.reservation.update({ where: { id: next.id }, data: { status: "completed" } });
    expect(await label()).toBe("Otomatik giriş mesajı gitmez · giriş bilgisini siz gönderin");
  });

  it("Opus 11-06 N2: gönderildiyse 'gönderildi <an>'; genel anahtar kapalı / bağlantı yok / açılıştan önceki rezervasyon → gitmez", async () => {
    const { next } = await sameDayTurnover();
    await autoCheckinSendable(next.id);
    await prisma.autoMessageTemplate.create({ data: { organizationId: orgId, propertyId, kind: "checkin", body: "Kapı kodu 4512" } });
    const label = async () => factor((await rowOf())[0], "access")!.label;
    expect(await label()).toBe("Otomatik giriş mesajı hazır · kapıya / kutuya yerleştiği kontrol edilmedi");
    // Açılıştan önce yapılmış rezervasyon (taban sonradan): gönderici aday yapmaz.
    await prisma.organization.update({ where: { id: orgId }, data: { autoCheckinEnabledAt: new Date(Date.now() + 60_000) } });
    expect(await label()).toBe("Rezervasyon otomatik giriş mesajı açılmadan önce yapılmış, mesaj gitmez · giriş bilgisini siz gönderin");
    await prisma.organization.update({ where: { id: orgId }, data: { autoCheckinEnabledAt: new Date(Date.now() - 30 * 86_400_000), hospitableTokenEnc: null } });
    expect(await label()).toBe("Kanal bağlantısı yok, otomatik giriş mesajı gitmez · giriş bilgisini siz gönderin");
    vi.stubEnv("AUTO_REPLY_ENABLED", "");
    expect(await label()).toBe("Otomatik mesajlar şu an kapalı · giriş bilgisini siz gönderin");
    // Gönderilmişse — anahtar sonradan kapansa da — gönderildi yazar.
    await prisma.reservation.update({ where: { id: next.id }, data: { checkinSentAt: localToday(10, 5) } });
    expect(await label()).toBe("Otomatik giriş mesajı gönderildi 10:05 · kapıya / kutuya yerleştiği kontrol edilmedi");
  });

  it("bilgi tabanındaki giriş bilgisi otomatik mesajdan YENİYSE hazır satırına 'kontrol edin' notu eklenir", async () => {
    const { next } = await sameDayTurnover();
    await autoCheckinSendable(next.id);
    await prisma.autoMessageTemplate.create({ data: { organizationId: orgId, propertyId, kind: "checkin", body: "x", updatedAt: new Date(Date.now() - 86_400_000) } });
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "checkin", title: "Giriş", content: "yeni kod" } });
    expect(factor((await rowOf())[0], "access")!.label).toBe(
      "Otomatik giriş mesajı hazır · bilgi tabanındaki giriş bilgisi daha yeni — kontrol edin · kapıya / kutuya yerleştiği kontrol edilmedi",
    );
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

  it("F8: batı saat diliminde karışık kaynaklı girişler GÜN sırasıyla gelir (ham an sırasıyla değil)", async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: "America/New_York" } });
    const NY = "America/New_York";
    const today = todayKey(new Date(), NY);
    const tomorrow = addNights(today, 1);
    // A: yarın 00:00Z (yalnız-tarih çapası → yarın); B: yarın 02:00Z ANI (New York'ta bugün 21:00/22:00 → bugün).
    await prisma.reservation.create({
      data: { propertyId, guestName: "A-yarın", arrivalDate: new Date(`${tomorrow}T00:00:00Z`), departureDate: new Date(`${addNights(tomorrow, 2)}T00:00:00Z`), status: "confirmed", channel: "airbnb" },
    });
    await prisma.reservation.create({
      data: { propertyId, guestName: "B-bugün", arrivalDate: new Date(`${tomorrow}T02:00:00Z`), departureDate: new Date(`${addNights(tomorrow, 2)}T02:00:00Z`), status: "confirmed", channel: "airbnb" },
    });
    const rows = (await loadArrivalReadiness(orgId, new Date())).rows;
    const keys = rows.map((r) => r.dayKey);
    expect([...keys].sort()).toEqual(keys);
    expect(rows.map((r) => r.guestName)).toEqual(["B-bugün", "A-yarın"]);
  });

  it("🚨 kiracılar arası (Opus F11): başka işletmede AYNI kurulum (devir, kendi personeli, 'bitti', söz, ihtiyaç, giriş talimatı) bu satırlara SIZMAZ", async () => {
    const { prev } = await sameDayTurnover();
    await cleaningTask(prev.id); // bizim görev: açık, atanmamış
    const other = await makeOrgWithProperty({ checkInTime: "15:00", checkOutTime: "11:00" });
    const zeynep = await prisma.user.create({ data: { organizationId: other.orgId, name: "Zeynep", email: "zeynep@example.test", passwordHash: "x", role: "staff" } });
    const oPrev = await reservation(addNights(TODAY, -2), TODAY, "Öteki Önceki", other.propertyId);
    const oNext = await reservation(TODAY, addNights(TODAY, 2), "Öteki Yeni", other.propertyId);
    const oTask = await prisma.task.create({
      data: { propertyId: other.propertyId, reservationId: oPrev.id, type: "cleaning", title: "Çıkış temizliği", origin: "system", status: "done", dueAt: dayDate(TODAY), assignedToId: zeynep.id },
    });
    await prisma.taskUpdate.create({ data: { taskId: oTask.id, userId: zeynep.id, status: "done", createdAt: localToday(12, 0) } });
    const oConv = await prisma.conversation.create({ data: { propertyId: other.propertyId, reservationId: oNext.id, guestIdentifier: "Öteki", channel: "airbnb" } });
    await prisma.guestCommitment.create({ data: { organizationId: other.orgId, conversationId: oConv.id, kind: "supplies", dueAt: localToday(15) } });
    await prisma.conversationItem.create({ data: { organizationId: other.orgId, conversationId: oConv.id, messageId: "m-o", kind: "parking", sources: "understanding", status: "pending_host" } });
    await prisma.knowledgeBaseItem.create({ data: { propertyId: other.propertyId, category: "checkin", title: "Giriş", content: "x" } });
    const rows = await rowOf(localToday(14));
    expect(rows.map((r) => r.guestName)).toEqual(["Yeni Misafir"]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("Zeynep");
    expect(factor(rows[0], "cleaning")!.label).toBe("Temizlik açık · kimseye atanmadı · başlanmadı");
    expect(factor(rows[0], "commitment")).toBeUndefined();
    expect(factor(rows[0], "need")).toBeUndefined();
    expect(factor(rows[0], "access")!.label).toBe("Otomatik giriş mesajı kapalı · giriş bilgisini siz gönderin");
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
