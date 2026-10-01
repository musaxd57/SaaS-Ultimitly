import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { badRequest, hasJsonContentType, jsonOk, notFound, readJsonCappedOrNull, tooManyRequests, unsupportedMediaType } from "@/lib/api";
import { rateLimit, rateLimitClientKey } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { alertEmailVerifyEnabled, verifyAlertEmailToken } from "@/lib/alert-email-verify";
import { consumeAlertEmailGeneration } from "@/lib/alert-email-generation";

// ---------------------------------------------------------------------------
// UYARI ADRESİ ONAYI — halka açık uç (kurucu kararı 09-30; bayrak `ALERT_EMAIL_VERIFY_ENABLED`, varsayılan KAPALI → 404).
// Doğrulama e-postasındaki bağlantı `/uyari-adresi-dogrula#t=…` sayfasına gelir; sayfa açık bir "Onayla" tıklamasıyla buraya
// POST eder (e-posta tarayıcılarının bağlantıyı açması onay sayılmaz). Kimlik bilgisi belirtecin KENDİSİDİR: sunucunun imzası
// (HMAC, alan ayrımlı, 24 saat) + belirteçteki eski adres hâlâ kayıtlıysa (CAS) YALNIZ o işletmenin uyarı adresi değişir.
// Sıra: JSON kontrolü IP kovasından ÖNCE (#211 kuralı), sonra IP kovası, sonra belirteç. Sebep söylenmez (tek metin).
// ---------------------------------------------------------------------------

const INVALID = "Bu bağlantı geçersiz ya da süresi dolmuş. Ayarlardan yeniden doğrulama isteyebilirsiniz.";

export async function POST(req: NextRequest) {
  if (!alertEmailVerifyEnabled()) return notFound();
  if (!hasJsonContentType(req)) return unsupportedMediaType();
  const limited = await rateLimit(`alert-verify-ip:${rateLimitClientKey(req)}`, 20, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const body = await readJsonCappedOrNull<{ token?: unknown }>(req);
  const claim = verifyAlertEmailToken(body?.token);
  if (!claim) return badRequest({ _: INVALID });

  // Aynı bağlantı ikinci kez açıldı: adres zaten bu — başarı (idempotent; kuşak zaten tüketildi).
  const alreadyThis = async () =>
    (await prisma.organization.findUnique({ where: { id: claim.organizationId }, select: { alertEmail: true } }))?.alertEmail === claim.email;
  // KUŞAK (15 ajan A13 F2): bağlantı yalnız işletmenin GÜNCEL kuşağıyla geçer ve onu tüketir — sonraki istek ya da doğrudan adres
  // değişikliği eski bağlantıları geçersiz kılar; adres belirtecin "eski adresine" dönse de (dış alıcıyı kaldırıp boşaltmak) canlanmaz.
  if (!(await consumeAlertEmailGeneration(claim.organizationId, claim.generation))) {
    if (await alreadyThis()) return jsonOk({ ok: true });
    return NextResponse.json({ error: INVALID }, { status: 409 });
  }
  // CAS: arada adres değiştiyse (başka bir adres seçildi / temizlendi) eski bağlantı onu geri ALAMAZ.
  const changed = await prisma.organization.updateMany({
    where: { id: claim.organizationId, alertEmail: claim.previous },
    data: { alertEmail: claim.email },
  });
  if (changed.count === 0) {
    if (await alreadyThis()) return jsonOk({ ok: true });
    return NextResponse.json({ error: INVALID }, { status: 409 });
  }
  // Adres DEĞERİ kayda girmez (ayar denetim kuralı: yalnız olay). Onaylayan oturumsuz alıcıdır → aktör yok.
  await writeAudit({ organizationId: claim.organizationId, actorUserId: null, action: "settings.alert_email_verified" });
  return jsonOk({ ok: true });
}
