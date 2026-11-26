// ---------------------------------------------------------------------------
// İKİ AYRI UYGULAMA İŞÇİSİ (kurucu 10-15 madde 6): bu betik AYRI bir Node sürecinde koşar — kendi Prisma istemcisi, kendi bağlantı havuzu,
// kendi bellek durumu. Ana test iki kopyasını başlatır; ikisi "hazır" deyince aynı anda "başla" gönderir. Kilitli bölgedeki test kancası
// `HOLD_MS` bekletilir: kilit yoksa iki süreç de "var mı?" okumasını boş görür (çift kayıt); kilit varsa ikinci süreç PostgreSQL kilidinde
// bekler. Süreç kendi kancaya giriş / çıkış anını yazar → ana test iki sürecin kilitli bölgede ÇAKIŞMADIĞINI zamanla da doğrular.
//
// Koşturma (ana test yapar): TSX_TSCONFIG_PATH=tests/workers/tsconfig.json tsx tests/workers/idem-worker.ts
// Girdi env: DATABASE_URL · ACTION (reservation-tasks | task-from-message | commitment) · ARGS (JSON) · HOLD_MS
// Çıktı (stdout, satır başına JSON): {"ready":true} → {"result":…,"enter":ms,"leave":ms}
// ---------------------------------------------------------------------------
import { createInterface } from "node:readline";
import { createReservationTasks, __reservationTaskHooks } from "@/lib/automation";
import { createOperationalTaskFromMessage, __taskDedupeHooks } from "@/lib/tasks/create";
import { createGuestCommitment, __commitmentHooks } from "@/lib/guest-commitments";
import { prisma } from "@/lib/db";

const action = process.env.ACTION ?? "";
const args = JSON.parse(process.env.ARGS ?? "{}") as Record<string, string>;
const holdMs = Number(process.env.HOLD_MS ?? "800");

let enter = 0;
let leave = 0;
const hold = async () => {
  enter = Date.now();
  await new Promise((r) => setTimeout(r, holdMs));
  leave = Date.now();
};
__reservationTaskHooks.afterExistingRead = hold;
__taskDedupeHooks.afterExistingRead = hold;
__commitmentHooks.afterSameCheck = hold;

async function run(): Promise<unknown> {
  if (action === "reservation-tasks") return createReservationTasks(args.reservationId);
  if (action === "task-from-message") {
    return createOperationalTaskFromMessage({
      propertyId: args.propertyId,
      message: args.message,
      sourceMessageId: args.sourceMessageId,
      now: new Date(args.now),
    });
  }
  if (action === "commitment") {
    return createGuestCommitment({
      organizationId: args.organizationId,
      conversationId: args.conversationId,
      propertyId: args.propertyId,
      reservationId: null,
      kind: "towels",
      dueAt: new Date(args.dueAt),
      actorUserId: args.actorUserId,
      clientRequestId: args.clientRequestId ?? null,
    });
  }
  throw new Error(`bilinmeyen işlem: ${action}`);
}

async function main() {
  await prisma.$connect(); // bağlantı "başla"dan ÖNCE açılır — iki sürecin yarışı bağlantı kurma süresine kalmasın
  process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (line.trim() !== "go") continue;
    try {
      const result = await run();
      process.stdout.write(`${JSON.stringify({ result, enter, leave })}\n`);
    } catch (err) {
      process.stdout.write(`${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n`);
    }
    break;
  }
  await prisma.$disconnect();
  process.exit(0);
}
void main();
