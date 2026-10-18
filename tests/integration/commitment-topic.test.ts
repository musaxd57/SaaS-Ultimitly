import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// I1 (kurucu 10-17 "A", migration 73) — gerçek PostgreSQL: sözün KONUSU. Aynı saatte "klima" ve "musluk" sözü iki ayrı söz + iki görev; aynı
// konu iki mesajda tek söz; konusuz öneri mevcut söze katılır; konusuz ELLE söz + konulu öneri birleşir ve söze konu YAZILIR (kurucu Q1 "a").
// Öneri listesi ile onay AYNI yüklemi kullanır (görünen öneri onayda "gone" dönmez).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/ai-suggestions/route";
import { __afterMidnightRule, getConversationSuggestions } from "@/lib/ai-suggestions/load";
import { __aiSuggestionHooks } from "@/lib/ai-suggestions/act";
import { createGuestCommitment } from "@/lib/guest-commitments";
import { commitmentDueAt } from "@/lib/guest-commitments-core";
import { orgTimezone } from "@/lib/timezone";

const decide = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/ai-suggestions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({}),
  } as never);

let seq = 0;
async function asOwner(orgId: string) {
  const u = await prisma.user.create({ data: { organizationId: orgId, name: "U", email: `u${++seq}-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
  session = { userId: u.id, organizationId: orgId, role: "owner", email: u.email, name: "U", sessionEpoch: 0 } as SessionPayload;
  return u;
}

async function conversationWith(propertyId: string, hostBodies: string[]) {
  const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir", channel: "airbnb", status: "new" } });
  for (const [i, body] of hostBodies.entries()) {
    await prisma.message.create({
      data: { conversationId: c.id, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body, createdAt: new Date(Date.now() - (10 - i) * 60_000) },
    });
  }
  return c.id;
}

/** "Yarın 10:00" — her test anında ileride (sabit "bugün" saati gece koşusunda geçmiş olurdu — zaman bombası dersi). */
const WHEN = "yarın 10:00";

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("AI_ACTION_SUGGESTIONS_ENABLED", "1");
  // Mesajlar gerçek saatle yazılır: gece yarısı kuralı (gece-4 S1-02) İstanbul 00:00–04:59'da koşan testleri kırmasın.
  __afterMidnightRule.enabled = false;
});
afterEach(() => {
  vi.unstubAllEnvs();
  __afterMidnightRule.enabled = true;
});

describe("söz konusu", () => {
  it("🚨 aynı saatte 'klima' ve 'musluk' sözü → İKİ öneri, İKİ söz, İKİ görev (ESKİDE: tek söz, ikinci onay 'gone')", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`, `Musluk için usta ${WHEN}'da gelecek.`]);
    const list = await getConversationSuggestions(orgId, conv);
    // Gün sözcüğü mesajın gününe göre ("yarın" ya da gece yarısını geçen koşuda "bugün") — Haiku 10-17 zaman bombası: saat ve konu sınanır.
    const titles = list.filter((s) => s.kind === "commitment").map((s) => s.title).sort();
    expect(titles).toHaveLength(2);
    expect(titles[0]).toMatch(/^Söz kaydet: Arıza \/ bakım · klima — (?:bugün|yarın) 10:00$/u);
    expect(titles[1]).toMatch(/^Söz kaydet: Arıza \/ bakım · musluk — (?:bugün|yarın) 10:00$/u);
    for (const s of list) expect((await decide({ key: s.key, decision: "approve" })).status).toBe(200);
    const rows = await prisma.guestCommitment.findMany({ where: { conversationId: conv }, orderBy: { topic: "asc" } });
    expect(rows.map((r) => r.topic)).toEqual(["ac", "faucet"]);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(2);
    expect((await prisma.task.findMany({ where: { propertyId }, orderBy: { title: "asc" } })).map((t) => t.title)).toEqual([
      "Misafire söz: Arıza / bakım · klima",
      "Misafire söz: Arıza / bakım · musluk",
    ]);
  });

  it("🚨 klima sözü onaylandıktan sonra musluk önerisi listede KALIR (eskiden aynı tür + saat diye gizleniyordu)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`, `Musluk için usta ${WHEN}'da gelecek.`]);
    const ac = (await getConversationSuggestions(orgId, conv)).find((s) => s.title.includes("klima"))!;
    expect((await decide({ key: ac.key, decision: "approve" })).status).toBe(200);
    const after = (await getConversationSuggestions(orgId, conv)).map((s) => s.title);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatch(/· musluk — /u);
  });

  it("aynı konu iki mesajda ve konusuz söz ('Teknisyen ... gelecek') mevcut konulu söze denk → listede görünmez (onayda aynı söze döneceği için); yeni söz / görev YOK", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`]);
    const [first] = await getConversationSuggestions(orgId, conv);
    expect((await decide({ key: first!.key, decision: "approve" })).status).toBe(200);
    // Aynı konu tekrar + konusuz söz: ikisi de listede görünmez (onayda aynı söz döneceği için — ölü düğme yok).
    await prisma.message.create({
      data: { conversationId: conv, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: `Klimayı ${WHEN}'da teknisyen tamir edecek.` },
    });
    await prisma.message.create({ data: { conversationId: conv, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: `Teknisyen ${WHEN}'da gelecek.` } });
    expect((await getConversationSuggestions(orgId, conv)).filter((s) => s.kind === "commitment")).toEqual([]);
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv } })).toBe(1);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
  });

  it("🚨 Q1 'a' (kurucu 10-17): konusuz ELLE söz (mesajdan ÖNCE) + aynı saatte konulu öneri → öneri GÖRÜNÜR; onay yeni görev açmaz, söze 'klima' yazılır; ardından musluk önerisi AYRI söz + görev", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`, `Musluk için usta ${WHEN}'da gelecek.`]);
    const tz = orgTimezone((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).timezone);
    const dueAt = commitmentDueAt({ day: "tomorrow", time: "10:00" }, tz, new Date())!;
    const manual = await createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", dueAt, actorUserId: owner.id, clientRequestId: "elle-1" });
    // Elle söz mesajlardan ÖNCE kaydedilmiş (kurucunun örneğindeki sıra).
    await prisma.guestCommitment.update({ where: { id: manual.id }, data: { createdAt: new Date(Date.now() - 60 * 60_000) } });
    const list = (await getConversationSuggestions(orgId, conv)).filter((s) => s.kind === "commitment");
    expect(list.map((s) => s.title).sort()).toEqual([expect.stringMatching(/· klima — /u), expect.stringMatching(/· musluk — /u)]); // ⬅️ ESKİDE ikisi de gizliydi
    const ac = list.find((s) => /klima/u.test(s.title))!;
    const res = await decide({ key: ac.key, decision: "approve" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { created: unknown }).created).toMatchObject({ merged: true, topicAttached: true, commitmentId: manual.id });
    expect(await prisma.guestCommitment.findUniqueOrThrow({ where: { id: manual.id } })).toMatchObject({ topic: "ac" });
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: manual.taskId } })).toMatchObject({ title: "Misafire söz: Arıza / bakım · klima" });
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "commitment.topic_attached" } })).toBe(1);
    // Musluk önerisi hâlâ listede (klima sözü onu karşılamaz) → onay AYRI söz + görev.
    const rest = (await getConversationSuggestions(orgId, conv)).filter((s) => s.kind === "commitment");
    expect(rest.map((s) => s.title)).toEqual([expect.stringMatching(/· musluk — /u)]);
    expect((await decide({ key: rest[0]!.key, decision: "approve" })).status).toBe(200);
    expect((await prisma.guestCommitment.findMany({ where: { conversationId: conv }, orderBy: { createdAt: "asc" } })).map((c) => c.topic)).toEqual(["ac", "faucet"]);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(2);
  });

  it("Q1 'a' sınırları: ev sahibinin DEĞİŞTİRDİĞİ görev başlığına dokunulmaz; mesajdan SONRA elle kaydedilen konusuz söz öneriyi gizler (ev sahibi zaten kaydetti)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`]);
    const tz = orgTimezone((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).timezone);
    const dueAt = commitmentDueAt({ day: "tomorrow", time: "10:00" }, tz, new Date())!;
    const manual = await createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", dueAt, actorUserId: owner.id, clientRequestId: "elle-1" });
    // Mesajdan SONRA kaydedildi → liste kapısı 1 (ev sahibi bu mesajdan sonra zaten söz kaydetti): öneri yok, konu yazılmaz.
    expect((await getConversationSuggestions(orgId, conv)).filter((s) => s.kind === "commitment")).toEqual([]);
    expect(await prisma.guestCommitment.findUniqueOrThrow({ where: { id: manual.id } })).toMatchObject({ topic: null });
    // Mesajdan ÖNCEye çekilip görev başlığı ev sahibince değiştirilince: konu yazılır, başlık KORUNUR.
    await prisma.guestCommitment.update({ where: { id: manual.id }, data: { createdAt: new Date(Date.now() - 60 * 60_000) } });
    await prisma.task.update({ where: { id: manual.taskId }, data: { title: "Teknisyen — salon kliması" } });
    const [s] = (await getConversationSuggestions(orgId, conv)).filter((x) => x.kind === "commitment");
    expect((await decide({ key: s!.key, decision: "approve" })).status).toBe(200);
    expect(await prisma.guestCommitment.findUniqueOrThrow({ where: { id: manual.id } })).toMatchObject({ topic: "ac" });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: manual.taskId } })).toMatchObject({ title: "Teknisyen — salon kliması" });
  });

  it("Haiku 10-17: görevi silinmiş (taskId boş) açık söz öneriyi GİZLEMEZ — onay ona bağlanamaz, yeni söz + görev açar (liste = onay kümesi)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`]);
    const tz = orgTimezone((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).timezone);
    const dueAt = commitmentDueAt({ day: "tomorrow", time: "10:00" }, tz, new Date())!;
    const orphan = await createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", topic: "ac", dueAt, actorUserId: owner.id, clientRequestId: "eski" });
    await prisma.guestCommitment.update({ where: { id: orphan.id }, data: { createdAt: new Date(Date.now() - 60 * 60_000), taskId: null } });
    const [s] = (await getConversationSuggestions(orgId, conv)).filter((x) => x.kind === "commitment");
    expect(s).toBeTruthy(); // ⬅️ ESKİDE gizliydi (görevsiz söz "karşılıyor" sayılıyordu) ama onay ona bağlanamıyordu
    expect((await decide({ key: s!.key, decision: "approve" })).status).toBe(200);
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv, taskId: { not: null } } })).toBe(1);
  });

  it("mutasyon I1-prefer-equal: aynı saatte ESKİ konusuz + YENİ 'klima' sözü varken klima isteği klima sözüne bağlanır (konusuz söz konusuz kalır, ikinci 'klima' yazılmaz)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, []);
    const dueAt = new Date(Date.now() + 5 * 3_600_000);
    const base = { organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance" as const, dueAt, actorUserId: owner.id };
    const plain = await createGuestCommitment({ ...base, clientRequestId: "elle" });
    const ac = await createGuestCommitment({ ...base, topic: "ac", clientRequestId: "oneri-1" });
    await prisma.guestCommitment.update({ where: { id: plain.id }, data: { createdAt: new Date(Date.now() - 60 * 60_000) } });
    const r = await createGuestCommitment({ ...base, topic: "ac", clientRequestId: "oneri-2", mergeSameSlot: true });
    expect(r).toMatchObject({ id: ac.id, reused: true, via: "slot", topicAttached: false });
    expect(await prisma.guestCommitment.findUniqueOrThrow({ where: { id: plain.id } })).toMatchObject({ topic: null });
  });

  it("🚨 eşzamanlı klima + musluk onayı → İKİ söz; aynı önerinin iki eşzamanlı onayı → TEK söz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`, `Musluk için usta ${WHEN}'da gelecek.`]);
    const list = await getConversationSuggestions(orgId, conv);
    const statuses = (await Promise.all(list.map((s) => decide({ key: s.key, decision: "approve" })))).map((r) => r.status);
    expect(statuses).toEqual([200, 200]);
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv } })).toBe(2);
    const conv2 = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`]);
    const [only] = await getConversationSuggestions(orgId, conv2);
    const twice = (await Promise.all([decide({ key: only!.key, decision: "approve" }), decide({ key: only!.key, decision: "approve" })])).map((r) => r.status).sort();
    expect(twice).toEqual([200, 409]);
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv2 } })).toBe(1);
  });

  it("🚨 AYNI konunun iki ayrı mesajdaki önerisi EŞZAMANLI onaylanırsa → TEK söz, TEK görev; ikinci onay karar yazmaz (409) ve öneri listeden kalkar", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`, `Klimayı ${WHEN}'da teknisyen tamir edecek.`]);
    const list = (await getConversationSuggestions(orgId, conv)).filter((s) => s.kind === "commitment");
    expect(list).toHaveLength(2);
    const statuses = (await Promise.all(list.map((s) => decide({ key: s.key, decision: "approve" })))).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv } })).toBe(1);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: "ai_suggestion.approved" } })).toBe(1);
    expect((await getConversationSuggestions(orgId, conv)).filter((s) => s.kind === "commitment")).toEqual([]);
  });

  it("🚨 Haiku 10-17: ev sahibi saati DÜZENLEYİP mevcut uyumlu söze denk getirirse → onay mevcut söze bağlanır (200, yeni söz yok); öneri listeden kalkar", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Klima için teknisyen ${WHEN}'da gelecek.`]);
    const tz = orgTimezone((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).timezone);
    const elevenTomorrow = commitmentDueAt({ day: "tomorrow", time: "11:00" }, tz, new Date())!;
    const existing = await createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", topic: "ac", dueAt: elevenTomorrow, actorUserId: owner.id, clientRequestId: "x" });
    // Söz mesajdan ÖNCE kaydedilmiş olsun (liste kapısı 1 — "mesajdan sonra kaydedilen söz" — devreye girmesin; yalnız an farkı sınanır).
    await prisma.guestCommitment.update({ where: { id: existing.id }, data: { createdAt: new Date(Date.now() - 60 * 60_000) } });
    const [s] = (await getConversationSuggestions(orgId, conv)).filter((x) => x.kind === "commitment");
    expect(s).toBeDefined(); // 10:00 önerisi 11:00 sözünden farklı an → görünür
    // Yapanı bilinmeyen (elle) aynı konulu söz → kendiliğinden taşınmaz, kart sorar (Opus 10-17 gece O1). Ev sahibi "ayrı söz" seçip saati
    // 11:00'e düzenler → mevcut söze bağlanır (ölü düğme yok).
    expect(s!.kind === "commitment" && s!.proposal.moveOptions?.map((o) => o.commitmentId)).toEqual([existing.id]);
    const res = await decide({ key: s!.key, decision: "approve", day: "tomorrow", time: "11:00", attach: "new" });
    expect(res.status).toBe(200); // ⬅️ ESKİDE 409 ve öneri kalıcı (her tık aynı ret)
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv } })).toBe(1);
    const decision = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "ai_suggestion.approved" } });
    expect(decision.metadataJson).toContain('"merged":true');
    expect((await getConversationSuggestions(orgId, conv)).filter((x) => x.kind === "commitment")).toEqual([]);
  });

  it("liste kapısı 1 (mesajdan SONRA kaydedilmiş söz) konu uyumuna bakar: klima sözü musluk önerisini GİZLEMEZ, klima önerisini gizler", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, [`Musluk için usta ${WHEN}'da gelecek.`]);
    // Mesajdan SONRA, FARKLI saatte, klima konulu söz (öneri yolundan gelmiş gibi).
    await createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", topic: "ac", dueAt: new Date(Date.now() + 30 * 3_600_000), actorUserId: owner.id, clientRequestId: "k1" });
    expect((await getConversationSuggestions(orgId, conv)).map((x) => x.title)).toEqual([expect.stringMatching(/· musluk — /u)]);
    await createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", topic: "faucet", dueAt: new Date(Date.now() + 31 * 3_600_000), actorUserId: owner.id, clientRequestId: "k2" });
    expect((await getConversationSuggestions(orgId, conv)).filter((x) => x.kind === "commitment")).toEqual([]);
  });

  it("KONTROL: elle form konusuz söz yazar (iki elle söz aynı saatte iki ayrı söz — kurucu D3 aynen)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, []);
    const dueAt = new Date(Date.now() + 3 * 3_600_000);
    await createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", dueAt, actorUserId: owner.id, clientRequestId: "a" });
    await createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", dueAt, actorUserId: owner.id, clientRequestId: "b" });
    expect((await prisma.guestCommitment.findMany({ where: { conversationId: conv } })).map((c) => c.topic)).toEqual([null, null]);
  });
});

describe("Q1-b (kurucu 10-17: '2'sini de öner')", () => {
  async function manualCommitment(orgId: string, conv: string, propertyId: string, actor: string, topic: "ac" | "faucet" | null, id: string) {
    const tz = orgTimezone((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).timezone);
    const dueAt = commitmentDueAt({ day: "tomorrow", time: "10:00" }, tz, new Date())!;
    return createGuestCommitment({ organizationId: orgId, conversationId: conv, propertyId, reservationId: null, kind: "maintenance", topic, dueAt, actorUserId: actor, clientRequestId: id });
  }

  it("🚨 TEK mesajda iki söz ('Klima için teknisyen yarın 10'da gelecek. Musluk için usta yarın 11'de gelecek.') → İKİ öneri (anahtar = mesaj + sözün METİNDEKİ konumu); ikisi de onaylanır → iki söz + iki görev", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, ["Klima için teknisyen yarın 10:00'da gelecek. Musluk için usta yarın 11:00'de gelecek."]);
    const msg = await prisma.message.findFirstOrThrow({ where: { conversationId: conv } });
    const list = (await getConversationSuggestions(orgId, conv)).filter((s) => s.kind === "commitment");
    expect(list.map((s) => s.key)).toEqual([`commitment:${msg.id}:0-0-maintenance`, `commitment:${msg.id}:1-0-maintenance`]);
    expect(list[0]!.title).toMatch(/· klima — (?:bugün|yarın) 10:00$/u);
    expect(list[1]!.title).toMatch(/· musluk — (?:bugün|yarın) 11:00$/u);
    // İkinci önce onaylanır: ilk öneri listede kalır (anahtarlar bağımsız).
    expect((await decide({ key: list[1]!.key, decision: "approve" })).status).toBe(200);
    expect((await getConversationSuggestions(orgId, conv)).map((s) => s.key)).toEqual([`commitment:${msg.id}:0-0-maintenance`]);
    expect((await decide({ key: list[0]!.key, decision: "approve" })).status).toBe(200);
    expect((await prisma.guestCommitment.findMany({ where: { conversationId: conv }, orderBy: { topic: "asc" } })).map((r) => r.topic)).toEqual(["ac", "faucet"]);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(2);
    expect(await getConversationSuggestions(orgId, conv)).toEqual([]);
  });

  it("🚨 Haiku 10-17: 'Teknisyen yarın 10:00. Klima için usta yarın 11:00.' → İKİ öneri; ilkini onaylamak ikincisini GİZLEMEZ → iki söz + iki görev", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, ["Teknisyen yarın 10:00'da gelecek. Klima için usta yarın 11:00'de gelecek."]);
    const [a, b] = await getConversationSuggestions(orgId, conv);
    expect([a!.title, b!.title]).toEqual([
      expect.stringMatching(/^Söz kaydet: Arıza \/ bakım — (?:bugün|yarın) 10:00$/u),
      expect.stringMatching(/· klima — (?:bugün|yarın) 11:00$/u),
    ]);
    expect((await decide({ key: a!.key, decision: "approve" })).status).toBe(200);
    expect((await getConversationSuggestions(orgId, conv)).map((s) => s.key)).toEqual([b!.key]);
    expect((await decide({ key: b!.key, decision: "approve" })).status).toBe(200);
    expect((await prisma.guestCommitment.findMany({ where: { conversationId: conv }, orderBy: { dueAt: "asc" } })).map((c) => c.topic)).toEqual([null, "ac"]);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(2);
  });

  it("aynı mesajda AYNI saatte konusuz + konulu söz → iki öneri; ikinci onay ilk söze bağlanır ve konu yazılır (Q1 'a'), ikinci görev YOK", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, ["Teknisyen yarın 10:00'da gelecek. Klima için usta yarın 10:00'da gelecek."]);
    const [a, b] = await getConversationSuggestions(orgId, conv);
    expect((await decide({ key: a!.key, decision: "approve" })).status).toBe(200);
    const r = await decide({ key: b!.key, decision: "approve" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ created: { merged: true, topicAttached: true } });
    expect((await prisma.guestCommitment.findMany({ where: { conversationId: conv } })).map((c) => c.topic)).toEqual(["ac"]);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
  });

  it("KONTROL: BAŞKA mesajdan açılmış söz kardeş muafiyetinden yararlanmaz — kaynağı önce olduğu için öneri kalır ve seçim ister (O8 / O19)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, ["Teknisyen yarın 10:00'da gelecek.", "Klima için usta yarın 11:00'de gelecek."]);
    const list = await getConversationSuggestions(orgId, conv);
    expect(list).toHaveLength(2);
    // Eski mesajın (10:00, konusuz) sözü onaylanınca: sözün KAYNAĞI klima mesajından ÖNCE (Opus O19 — kayıt anı değil kaynak an) → klima
    // önerisi gizlenmez; konusuz eski söz + konulu yeni saat belirsiz → kart "bu saat hangi söze ait?" sorar (O8), kendiliğinden ne taşır ne
    // ikinci görev açar.
    const first = list.find((s) => s.title.includes("10:00"))!;
    expect((await decide({ key: first.key, decision: "approve" })).status).toBe(200);
    const after = (await getConversationSuggestions(orgId, conv)).filter((x) => x.kind === "commitment");
    expect(after).toHaveLength(1);
    expect(after[0]!.kind === "commitment" && after[0]!.proposal.moveOptions?.length).toBe(1);
  });

  it("birini 'yok say' ötekini gizlemez; aynı anahtarın ikinci kararı 409", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, ["Klima için teknisyen yarın 10:00'da gelecek. Musluk için usta yarın 11:00'de gelecek."]);
    const [a, b] = await getConversationSuggestions(orgId, conv);
    expect((await decide({ key: a!.key, decision: "dismiss" })).status).toBe(200);
    expect((await getConversationSuggestions(orgId, conv)).map((s) => s.key)).toEqual([b!.key]);
    expect((await decide({ key: a!.key, decision: "approve" })).status).toBe(409);
    expect(await prisma.guestCommitment.count()).toBe(0);
  });

  it("🚨 uydurma konum (mesaj:7, mesaj:9-9) ve BAŞKA işletmenin mesajı → 409, hiçbir şey yazılmaz (anahtar veriden yeniden üretilir)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await asOwner(orgId);
    const conv = await conversationWith(propertyId, ["Klima için teknisyen yarın 10:00'da gelecek. Musluk için usta yarın 11:00'de gelecek."]);
    const msg = await prisma.message.findFirstOrThrow({ where: { conversationId: conv } });
    expect((await decide({ key: `commitment:${msg.id}:7`, decision: "approve" })).status).toBe(409);
    expect((await decide({ key: `commitment:${msg.id}:9-9`, decision: "approve" })).status).toBe(409);
    const other = await makeOrgWithProperty();
    await asOwner(other.orgId);
    expect((await decide({ key: `commitment:${msg.id}:1-0-maintenance`, decision: "approve" })).status).toBe(409);
    expect(await prisma.guestCommitment.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "ai_suggestion." } } })).toBe(0);
  });

  it("🚨 aynı saatte 'klima' ve 'musluk' sözü kayıtlıyken KONUSUZ 'Teknisyen yarın 10'da gelecek' → öneri GÖRÜNÜR ve seçim ister; seçimsiz onay 400, yazılmaz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, []);
    await manualCommitment(orgId, conv, propertyId, owner.id, "ac", "m-ac");
    await manualCommitment(orgId, conv, propertyId, owner.id, "faucet", "m-faucet");
    await prisma.message.create({ data: { conversationId: conv, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: "Teknisyen yarın 10:00'da gelecek." } });
    const [s] = await getConversationSuggestions(orgId, conv);
    expect(s).toMatchObject({ kind: "commitment", proposal: { topic: null, attachTopics: ["ac", "faucet"] } });
    expect(s!.detail).toBe("Aynı saatte kayıtlı sözler var (klima, musluk) — hangisine bağlanacağını seçin");
    const r = await decide({ key: s!.key, decision: "approve" });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ fields: { attach: "Hangi söze bağlanacağını seçin." } });
    for (const bad of ["heating", "", 3, "AC"]) expect((await decide({ key: s!.key, decision: "approve", attach: bad })).status).toBe(400);
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "ai_suggestion." } } })).toBe(0);
  });

  it("🚨 seçim 'klima' → yeni söz / görev AÇILMAZ, karar klima sözüne bağlanır; öneri listeden kalkar", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, []);
    const ac = await manualCommitment(orgId, conv, propertyId, owner.id, "ac", "m-ac");
    await manualCommitment(orgId, conv, propertyId, owner.id, "faucet", "m-faucet");
    await prisma.message.create({ data: { conversationId: conv, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: "Teknisyen yarın 10:00'da gelecek." } });
    const [s] = await getConversationSuggestions(orgId, conv);
    const r = await decide({ key: s!.key, decision: "approve", attach: "ac" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ created: { merged: true, attachedTopic: "ac", commitmentId: ac.id, taskId: ac.taskId } });
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv } })).toBe(2);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(2);
    expect(await getConversationSuggestions(orgId, conv)).toEqual([]);
  });

  it("seçim 'Yeni söz' → konusuz yeni söz + görev (aynı saatteki sözlere bağlanmaz); saat düzenlenip mevcut söze bağlanmak istenirse 400", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, []);
    await manualCommitment(orgId, conv, propertyId, owner.id, "ac", "m-ac");
    await manualCommitment(orgId, conv, propertyId, owner.id, "faucet", "m-faucet");
    await prisma.message.create({ data: { conversationId: conv, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: "Teknisyen yarın 10:00'da gelecek." } });
    const [s] = await getConversationSuggestions(orgId, conv);
    const edited = await decide({ key: s!.key, decision: "approve", attach: "ac", day: "tomorrow", time: "12:00" });
    expect(edited.status).toBe(400);
    expect(await edited.json()).toMatchObject({ fields: { attach: "Saati değiştirdiyseniz 'Yeni söz olarak kaydet'i seçin." } });
    const r = await decide({ key: s!.key, decision: "approve", attach: "new" });
    expect(r.status).toBe(200);
    const rows = await prisma.guestCommitment.findMany({ where: { conversationId: conv }, orderBy: { createdAt: "asc" } });
    expect(rows.map((x) => x.topic)).toEqual(["ac", "faucet", null]);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(3);
  });

  it("seçilen söz arada kapandıysa (görev tamamlandı) → 409, yeni söz açılmaz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, []);
    const ac = await manualCommitment(orgId, conv, propertyId, owner.id, "ac", "m-ac");
    await manualCommitment(orgId, conv, propertyId, owner.id, "faucet", "m-faucet");
    await prisma.message.create({ data: { conversationId: conv, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: "Teknisyen yarın 10:00'da gelecek." } });
    const [s] = await getConversationSuggestions(orgId, conv);
    // Öneri listede görüldükten SONRA klima sözü kapandı → liste artık seçim istemez (tek uyumlu söz), onay "gone".
    await prisma.guestCommitment.update({ where: { id: ac.id }, data: { status: "done" } });
    expect((await decide({ key: s!.key, decision: "approve", attach: "ac" })).status).toBe(409);
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv } })).toBe(2);
  });

  it("🚨 mutasyon Q1b-target-open: seçilen söz onay İŞLEMİNİN İÇİNDE (yeniden üretimden sonra) kapanırsa → 409, kapanmış söze bağlanmaz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, []);
    const ac = await manualCommitment(orgId, conv, propertyId, owner.id, "ac", "m-ac");
    await manualCommitment(orgId, conv, propertyId, owner.id, "faucet", "m-faucet");
    await prisma.message.create({ data: { conversationId: conv, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: "Teknisyen yarın 10:00'da gelecek." } });
    const [s] = await getConversationSuggestions(orgId, conv);
    __aiSuggestionHooks.afterDecisionCheck = async () => {
      await prisma.guestCommitment.update({ where: { id: ac.id }, data: { status: "done" } });
    };
    try {
      expect((await decide({ key: s!.key, decision: "approve", attach: "ac" })).status).toBe(409);
    } finally {
      __aiSuggestionHooks.afterDecisionCheck = null;
    }
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "ai_suggestion." } } })).toBe(0);
  });

  it("Opus 10-17 Q1b-A: aynı saatte KONUSUZ söz + iki konulu söz varken konusuz öneri GİZLİ (birebir konusuz söze uyar; 'yeni söz' tuzağı yok)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, []);
    await manualCommitment(orgId, conv, propertyId, owner.id, null, "m-none");
    await manualCommitment(orgId, conv, propertyId, owner.id, "ac", "m-ac");
    await manualCommitment(orgId, conv, propertyId, owner.id, "faucet", "m-faucet");
    await prisma.message.create({ data: { conversationId: conv, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: "Teknisyen yarın 10:00'da gelecek." } });
    expect(await getConversationSuggestions(orgId, conv)).toEqual([]);
  });

  it("KONTROL: aynı saatte TEK konulu söz varken konusuz öneri bugünkü gibi GİZLİ (seçim gereksiz)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const owner = await asOwner(orgId);
    const conv = await conversationWith(propertyId, []);
    await manualCommitment(orgId, conv, propertyId, owner.id, "ac", "m-ac");
    await prisma.message.create({ data: { conversationId: conv, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: "Teknisyen yarın 10:00'da gelecek." } });
    expect(await getConversationSuggestions(orgId, conv)).toEqual([]);
  });
});
