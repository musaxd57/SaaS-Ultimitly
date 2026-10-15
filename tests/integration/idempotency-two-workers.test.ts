import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";

// ---------------------------------------------------------------------------
// TEKRAR GÜVENLİĞİ — İKİ AYRI UYGULAMA İŞÇİSİ (kurucu 10-15 madde 6). Aynı süreçteki `Promise.all` testleri tek bir Prisma istemcisini
// paylaşır; burada iki GERÇEK Node süreci (yatay ölçekte iki kopya ya da iki işçi) kendi istemcileri ve bağlantı havuzlarıyla aynı
// veritabanına aynı anda yazar. Koruma süreç içi bellekte DEĞİL, PostgreSQL kilidinde olduğu için iki süreçte de tek kayıt beklenir.
// Belirlenimci: her süreç kilitli bölgede `HOLD_MS` bekletilir; kilit yoksa iki süreç de "yok" okuyup çift yazar, kilit varsa kilitli
// bölgelerin zaman aralıkları ÇAKIŞMAZ (süreçlerin kendi bildirdiği giriş / çıkış anları).
// Bu dosya her işçi için ~1–2 sn süreç açılışı harcar (tsx + Prisma) — bilinçli.
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, "../..");
const TSX = resolve(ROOT, "node_modules/.bin/tsx");
const HOLD_MS = 800;

type WorkerOut = { result?: unknown; error?: string; enter: number; leave: number };

function startWorker(action: string, args: Record<string, string>): { proc: ChildProcessWithoutNullStreams; ready: Promise<void>; done: Promise<WorkerOut> } {
  const proc = spawn(TSX, ["tests/workers/idem-worker.ts"], {
    cwd: ROOT,
    env: { ...process.env, TSX_TSCONFIG_PATH: "tests/workers/tsconfig.json", ACTION: action, ARGS: JSON.stringify(args), HOLD_MS: String(HOLD_MS) },
  });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += String(d)));
  const lines = createInterface({ input: proc.stdout });
  let onReady: () => void = () => {};
  let onDone: (v: WorkerOut) => void = () => {};
  let onFail: (e: Error) => void = () => {};
  const ready = new Promise<void>((r) => (onReady = r));
  const done = new Promise<WorkerOut>((r, j) => {
    onDone = r;
    onFail = j;
  });
  lines.on("line", (line) => {
    const msg = JSON.parse(line) as { ready?: boolean } & WorkerOut;
    if (msg.ready) onReady();
    else onDone(msg);
  });
  proc.on("exit", (code) => {
    if (code !== 0) onFail(new Error(`işçi çıkış ${code}: ${stderr.slice(-2000)}`));
  });
  return { proc, ready, done };
}

/** İki işçiyi başlatır, ikisi hazır olunca AYNI ANDA "başla" gönderir, sonuçları döndürür. */
async function race(action: string, args: Record<string, string>): Promise<[WorkerOut, WorkerOut]> {
  const w1 = startWorker(action, args);
  const w2 = startWorker(action, args);
  await Promise.all([w1.ready, w2.ready]);
  w1.proc.stdin.write("go\n");
  w2.proc.stdin.write("go\n");
  return Promise.all([w1.done, w2.done]);
}

/** İki sürecin kilitli bölgeye giriş-çıkış aralıkları çakışmıyor (biri hiç girmediyse 0). */
const overlapMs = (a: WorkerOut, b: WorkerOut) =>
  a.enter && b.enter ? Math.max(0, Math.min(a.leave, b.leave) - Math.max(a.enter, b.enter)) : 0;

describe("İki ayrı uygulama işçisi (ayrı Node süreçleri) aynı anda", () => {
  let orgId: string;
  let propertyId: string;
  beforeEach(async () => {
    await resetDb();
    ({ orgId, propertyId } = await makeOrgWithProperty());
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 rezervasyon görevleri: iki süreç → TEK giriş hazırlığı + TEK temizlik; kilitli bölgeler çakışmaz", async () => {
    const r = await prisma.reservation.create({
      data: { propertyId, guestName: "Ada", arrivalDate: daysFromNow(2), departureDate: daysFromNow(4), channel: "airbnb", status: "confirmed" },
    });
    const [a, b] = await race("reservation-tasks", { reservationId: r.id });
    expect(a.error ?? b.error).toBeUndefined();
    expect((a.result as number) + (b.result as number)).toBe(2);
    expect((await prisma.task.findMany({ where: { reservationId: r.id }, select: { type: true } })).map((t) => t.type).sort()).toEqual(["checkin_prep", "cleaning"]);
    expect(overlapMs(a, b)).toBe(0);
  }, 60_000);

  it("🚨 mesajdan görev: aynı mesaj iki süreçte → TEK görev", async () => {
    const [a, b] = await race("task-from-message", { propertyId, message: "Klima bozuk", sourceMessageId: "msg-w-1", now: "2026-07-10T09:00:00.000Z" });
    expect(a.error ?? b.error).toBeUndefined();
    expect([(a.result as { status: string }).status, (b.result as { status: string }).status].sort()).toEqual(["created", "duplicate"]);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
    expect(overlapMs(a, b)).toBe(0);
  }, 60_000);

  it("🚨 söz: aynı söz iki süreçte → TEK söz + TEK görev", async () => {
    const conv = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "Misafir" } });
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "U", email: `w-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
    const [a, b] = await race("commitment", {
      organizationId: orgId,
      conversationId: conv.id,
      propertyId,
      actorUserId: user.id,
      dueAt: new Date(Date.now() + 26 * 3_600_000).toISOString(),
      clientRequestId: "a1b2c3d4e5f60718293a4b5c6d7e8f90", // iki süreç AYNI isteğin tekrarı (kurucu D3: tekilleştirme işlem kimliğiyle)
    });
    expect(a.error ?? b.error).toBeUndefined();
    expect(await prisma.guestCommitment.count({ where: { conversationId: conv.id } })).toBe(1);
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
    expect((a.result as { id: string }).id).toBe((b.result as { id: string }).id);
  }, 60_000);
});
