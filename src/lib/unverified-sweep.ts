import { prisma } from "@/lib/db";
import { EMAIL_VERIFY_REQUIRED_FROM } from "@/lib/auth/email-verify";
import { isFounderOrg } from "@/lib/billing/subscription";
import { deleteAccountData } from "@/lib/data-retention";

// ---------------------------------------------------------------------------
// TERK EDİLMİŞ DOĞRULANMAMIŞ KAYITLARIN SÜPÜRÜLMESİ
//
// Hesap ön-ele-geçirme düzeltmesinin (08-06) TAMAMLAYICISI, alternatifi değil.
// Doğrulama artık parola istediği için saldırgan kurbanın adresiyle açtığı hesaba
// GİREMİYOR — ama hesap orada duruyor ve `User.email` benzersiz olduğu için
// KURBAN DA kendi adresiyle kaydolamıyor: `register` ona enumeration koruması
// gereği sessiz 201 döner (bilerek: o koruma geri alınmamalı). Yani adres
// KALICI OLARAK İŞGAL EDİLMİŞ kalıyor. Bu süpürge o işgali sonlandırır.
//
// 🚨 YIKICI VE GERİ ALINAMAZ → `UNVERIFIED_SWEEP_ENABLED` DEFAULT KAPALI
// (`guestErasureEnabled` emsali). Bayrak kapalıyken fonksiyon hiçbir sorgu bile
// çalıştırmaz.
//
// 🚨 EN KRİTİK KOŞUL: `createdAt >= EMAIL_VERIFY_REQUIRED_FROM`.
// `needsEmailVerification` cutoff'tan ÖNCEKİ hesapları TARİH kontrolüyle muaf
// tutuyor — `emailVerifiedAt` dolu olduğu için DEĞİL. Yani kurucunun, personelin
// ve cutoff öncesi her müşterinin `emailVerifiedAt` alanı NULL olabilir ve bu
// tamamen meşrudur. Bu satır olmadan sorgu, korumanın TAM TÜMLEYENİNİ seçer ve
// ilk koşuşunda kurucunun hesabını siler. (Bu tam olarak dışarıdan önerilen bir
// taslakta vardı; buraya ders olarak yazıldı.)
// ---------------------------------------------------------------------------

export function unverifiedSweepEnabled(): boolean {
  return process.env.UNVERIFIED_SWEEP_ENABLED === "1";
}

/** Sayar ama SİLMEZ. Bayrağı açmadan önce "kaç org ve hangi gerekçelerle"
 *  sorusunu canlıda güvenle sormanın yolu (operatör backfill scriptlerindeki
 *  dry-run-önce deseninin sürekli-iş karşılığı). */
export function unverifiedSweepDryRun(): boolean {
  return process.env.UNVERIFIED_SWEEP_DRY_RUN === "1";
}

/** Ödeme sağlayıcısına DOKUNMUŞ abonelikler — `account/delete/route.ts`'teki
 *  `hasBillableSubscription` kapısının allowlist'i BİREBİR. ⚠️ O kapı ROTADA
 *  duruyor, `deleteAccountData`'nın İÇİNDE değil; süpürge fonksiyonu doğrudan
 *  çağırdığı için kontrolü KENDİSİ tekrar etmek ZORUNDA. */
const BILLING_PROVIDERS = ["paddle", "iyzico", "paytr"];

/** Kaç gün sonra terk edilmiş sayılır. 7 gün: bir hafta içinde e-postasını hiç
 *  açmayan kayıt pratikte "soğuk"tur; daha kısası (24s/3g) hafta sonuna ya da
 *  spam klasörüne denk gelen MEŞRU kullanıcıyı kaybettirir, daha uzunu adresin
 *  işgal süresini gereksiz uzatır. */
export const UNVERIFIED_MAX_AGE_DAYS = 7;

/** Koşu başına tavan (`RETENTION_BATCH` emsali): tek bir geçiş DB'yi ve silme
 *  yolunu boğmasın. Artakalanlar bir sonraki deep pencerede toplanır — süpürge
 *  idempotent olduğu için bölmek davranışı değiştirmez.
 *
 *  🚨 SAYI BİLİNÇLİ KÜÇÜK: `deleteAccountData` her org için `WebhookEvent`
 *  üzerinde İKİ adet indekslenemez `LIKE '%…%'` taraması yapıyor
 *  (`data-retention.ts` redaksiyon pass'leri) ve o tablo hiçbir yerde
 *  budanmıyor. N org = 2N tam tablo taraması ve hepsi 180 sn'lik TEK bir
 *  transaction'ın içinde → büyük parti P2028 (TX timeout) ile TÜM silmeyi geri
 *  sardırır. Küçük parti + tekrar eden pencere doğru takas. */
const SWEEP_BATCH = 25;

export type UnverifiedSweepResult = {
  /** Yaş + cutoff filtresinden geçen aday sayısı. */
  scanned: number;
  /** Gerçekten silinen org sayısı. */
  deleted: number;
  /** Aday olup korumalardan biri yüzünden ATLANAN sayısı (↓`skippedReasons`). */
  skipped: number;
  /** Hangi korumanın kaç kez devreye girdiği — teşhis için, PII taşımaz. */
  skippedReasons: Record<string, number>;
  /** Silme sırasında hata alan org sayısı; koşu devam eder. */
  failed: number;
};

const EMPTY: UnverifiedSweepResult = {
  scanned: 0,
  deleted: 0,
  skipped: 0,
  skippedReasons: {},
  failed: 0,
};

/**
 * Hiç doğrulanmamış, `UNVERIFIED_MAX_AGE_DAYS` günden eski ve GERÇEKTEN terk
 * edilmiş kayıt org'larını siler.
 *
 * ⚠️ Silme birimi ORG'dur, User değil: kayıt org+user+subscription üçlüsünü tek
 * transaction'da yaratıyor, dolayısıyla yalnız `User` satırını silmek ÖKSÜZ bir
 * organizasyon ve sahipsiz bir trial aboneliği geride bırakırdı. Ham `deleteMany`
 * yerine `deleteAccountData` kullanılır (KVKK yolunun kendisi).
 *
 * ⚠️ Denetim izi: `AuditLog.organizationId` ZORUNLU ve `onDelete: Cascade` →
 * org silinince o org'un denetim satırları da gider ve org'a bağlı OLMAYAN bir
 * denetim kaydı yazmak ŞEMA GEREĞİ mümkün değil. Bu yüzden "şu adres serbest
 * bırakıldı" kaydı AuditLog'da TUTULAMAZ; sonuç yalnız sayaç olarak raporlanır.
 * (Hesap silmenin denetim/fatura izini götürmesi zaten bilinen ve belgelenmiş
 * bir açık madde — `docs/MIGRATION-BEKLEYEN-ISLER.md`.)
 */
export async function sweepUnverifiedRegistrations(
  now: Date = new Date(),
): Promise<UnverifiedSweepResult> {
  if (!unverifiedSweepEnabled()) return { ...EMPTY, skippedReasons: {} };

  // 🚨 FAIL-CLOSED: `isFounderOrg` yalnız `PRIMARY_ORG_ID` env'ine bakıyor ve
  // env SET DEĞİLSE HER ZAMAN `false` döner (`billing/subscription.ts`). Yani
  // env'siz koşmak, kurucu korumasının VAR OLDUĞUNU sanıp aslında körlemesine
  // silmek demektir. Koruma kanıtlanamıyorsa süpürge hiç koşmaz.
  if (!process.env.PRIMARY_ORG_ID) {
    return { ...EMPTY, skippedReasons: { primary_org_id_unset: 1 } };
  }
  const dryRun = unverifiedSweepDryRun();

  const cutoff = new Date(now.getTime() - UNVERIFIED_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await prisma.user.findMany({
    where: {
      emailVerifiedAt: null,
      // ↑Yorumdaki en kritik satır: cutoff ÖNCESİ muaf hesaplara ASLA dokunma.
      createdAt: { gte: EMAIL_VERIFY_REQUIRED_FROM, lt: cutoff },
      // UÇUŞTAKİ doğrulama: son 24 saatte resend istenmişse kullanıcı ŞU AN
      // deniyor demektir (`resend-verification` yeni token + yeni son kullanma
      // yazar). Terk edilmiş değil.
      OR: [{ emailVerifyExpiresAt: null }, { emailVerifyExpiresAt: { lt: now } }],
      // Sahiplik KANITI olan hesaplar: 2FA kurmak oturum ister, `sessionEpoch`
      // artışı parola değiştirildi/sıfırlandı demektir. İkisi de "bu hesaba
      // gerçek sahibi erişti" sinyalidir.
      twoFactorEnabledAt: null,
      sessionEpoch: 0,
      role: "owner",
    },
    select: { id: true, organizationId: true },
    orderBy: { createdAt: "asc" }, // en eski işgal önce serbest bırakılır
    take: SWEEP_BATCH,
  });

  const result: UnverifiedSweepResult = {
    scanned: candidates.length,
    deleted: 0,
    skipped: 0,
    skippedReasons: {},
    failed: 0,
  };

  const skip = (reason: string) => {
    result.skipped += 1;
    result.skippedReasons[reason] = (result.skippedReasons[reason] ?? 0) + 1;
  };

  // Aynı org'un birden fazla adayı olamaz (tek kullanıcı şartı aşağıda) ama
  // savunmacı davranıyoruz: bir org iki kez silinmeye çalışılmasın.
  const handled = new Set<string>();

  for (const candidate of candidates) {
    const orgId = candidate.organizationId;
    if (handled.has(orgId)) continue;
    handled.add(orgId);

    // Kurucu/primary org ASLA — ucuz ve en sert kontrol, en başta.
    if (isFounderOrg(orgId)) {
      skip("founder_org");
      continue;
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        // Hospitable bağlanmışsa biri gerçekten giriş yapmış demektir.
        hospitableTokenEnc: true,
        hospitableRefreshTokenEnc: true,
        hospitableConnectedAt: true,
        hospitableLabel: true,
        // V0.7: bağlantı satırı (her durumda — revoked/disconnected da "bağlanmıştı" demektir).
        channelConnections: { where: { provider: "hospitable" }, select: { id: true }, take: 1 },
        // Model bu org için çalışmış demektir — ucuz ek "el değmiş" sinyali.
        aiStyleProfile: true,
        _count: {
          select: {
            users: true,
            properties: true,
            invoices: true,
            checkoutConsents: true,
            messageTemplates: true,
            automationRules: true,
            messageOutbox: true,
            auditLogs: true,
            // KVKK silme talebi işlenmişse bu org'a KESİNLİKLE dokunulmaz.
            erasureTombstones: true,
          },
        },
      },
    });
    if (!org) {
      skip("org_missing");
      continue;
    }

    // ⚠️ Bu org'un sahibi TANIM GEREĞİ hiç giriş yapamadı (login doğrulama
    // kapısında 403). Dolayısıyla aşağıdakilerin HEPSİ sıfır olmalı. Biri
    // sıfır değilse varsayımımız yanlış demektir → DOKUNMA. Kayıt yalnız
    // org+user+subscription tohumluyor; şablon/otomasyon/mülk TOHUMLANMAZ,
    // yani bunlar gerçekten "insan eli değmiş" sinyalidir.
    const c = org._count;
    if (c.users !== 1) {
      skip("multi_user");
      continue;
    }
    if (c.invoices > 0 || c.checkoutConsents > 0) {
      skip("has_billing_history");
      continue;
    }
    if (
      org.hospitableTokenEnc ||
      org.hospitableRefreshTokenEnc ||
      org.hospitableConnectedAt ||
      org.hospitableLabel ||
      org.channelConnections.length > 0
    ) {
      skip("hospitable_connected");
      continue;
    }
    if (c.erasureTombstones > 0) {
      skip("has_erasure_tombstone");
      continue;
    }
    if (org.aiStyleProfile) {
      skip("has_data");
      continue;
    }
    if (c.properties > 0 || c.messageTemplates > 0 || c.automationRules > 0 || c.messageOutbox > 0) {
      skip("has_data");
      continue;
    }
    // Denetim satırı = birinin bu org'da bir şey YAPTIĞI anlamına gelir
    // (giriş, ayar değişikliği, impersonation…). Kayıt tek başına denetim
    // satırı yazmıyor, o yüzden bu da bir "el değmiş" sinyalidir.
    if (c.auditLogs > 0) {
      skip("has_audit_trail");
      continue;
    }

    // Abonelik yalnız kaydın açtığı trial olabilir. Ödeyen/duraklamış/iptal
    // edilmiş bir satır, hesabın bir yaşam döngüsünden geçtiğini gösterir.
    // ⚠️ `status === "trialing"` TEK BAŞINA YETMEZ: `provider: "paddle"` +
    // `status: "trialing"` GERÇEK bir Paddle denemesidir (sağlayıcıda kayıt
    // var). Ayrım SAĞLAYICIDA: kaydın açtığı satır `provider: "trial"`.
    const sub = await prisma.subscription.findUnique({
      where: { organizationId: orgId },
      select: {
        status: true,
        provider: true,
        providerRef: true,
        customerId: true,
        currentPeriodEnd: true,
        pastDueSince: true,
      },
    });
    if (sub) {
      const touchedProvider =
        BILLING_PROVIDERS.includes(sub.provider) ||
        sub.providerRef !== null ||
        sub.customerId !== null ||
        sub.currentPeriodEnd !== null ||
        sub.pastDueSince !== null;
      if (touchedProvider) {
        skip("billing_provider_touched");
        continue;
      }
      if (sub.status !== "trialing") {
        skip("subscription_not_trialing");
        continue;
      }
    }

    if (dryRun) {
      // Sayılır ama SİLİNMEZ — bayrağı açmadan önce canlıda güvenli önizleme.
      result.deleted += 1;
      continue;
    }

    try {
      await deleteAccountData(orgId);
      result.deleted += 1;
    } catch {
      // Tek bir org'un silinememesi tüm süpürgeyi düşürmez; sayaç raporlanır.
      // ⚠️ Burada `reportError` KULLANILMAZ: bu fonksiyon koşu-sonu aggregate
      // raporlamayı ÇAĞIRANA bırakır (rutin sonuç için alarm penceresi yakmak,
      // gerçek arızada sinyal değerini düşürür).
      result.failed += 1;
    }
  }

  return result;
}
