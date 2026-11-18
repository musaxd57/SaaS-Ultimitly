import { prisma } from "@/lib/db";
import { taskSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, propertyInOrg, canManage, readJsonCappedOrNull } from "@/lib/api";
import { withAuth, withManage } from "@/lib/route-guard";
import { staffTaskProjection } from "@/lib/tasks/staff-view";
import { findOrCreateManualTask, withoutDedupeKey } from "@/lib/tasks/manual-request";

export const GET = withAuth(async (session, req) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;
  const propertyId = searchParams.get("propertyId") ?? undefined;

  const tasks = await prisma.task.findMany({
    where: {
      property: { organizationId: session.organizationId },
      // Staff see ONLY the tasks assigned to them; owner/manager see all.
      ...(canManage(session) ? {} : { assignedToId: session.userId }),
      ...(status ? { status } : {}),
      ...(propertyId ? { propertyId } : {}),
    },
    include: {
      property: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: 500, // bound the payload — no pagination yet
  });
  // Personel (temizlikçi) misafir adını / mesajını görmez: başlık + açıklama TEK kuraldan (`tasks/staff-view.ts`).
  // İç tekrar anahtarı (`dedupeKey`: akıllı görevin konu anahtarı / elle görevin istek kimliği) hiçbir görev yanıtına girmez (E2).
  return jsonOk(canManage(session) ? tasks.map(withoutDedupeKey) : tasks.map((t) => withoutDedupeKey(staffTaskProjection(t))));
});

export const POST = withManage(async (session, req) => {
  const data = await readJsonCappedOrNull(req);
  const parsed = taskSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
  const d = parsed.data;

  if (!(await propertyInOrg(d.propertyId, session.organizationId))) {
    return badRequest({ propertyId: "Geçersiz daire" });
  }

  if (d.assignedToId) {
    const member = await prisma.user.findFirst({
      where: { id: d.assignedToId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!member) return badRequest({ assignedToId: "Geçersiz personel" });
  }

  // The reservation must belong to the SAME org AND the same property — never
  // trust a client-supplied reservationId (cross-tenant reference otherwise).
  if (d.reservationId) {
    const reservation = await prisma.reservation.findFirst({
      where: {
        id: d.reservationId,
        propertyId: d.propertyId,
        property: { organizationId: session.organizationId },
      },
      select: { id: true },
    });
    if (!reservation) return badRequest({ reservationId: "Geçersiz rezervasyon" });
  }

  const taskData = {
    propertyId: d.propertyId,
    reservationId: d.reservationId || null,
    type: d.type,
    origin: "manual",
    title: d.title,
    description: d.description || null,
    assignedToId: d.assignedToId || null,
    dueAt: d.dueAt instanceof Date ? d.dueAt : null,
    status: d.status,
    priority: d.priority,
  };

  // Kimliksiz istek (eski sekme / API istemcisi): bugünkü gibi her seferinde yeni görev.
  if (!d.requestId) {
    const task = await prisma.task.create({ data: taskData });
    return jsonOk(withoutDedupeKey(task), 201);
  }

  // E2 (Codex 11-17): aynı istek kimliği → tek görev; cevabı kaybolmuş başarılı isteğin tekrarı ilk görevi alır (200). Arama işletme
  // kapsamında (anahtar işletme kimliğini taşır + mülk süzgeci): başka işletmenin aynı kimliği kendi görevini açar.
  const requestId = d.requestId;
  const outcome = await prisma.$transaction(
    (tx) =>
      findOrCreateManualTask(tx, {
        organizationId: session.organizationId,
        requestId,
        incoming: { propertyId: d.propertyId, type: d.type, title: d.title },
        find: (dedupeKey) => tx.task.findFirst({ where: { dedupeKey, property: { organizationId: session.organizationId } } }),
        create: (dedupeKey) => tx.task.create({ data: { ...taskData, dedupeKey } }),
      }),
    { maxWait: 15_000, timeout: 30_000 },
  );
  // Aynı kimlik, BAŞKA görev (daire / tür / başlık farklı): istemci hatası — var olan doğrulama yolu, görev açılmaz. Arayüz bu duruma
  // düşmez (form değişince kimlik yenilenir); yeni bir ev sahibi metni yazılmadı (öneri raporda).
  if (outcome.kind === "mismatch") return badRequest({ requestId: "Geçersiz istek" });
  return jsonOk(withoutDedupeKey(outcome.task), outcome.kind === "created" ? 201 : 200);
});
