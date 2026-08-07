import { prisma } from "@/lib/db";
import { badRequest, jsonOk, tooManyRequests, readJsonCappedOrNull } from "@/lib/api";
import { withOwner } from "@/lib/route-guard";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { LEGAL_VERSION } from "@/lib/legal-entity";
import { LEGAL_TEXT_HASH } from "@/lib/legal-text-hash";
import { paddlePriceToPlanCode, paddlePriceCatalogConfigured } from "@/lib/payments/paddle";
import { checkoutConsentSchema, zodFieldErrors } from "@/lib/validators";

// Server-side record of the Ön Bilgilendirme + Mesafeli Satış acceptance at
// CHECKOUT — the evidence counterpart to the client checkbox in paddle-plans.tsx.
// The client calls this right before Paddle's overlay opens. organizationId and
// userId come from the SESSION (never the request body) → IDOR-proof; legal
// version, IP (rightmost XFF) and User-Agent are server-derived so they can't be
// forged. One row per acceptance (a user may go through checkout more than once).
// Contract/payment authority: OWNER only (billing is an account-owner concern and
// the UI shows checkout to owners only — the API matches so a manager can't record
// a distance-sales consent / drive a purchase for the org via a direct call).
export const POST = withOwner(async (session, req) => {
  // Light per-user cap so a script can't bloat the table; generous for real use
  // (no human opens checkout 20×/hour). Best-effort on the client, so a 429 here
  // never blocks the purchase — earlier accepted records already stand.
  const limited = await rateLimit(`checkout-consent:${session.userId}`, 20, 60 * 60 * 1000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const data = await readJsonCappedOrNull(req);
  const parsed = checkoutConsentSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

  // Cross-check the plan LABEL against the price id server-side: the priceId is
  // what actually drives the Paddle charge, so it is authoritative. When the
  // price→plan map is configured and the client-supplied planCode disagrees, a
  // tampered/buggy client is trying to record inconsistent consent evidence —
  // refuse (fail-closed) so we never store "agreed to Pro" against a Business
  // price. When the map is unconfigured (derived === null) we can't cross-check,
  // so the validated client value stands. Store the derived code when available.
  const derivedPlanCode = paddlePriceToPlanCode(parsed.data.priceId);
  if (derivedPlanCode && derivedPlanCode !== parsed.data.planCode) {
    return badRequest({ planCode: "Plan fiyatı doğrulanamadı. Lütfen sayfayı yenileyip tekrar deneyin." });
  }
  // 🚨 KATALOG DIŞI FİYAT REDDEDİLİR — GEVŞETME.
  // Yukarıdaki çapraz-kontrol YALNIZ harita bir değer döndürünce çalışıyordu;
  // haritada OLMAYAN bir `priceId` sessizce geçiyordu ve zincirin sonunda
  // webhook `planCode`'a hiç dokunmadan yalnız `status:"active"` yazıyordu.
  // Kayıt her org'a `planCode:"pro"` trial satırı açtığı için sonuç şuydu:
  // katalog dışı bir fiyatı ödeyen org KALICI "pro" yetkisi ve Pro limitleri
  // alıyordu. Şema `priceId` için yalnız `z.string().max(128)` diyor, yani
  // değer tamamen istemci kontrolünde. Ürünün kataloğu ÜÇ kalem; dördüncü bir
  // fiyatla checkout açmak tanımı gereği tutarsızlıktır.
  // ⚠️ Kural yalnız katalog YAPILANDIRILMIŞKEN uygulanır — env'siz yerel
  // geliştirmede her fiyat "bilinmeyen" olurdu ve akış komple kilitlenirdi.
  if (!derivedPlanCode && paddlePriceCatalogConfigured()) {
    return badRequest({ planCode: "Plan fiyatı doğrulanamadı. Lütfen sayfayı yenileyip tekrar deneyin." });
  }

  // ⚠️ CANLI ABONELİĞİ OLAN ORG YENİ CHECKOUT AÇAMAZ (denetim, 08-01).
  //
  // Bu kapı UI'da VARDI (`settings/page.tsx` → `canManagePaddleSub` kartları
  // kilitler) ama sunucuda YOKTU: doğrudan bir POST ya da eski bir sekme, aynı
  // işletme için İKİNCİ bir Paddle aboneliği başlatabiliyordu. `Subscription`
  // org başına TEK satır (`organizationId @unique`) olduğu için ikinci abonelik
  // webhook'ta birincinin `providerRef`'ini EZER: ilk abonelik Paddle'da
  // faturalanmaya devam eder ama bizde görünmez olur.
  //
  // Predikat UI ile BİREBİR AYNI (canlı = paddle + providerRef var + iptal
  // DEĞİL) → yeni bir bloklama yüzeyi açmaz, yalnız istemciye güvenmeyi bırakır.
  // İptal edilmiş abonelik yeni checkout açabilir (mevcut ürün kararı).
  const live = await prisma.subscription.findUnique({
    where: { organizationId: session.organizationId },
    select: { provider: true, providerRef: true, status: true },
  });
  if (live?.provider === "paddle" && live.providerRef && live.status !== "canceled") {
    return badRequest({
      _: "Bu işletmenin zaten aktif bir aboneliği var. Plan değiştirmek için Faturalandırma bölümünü kullanın.",
    });
  }

  const row = await prisma.checkoutConsent.create({
    data: {
      organizationId: session.organizationId, // from session → can't record for another org
      userId: session.userId,
      planCode: derivedPlanCode ?? parsed.data.planCode, // price-derived is authoritative
      priceId: parsed.data.priceId,
      legalVersion: LEGAL_VERSION, // server-side, not client-supplied
      legalTextHash: LEGAL_TEXT_HASH, // tamper-evident companion (see lib/legal-text-hash.ts)
      // Ödeme onayının delil kaydı. clientIp() zinciri SAĞDAN sayar (taklit
      // edilemez) ama kaç adım geri gideceğini `TRUSTED_PROXY_HOPS` söyler:
      // Railway'de doğru değer 2, varsayılan 1. Bayrak set edilene kadar buraya
      // müşterinin adresi DEĞİL Railway edge'inin adresi yazılır — yani bu tarihe
      // kadarki satırlar delil olarak kişiyi işaret etmez (bilinen sınır; geçmiş
      // satırlar bilerek DÜZELTİLMEZ, delil kaydı sonradan yeniden yazılmaz).
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent")?.slice(0, 512) ?? null, // capped free text
    },
    select: { id: true },
  });
  // Return the row id as a server-trusted nonce: the client passes it in the Paddle
  // checkout's custom_data, and the webhook resolves the org FROM this row (whose
  // organizationId is session-derived) instead of trusting a client-sent org id.
  return jsonOk({ ok: true, consentId: row.id }, 201);
});
