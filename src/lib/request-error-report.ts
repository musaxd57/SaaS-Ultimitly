import "server-only";

import { errorWithContext } from "./redact";
import { reportError } from "./report-error";

// ─────────────────────────────────────────────────────────────────────────────
// YAKALANMAYAN İSTEK HATASI → RAPOR (G11, kurucu kararı 10-13 "Raporlansın"; ACIK-ISLER 08-08 §15)
//
// Rotaların çoğu hatayı kendisi yakalar ve `serverError(err)` → `reportError` ile raporlar. Yakalamayan rotalar ve panel sayfalarının
// sunucu çiziminde fırlayan hata ise yalnız sunucu günlüğüne düşüyordu (Sentry'ye / uyarı e-postasına gitmiyordu). Next'in tek kancası
// `onRequestError` (src/instrumentation.ts) bu modülü YALNIZ Node çalışma zamanında, dinamik import'la çağırır — bu modül Prisma /
// nodemailer taşır, edge paketine girmemelidir (önceki deneme derlemeyi o yüzden kırmıştı).
//
// Kurallar:
//  · YANIT DEĞİŞMEZ — bu yalnız rapordur; kanca ne döndürürse döndürsün Next yanıtı kendisi üretir.
//  · Gerçek yol (`request.path`: belirteç, kimlik, sorgu dizgisi) YAZILMAZ — yalnız Next'in rota ŞABLONU (`/api/calendar/[token]`).
//  · Akış kontrolü "hata" değildir: yönlendirme / bulunamadı / dinamik kullanım / istemci tarafı çizime düşme / istemcinin bağlantıyı
//    kesmesi raporlanmaz (Next de bunları kendi günlüğünde hata saymaz).
//  · Uyarı e-postası kısıtlaması AYNEN: bağlam TEK kovadır (`uncaught-request`), yani bir dağıtım bütün sayfaları bozsa bile en çok
//    10 dakikada bir e-posta (09-23 alarm seli dersi). Rota ayrımı iletide → Sentry rota başına gruplar.
//  · Asla fırlatmaz (Next kancadaki hatayı yalnız günlüğe yazar, ama yine de ikinci bir gürültü üretmeyelim).
// ─────────────────────────────────────────────────────────────────────────────

/** Tek uyarı kovası — bütün yakalanmayan istek hataları aynı e-posta kısıtlamasını paylaşır. */
export const UNCAUGHT_REQUEST_CONTEXT = "uncaught-request";

/** Next'in kancaya verdiği istek özeti (yalnız kullandığımız alanlar). `path` bilerek OKUNMAZ. */
export type RequestErrorRequest = { method?: unknown };
/** Next'in kancaya verdiği bağlam (yalnız kullandığımız alanlar). */
export type RequestErrorContext = { routePath?: unknown; routeType?: unknown; renderSource?: unknown };

// Next'in akış kontrolü için fırlattığı işaretler (digest). "NEXT_" ailesi: NEXT_REDIRECT;…, NEXT_NOT_FOUND,
// NEXT_HTTP_ERROR_FALLBACK;404, NEXT_PRERENDER_INTERRUPTED …
// HANGING_PROMISE_REJECTION: önbellekli bileşenlerin bilinçli olarak bekletilen sözü (Haiku incelemesi 10-13; bugün `cacheComponents` kapalı).
const FLOW_CONTROL_DIGESTS = new Set(["DYNAMIC_SERVER_USAGE", "BAILOUT_TO_CLIENT_SIDE_RENDERING", "HANGING_PROMISE_REJECTION"]);
// İstemcinin bağlantıyı kesmesi (sekmeyi kapattı, gezinti iptal) — sunucu arızası değil.
const ABORT_NAMES = new Set(["AbortError", "ResponseAborted"]);

/** Bu hata raporlanmalı mı? Akış kontrolü ve istemci iptali HAYIR; geri kalan her şey EVET (şüphede raporla). */
export function shouldReportRequestError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const digest = (err as { digest?: unknown }).digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_") || FLOW_CONTROL_DIGESTS.has(digest))) return false;
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string" && ABORT_NAMES.has(name)) return false;
  }
  return true;
}

// Rota şablonu Next'ten gelir ama yine de dar bir alfabeye sıkıştırılır: beklenmeyen biçim → "?" (gerçek değer sızmasın).
const ROUTE_TEMPLATE = /^\/[A-Za-z0-9_\-[\].()@/]{0,160}$/;
const METHOD = /^[A-Z]{3,7}$/;
const LABEL = /^[a-z-]{1,40}$/;

/** "POST /api/guest-chats/[id]/reply · route" — yalnız şablon, yöntem ve tür; değişken parça yok. */
export function requestErrorLabel(request: RequestErrorRequest | undefined, context: RequestErrorContext | undefined): string {
  const method = typeof request?.method === "string" && METHOD.test(request.method) ? request.method : "?";
  const route = typeof context?.routePath === "string" && ROUTE_TEMPLATE.test(context.routePath) ? context.routePath : "?";
  const kind = [context?.routeType, context?.renderSource]
    .filter((v): v is string => typeof v === "string" && LABEL.test(v))
    .join("/");
  return `${method} ${route}${kind ? ` · ${kind}` : ""}`;
}

/** Kancanın gövdesi. Asla fırlatmaz. */
export async function reportUncaughtRequestError(
  err: unknown,
  request: RequestErrorRequest | undefined,
  context: RequestErrorContext | undefined,
): Promise<void> {
  try {
    if (!shouldReportRequestError(err)) return;
    // İleti `formatErrorForLog` üzerinden kurulur (Prisma hatası yalnız yapısal özet, merkezî redaksiyon); yığın çerçeveleri özgün
    // hatadan taşınır ki Sentry'de hata yeri görünsün (ilk satır iletiyi tekrarlar, yazılmaz).
    const wrapped = errorWithContext(err, ` [${requestErrorLabel(request, context)}]`);
    if (err instanceof Error && err.stack) {
      const frames = err.stack.split("\n").filter((l) => /^\s+at /.test(l)).slice(0, 15);
      wrapped.stack = [`${wrapped.name}: ${wrapped.message}`, ...frames].join("\n");
    }
    await reportError(UNCAUGHT_REQUEST_CONTEXT, wrapped);
  } catch {
    // Raporlama asla ikinci bir hata üretmez.
  }
}
