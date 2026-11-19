import { z } from "zod";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { KB_REQUEST_ID_RE, zodFieldErrors } from "@/lib/validators";
import { KB_IDEMPOTENCY_CONFLICT } from "@/lib/kb/request-id";
import { INTERNAL_NOTE_MAX_CHARS, INTERNAL_NOTE_PAGE_MAX, normalizeInternalNoteBody } from "@/lib/internal-notes/core";
import { createInternalNote, listInternalNotes, type InternalNoteView } from "@/lib/internal-notes/service";

// ---------------------------------------------------------------------------
// İÇ NOT — liste (GET) + ekle (POST). Dilim D1 (`docs/TASARIM-2026-11-18-gercek-konusma-ve-ic-not.md` §3.1). Yalnız sahip + yönetici
// (`withManage`; personel 403 — not misafir bilgisi taşıyabilir, Y1-a). Bürünme (destek görünümü) yazamaz: `withAuth`ın tek boğazı.
// Not MESAJ DEĞİLDİR: misafire hiçbir şey gitmez, konuşmanın sırası / durumu değişmez (kural ve gerekçe `lib/internal-notes/service.ts`).
// ---------------------------------------------------------------------------

/** Kimlik alanı (konuşma / konaklama / daire). Bağ yine sunucuda, işletme kapsamında çözülür; bu yalnız biçim. */
const idField = z.string().min(1).max(64);

const createSchema = z
  .strictObject({
    conversationId: idField.optional(),
    reservationId: idField.optional(),
    propertyId: idField.optional(),
    // Temizlik (baş / son boşluk, denetim karakterleri) ÖNCE, sınır SONRA — tek kural `internal-notes/core.ts`. Aşan metin kırpılmaz, reddedilir.
    body: z.string().transform(normalizeInternalNoteBody).pipe(z.string().min(1).max(INTERNAL_NOTE_MAX_CHARS)),
    // Tekrar güvenliği: "Kaydet" başına istemcinin ürettiği kimlik (biçim KB / söz / elle görev kimliğiyle aynı).
    requestId: z.string().regex(KB_REQUEST_ID_RE, "Geçersiz istek").optional(),
  })
  .refine((d) => Boolean(d.conversationId || d.reservationId || d.propertyId), { path: ["propertyId"], message: "Bu alan gerekli." });

/** Yanıt biçimi: zaman ISO; istek kimliği / yazan kişinin kimliği yok. */
function noteJson(n: InternalNoteView) {
  return { id: n.id, body: n.body, authorName: n.authorName, createdAt: n.createdAt.toISOString(), canDelete: n.canDelete };
}

export const GET = withManage(async (session, req) => {
  const sp = new URL(req.url).searchParams;
  const pick = (k: string) => {
    const v = sp.get(k);
    return v && v.length <= 64 ? v : null;
  };
  const target = { conversationId: pick("conversationId"), reservationId: pick("reservationId"), propertyId: pick("propertyId") };
  if (!target.conversationId && !target.reservationId && !target.propertyId) return badRequest({ propertyId: "Bu alan gerekli." });
  const rawLimit = Number(sp.get("limit") ?? INTERNAL_NOTE_PAGE_MAX);
  const result = await listInternalNotes({
    organizationId: session.organizationId,
    viewer: { userId: session.userId, role: session.role },
    target,
    limit: Number.isFinite(rawLimit) ? rawLimit : INTERNAL_NOTE_PAGE_MAX,
    cursor: pick("cursor"),
  });
  if (result.kind === "not_found") return notFound();
  return jsonOk({ notes: result.notes.map(noteJson), nextCursor: result.nextCursor });
});

export const POST = withManage(async (session, req) => {
  // Kişi başına dakikada 20 not (anahtar işletme + kişi: başka işletmenin isteği bu kovayı tüketemez). Ucuz kova veritabanından ÖNCE.
  const limited = await rateLimit(`internal-note:${session.organizationId}:${session.userId}`, 20, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const parsed = createSchema.safeParse(await readJsonCappedOrNull(req));
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const result = await createInternalNote({
    organizationId: session.organizationId,
    viewer: { userId: session.userId, role: session.role },
    sessionName: session.name,
    target: { conversationId: d.conversationId, reservationId: d.reservationId, propertyId: d.propertyId },
    body: d.body,
    clientRequestId: d.requestId ?? null,
  });
  if (result.kind === "not_found") return notFound();
  // Şema aynı kuraldan geçirdi; buraya düşmek iki kuralın ayrıştığı demektir — var olan genel metin.
  if (result.kind === "invalid") return badRequest({ body: "Geçersiz değer." });
  // Aynı istek kimliği BAŞKA bir notla: eski not sessizce dönmez (kurucu 10-15 kalıbı), yeni not da yazılmaz. Arayüz metin değişince kimliği
  // yeniler; bu yola pratikte düşmez. Yeni metin yazılmadı — var olan genel "Kaydedilemedi" metni.
  if (result.kind === "conflict") {
    return Response.json({ error: "Kaydedilemedi. Lütfen tekrar deneyin.", code: KB_IDEMPOTENCY_CONFLICT }, { status: 409 });
  }
  return jsonOk({ note: noteJson(result.note), reused: result.kind === "replayed" }, result.kind === "created" ? 201 : 200);
});
