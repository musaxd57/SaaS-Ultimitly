import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { reauthBlocked, noteReauthFailure, REAUTH_CAP_MESSAGE } from "@/lib/auth/reauth-guard";
import { clearSessionCookie } from "@/lib/auth";
import {
  requireSession,
  unauthorized,
  badRequest,
  forbidden,
  jsonOk,
  serverError,
  tooManyRequests, readJsonCappedOrNull } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { deleteAccountData } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// PERMANENT account + data erasure (KVKK right-to-erasure / "hesabımı sil").
// The signed-in OWNER deletes their whole organization and everything under it.
// Guarded: owner-only, re-authenticated with the account password, rate-limited,
// and BLOCKED while an operator is impersonating (no nuking a customer's org
// through an impersonation session). Irreversible.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (session.actorUserId) return forbidden("İşletme hesabındayken (impersonation) silme yapılamaz.");
  if (session.role !== "owner") return forbidden("Hesabı yalnızca sahip rolü silebilir.");

  const limited = await rateLimit(`account-delete:${session.userId}`, 5, 15 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  // 🚨 GÜNLÜK ORTAK HATA TAVANI (09-23 saldırgan turu): kısa kova tek başına günde 480 şifre
  // tahmini bırakıyordu ve doğru tahmin HESABI SİLİYOR. Sayaç 2FA ekranlarıyla ortak
  // (`reauth-guard.ts`); tavan dolunca doğru şifre de o gün reddedilir.
  const day = await reauthBlocked(session.userId);
  if (!day.ok) return tooManyRequests(day.retryAfter, REAUTH_CAP_MESSAGE);

  try {
    const data = await readJsonCappedOrNull(req);
    const password = typeof data?.password === "string" ? data.password : "";
    if (!password) return badRequest({ password: "Onaylamak için şifrenizi girin." });

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true },
    });
    const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
    if (!ok) {
      await noteReauthFailure(session.userId);
      return badRequest({ password: "Şifre hatalı." });
    }

    // 🚨 ÖDEME ABONELİĞİ KAPISI — FAIL-CLOSED (Codex denetimi, 08-01 — madde 2).
    //
    // Silme yolu Paddle'a HİÇBİR iptal çağrısı YAPMAZ (`deleteAccountData` yalnız
    // webhook redaksiyonu + org silme yapar). Silmeye izin vermek, ödeyen host'un
    // kartından çekilmeye DEVAM edilmesi ve iptalin tek yolu olan "Aboneliği
    // yönet" düğmesinin artık giremediği hesabın içinde kalması demekti — müşteri
    // kendi kendine duramıyordu.
    //
    // Otomatik iptal para hot-path'i + ürün kararıdır → YAPILMAZ. Doğru davranış
    // engellemek ve önce iptali istemektir.
    //
    // ⚠️ FAIL-CLOSED İKİ YÖNDE:
    //   · Sağlayıcıya bağlı (gerçek tahsilat üretebilen) bir abonelik satırı varsa
    //     ve durumu KESİN olarak bitmiş değilse → ENGELLE. Tanınmayan/yeni bir
    //     sağlayıcı durumu da "belirsiz" sayılır ve engellenir (allowlist mantığı:
    //     yalnız KESİN bitmiş durumlar geçer, blocklist değil).
    //   · Yerel durumu OKUYAMAZSAK (DB hatası) → yine ENGELLE. Belirsizlikte
    //     geri alınamaz bir silme yapılmaz.
    const blocked = await hasBillableSubscription(session.organizationId);
    if (blocked) {
      return NextResponse.json(
        {
          error:
            "Aktif bir ödeme aboneliğiniz görünüyor. Hesabı silmek aboneliği DURDURMAZ — " +
            "önce Faturalandırma → “Aboneliği yönet” bölümünden iptal edin, sonra tekrar deneyin.",
        },
        { status: 409 },
      );
    }

    await deleteAccountData(session.organizationId);
    await clearSessionCookie(); // the account is gone — drop the session too
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError(undefined, err);
  }
}

/**
 * Bu org'un GERÇEK TAHSİLAT üretebilecek bir aboneliği var mı?
 *
 * Sağlayıcı bazlı: yalnız dış bir ödeme sağlayıcısına bağlı satırlar tahsilat
 * üretir. `trial`/`manual` satırlar iç kayıttır — onları engellemek müşteriyi
 * sebepsiz kilitlerdi.
 *
 * ⚠️ ALLOWLIST, BLOCKLIST DEĞİL: yalnız KESİN olarak bitmiş sayılan durumlar
 * geçer. Sağlayıcı yarın yeni bir durum adı eklerse (ör. "paused") kod onu
 * "bilmiyorum" sayar ve ENGELLER — geri alınamaz bir silmede doğru yön budur.
 * ⚠️ Okuma hatasında da ENGELLER (fail-closed).
 */
async function hasBillableSubscription(organizationId: string): Promise<boolean> {
  /** Tahsilat üretebilen sağlayıcılar (iç kayıtlar hariç). */
  const BILLING_PROVIDERS = ["paddle", "iyzico", "paytr"];
  /** KESİN bitmiş: bu durumlarda sağlayıcı bir daha çekim yapmaz. */
  const DEFINITELY_ENDED = new Set(["canceled", "cancelled", "expired"]);
  try {
    const subs = await prisma.subscription.findMany({
      where: { organizationId, provider: { in: BILLING_PROVIDERS } },
      select: { status: true, cancelAtPeriodEnd: true },
    });
    // ⚠️ `cancelAtPeriodEnd` DA "bitmiş" sayılır (bağımsız denetim, 08-01).
    // Paddle portalından yapılan iptal DÖNEM SONUNA planlanır: webhook bunu
    // `cancelAtPeriodEnd: true` olarak yazar ama `status` "active" KALIR. Bunu
    // görmezsek ZATEN İPTAL ETMİŞ müşteri 409 alır ve mesaj ona yaptığı şeyi
    // TEKRAR yapmasını söyler — yıllık planda ~12 ay sürebilecek çıkışsız bir
    // döngü. O hâlde sağlayıcı yeni tahsilat YAPMAZ, yani engellemenin gerekçesi
    // ortadan kalkar. (Alan üç yerde yazılıyordu ama hiçbir yerde okunmuyordu.)
    return subs.some((s) => !DEFINITELY_ENDED.has(s.status) && !s.cancelAtPeriodEnd);
  } catch {
    return true; // durumu okuyamıyoruz → geri alınamaz silme YAPILMAZ
  }
}
