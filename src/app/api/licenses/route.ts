import { badRequest, forbidden, hasJsonContentType, jsonOk, notFound, readJsonCappedOrNull, tooManyRequests, unsupportedMediaType } from "@/lib/api";
import { withOwner } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { licensesEnabled } from "@/lib/licenses/secret";
import { licensePlanAllowed, listOrgLicenses } from "@/lib/licenses/read";
import { createLicenseApplication, type CreateApplicationError } from "@/lib/licenses/write";
import { LICENSE_TEXT } from "@/lib/licenses/messages";

// ---------------------------------------------------------------------------
// BELGELERİM (Faz 1a; tasarım docs/TASARIM-2026-11-06-isletme-belgesi-dogrulama-ve-yetki.md). YALNIZ işletme sahibi (belge yönetimi
// hukuki yük taşır); yazma ayrıca iki aşamalı doğrulamalı oturum + Pro / Business paketi ister. Anahtar kapalıysa uç YOK (404).
// 🚨 Başvuru sonucu dışarıya TEK genel cümle: "bu belge / şirket başka hesapta" asla söylenmez (kiracılar arası yoklama — tasarım §3.3).
// ---------------------------------------------------------------------------

const FIELD_ERRORS: Partial<Record<CreateApplicationError, Record<string, string>>> = {
  invalid_type: { type: "Belge türünü seçin." },
  invalid_holder: { holderKind: "Şirket ya da şahıs işletmesi seçin." },
  invalid_number: { number: LICENSE_TEXT.invalidNumber },
  invalid_name: { legalName: LICENSE_TEXT.invalidName },
  invalid_tax_id: { taxId: LICENSE_TEXT.invalidTaxId },
  invalid_attributes: { attributes: "Belge bilgilerini kontrol edin." },
  invalid_units: { propertyIds: LICENSE_TEXT.invalidUnits },
};

export const GET = withOwner(async (session) => {
  if (!licensesEnabled()) return notFound();
  const [planAllowed, licenses] = await Promise.all([licensePlanAllowed(session.organizationId), listOrgLicenses(session.organizationId)]);
  return jsonOk({ planAllowed, twoFactor: session.mfa === true, licenses });
});

export const POST = withOwner(async (session, req) => {
  if (!licensesEnabled()) return notFound();
  if (!hasJsonContentType(req)) return unsupportedMediaType();
  if (session.mfa !== true) return forbidden(LICENSE_TEXT.twoFactorRequired);
  if (!(await licensePlanAllowed(session.organizationId))) return forbidden(LICENSE_TEXT.planRequired);
  const limited = await rateLimit(`license-apply:${session.organizationId}`, 10, 24 * 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  const body = (await readJsonCappedOrNull(req)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest({ body: "Belge bilgilerini kontrol edin." });
  const holder = body.holder && typeof body.holder === "object" && !Array.isArray(body.holder) ? (body.holder as Record<string, unknown>) : {};
  const res = await createLicenseApplication({
    organizationId: session.organizationId,
    userId: session.userId,
    type: body.type,
    number: body.number,
    attributes: body.attributes,
    holder: { kind: holder.kind, legalName: holder.legalName, taxId: holder.taxId },
    propertyIds: body.propertyIds,
  });
  if (res.ok) return jsonOk({ ok: true, message: LICENSE_TEXT.applicationReceived });
  if (res.reason === "disabled") return notFound();
  if (res.reason === "too_many_open") return jsonOk({ error: LICENSE_TEXT.tooManyOpen }, 409);
  // Kendi hesabındaki aynı belge — başka hesap hakkında bilgi vermez.
  if (res.reason === "duplicate") return jsonOk({ error: "Bu belge için zaten bir kaydınız var." }, 409);
  return badRequest(FIELD_ERRORS[res.reason] ?? { body: "Belge bilgilerini kontrol edin." });
});
