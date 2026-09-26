import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, jsonOk, serverError, readJsonCappedOrNull } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { writeAudit } from "@/lib/audit";
import { normalizeEmail } from "@/lib/email-identity";

// ---------------------------------------------------------------------------
// Operator panel: RESET a locked-out customer's 2FA. SUPER-ADMIN ONLY.
//
// The lost-phone escape hatch. Self-service recovery is the recovery-code
// login; when the customer has neither phone nor codes they are hard-locked,
// and the operator — after verifying identity out-of-band (phone call, known
// contact) — clears the second factor so they can sign in with password only
// and re-enable 2FA from a trusted device.
//
// Safety properties:
//   * superadmin-only + full audit trail (actor, target, org).
//   * sessionEpoch bump: every existing session for the account dies at the
//     same moment the factor is removed — a hijacked session can't ride the
//     downgraded account.
//   * recovery codes are wiped with the secret (they belong to the old factor).
//
// İKİNCİ İŞ — BAYAT KAYIT TEMİZLİĞİ (08-02):
// `twoFactorSecret` DOLU ama `twoFactorEnabledAt` NULL olabilir. Bu "2FA açık"
// DEMEK DEĞİLDİR: aktifliğin tek koşulu `twoFactorEnabledAt`tir (login/route.ts,
// account/2fa/route.ts, settings/page.tsx hepsi ona bakar). Böyle bir satır
// `setup` çağrılıp kurulum yarıda bırakıldığında doğar — secret yazılır,
// `twoFactorEnabledAt: null` kalır.
//
// Bu rota eskiden öyle bir satırı REDDEDİYORDU ("zaten kapalı") → artığı
// temizlemenin ÜRÜN YOLU YOKTU, geriye elle SQL kalıyordu. Artık iki durumu da
// karşılıyor ve hangisini yaptığını çağırana SÖYLÜYOR.
//
// 🚨 BAYAT TEMİZLİKTE `sessionEpoch` ARTTIRILMAZ. Artış "canlı bir faktörü
// kaldırdım, o faktörle açılmış oturumlar ölsün" demektir. Bayat secret hiçbir
// şeyi yetkilendirmiyor, hiçbir oturum ona dayanmıyor → müşteriyi oturumundan
// atmak KARŞILIĞI OLMAYAN bir kesinti olurdu. Aktif sıfırlamada artış AYNEN
// KALIR (test-pinli).
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();

  try {
    const data = await readJsonCappedOrNull(req);
    const email = typeof data?.email === "string" ? normalizeEmail(data.email) : "";
    if (!email) return badRequest({ email: "Kullanıcının e-posta adresi gerekli." });

    // AYNI HAKEM: giriş/kayıt/şifre-sıfırlama yollarıyla birebir aynı arama.
    // Eskiden burası `mode:"insensitive"` ile findFirst yapıyordu — tek başına
    // zararsızdı ama e-postası yalnız BÜYÜK/küçük harfte ayrışan iki satır (elle
    // SQL/import ile doğabilir) varsa findFirst hangisini bulacağını garanti
    // etmez ve operatör YANLIŞ hesabın 2FA'sını sıfırlayabilirdi. Kimlik kararı
    // veren her yol artık tek biçimde: normalize et + benzersiz kolonda exact ara.
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        organizationId: true,
        twoFactorEnabledAt: true,
        twoFactorSecret: true,
      },
    });
    if (!user) return badRequest({ email: "Bu e-posta ile bir kullanıcı bulunamadı." });

    const active = user.twoFactorEnabledAt !== null;
    // ⚠️ `twoFactorSecret`in kendisi ASLA okunmaz/döndürülmez — yalnız VARLIĞI
    // sorulur. Şifreli değer bu rotanın hiçbir çıktısına giremez.
    const hasStaleSecret = !active && user.twoFactorSecret !== null;

    if (!active && !hasStaleSecret) {
      return badRequest({ email: "Bu hesapta 2FA zaten kapalı — temizlenecek bir şey yok." });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorSecret: null,
          twoFactorEnabledAt: null,
          twoFactorLastStep: null,
          // Yalnız CANLI bir faktör kaldırılırken oturumlar düşürülür (↑gerekçe).
          ...(active ? { sessionEpoch: { increment: 1 } } : {}),
        },
      }),
      // Bayat dalda da çalışır: `twoFactorEnabledAt` NULL iken kurtarma kodu
      // ZATEN kullanılamaz (login o dala hiç girmez), yani bu satırlar ölü
      // ağırlıktır. Silmek durumu sadeleştirir, hiçbir yeteneği kaldırmaz.
      prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } }),
    ]);

    await writeAudit({
      organizationId: user.organizationId,
      actorUserId: session.actorUserId ?? session.userId,
      // İki işlem AYRI eylem adı taşır: denetim kaydına bakan biri "müşterinin
      // canlı 2FA'sı kaldırıldı" ile "yarım kalmış kurulum artığı silindi"yi
      // ayırt edebilmeli — güvenlik açısından bambaşka ağırlıktalar.
      action: active ? "admin.2fa_reset" : "admin.2fa_stale_secret_cleared",
      metadata: { targetUserId: user.id, targetEmail: user.email },
    });

    // Çağıran hangi işlemin olduğunu BİLMELİ: arayüz "tüm oturumları düşürüldü"
    // metnini bayat temizlikte basarsa operatöre YALAN söylemiş olur.
    return jsonOk({ ok: true, outcome: active ? "reset" : "stale_cleared" });
  } catch (err) {
    return serverError(undefined, err);
  }
}
