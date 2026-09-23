import type { PrismaClient } from "@prisma/client";
import { DEMO_ID_PREFIX, DEMO_LOGIN_EMAIL, DEMO_ORG_ID } from "./constants";
import type { DemoDataset } from "./dataset";

// ---------------------------------------------------------------------------
// DEMO HESABI — UYGULAMA ÇEKİRDEĞİ (betik ve testler kullanır; `server-only` modül İÇE AKTARMAZ).
//
// 🚨 KİRACI SINIRI: her silme `DEMO_ORG_ID` ile kapsanır (mekanik pin: bu dosyadaki her
// `deleteMany(` çağrısı `DEMO_ORG_ID` içerir). Başka hiçbir org'un satırına dokunulmaz — entegrasyon
// testi iki komşu org'un satır sayısını ve içeriğini önce/sonra karşılaştırır.
// 🚨 ÖNCE KONTROL, SONRA YAZMA: reddetme sebeplerinden biri varsa HİÇBİR ŞEY yazılmaz
// (kontrol işlemin İÇİNDE de tekrarlanır — kontrol ile yazma arasındaki yarış kapanır).
// 🚨 GİRİŞ HESABI: şifre yalnız ilk oluşturmada ya da açık "şifreyi yenile" isteğinde yazılır;
// yenileme inceleme ekibinin oturumunu düşürmez (`--reset-security` açıkça istenmedikçe).
// ---------------------------------------------------------------------------

export type DemoRefusal =
  | "wrong_org_id"
  | "login_email_taken"
  | "staff_email_taken"
  | "live_connection_present"
  | "property_id_collision"
  | "first_run_needs_password";

export class DemoRefusedError extends Error {
  constructor(readonly reason: DemoRefusal) {
    super(`demo tenant refused: ${reason}`);
    this.name = "DemoRefusedError";
  }
}

/** Görev fotoğrafı depolama yolu — `storage/keys.ts` ile AYNI (o modül server-only; eşitlik test-pinli). */
export const DEMO_STORAGE_PHOTO_URL_PREFIX = "/api/storage/photo/";
const DEMO_PHOTO_KEY = new RegExp(`^org/${DEMO_ORG_ID}/task/[a-zA-Z0-9-]{1,64}/[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`);

type Db = PrismaClient;
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export interface DemoPreflight {
  orgExists: boolean;
  reviewerExists: boolean;
  /** İlk kurulum ve şifre verilmemiş: uygulama koşusu reddedilir (kuru koşu yalnız BİLDİRİR). */
  needsReviewerPassword: boolean;
  existing: { properties: number; reservations: number; conversations: number; tasks: number };
}

async function check(db: Db | Tx, ds: DemoDataset, hasReviewerPassword: boolean, requirePassword: boolean): Promise<DemoPreflight> {
  if (ds.org.id !== DEMO_ORG_ID) throw new DemoRefusedError("wrong_org_id");
  if (ds.users.some((u) => !u.id.startsWith(DEMO_ID_PREFIX))) throw new DemoRefusedError("wrong_org_id");

  const reviewer = ds.users.find((u) => u.email === DEMO_LOGIN_EMAIL);
  const taken = await db.user.findMany({
    where: { email: { in: ds.users.map((u) => u.email) } },
    select: { id: true, email: true, organizationId: true },
  });
  for (const t of taken) {
    const expected = ds.users.find((u) => u.email === t.email);
    // Açık kayıt bu adresi önceden alabilir: başka bir hesabı DEVRALMAYIZ.
    if (!expected || t.id !== expected.id || t.organizationId !== DEMO_ORG_ID) {
      throw new DemoRefusedError(t.email === DEMO_LOGIN_EMAIL ? "login_email_taken" : "staff_email_taken");
    }
  }
  const reviewerExists = Boolean(reviewer && taken.some((t) => t.id === reviewer.id));
  const needsReviewerPassword = !reviewerExists && !hasReviewerPassword;
  if (needsReviewerPassword && requirePassword) throw new DemoRefusedError("first_run_needs_password");

  const org = await db.organization.findUnique({
    where: { id: DEMO_ORG_ID },
    select: {
      id: true,
      hospitableTokenEnc: true,
      hospitableRefreshTokenEnc: true,
      subscription: { select: { id: true } },
      channelConnections: { select: { id: true }, take: 1 },
    },
  });
  const liveFeeds = await db.calendarSource.count({ where: { property: { organizationId: DEMO_ORG_ID } } });
  if (org && (org.hospitableTokenEnc || org.hospitableRefreshTokenEnc || org.subscription || org.channelConnections.length > 0 || liveFeeds > 0)) {
    // Gerçek bir bağlantı ya da abonelik varsa bu artık demo değildir: dokunmayız.
    throw new DemoRefusedError("live_connection_present");
  }
  const foreignProps = await db.property.count({
    where: { id: { in: ds.properties.map((p) => p.id) }, NOT: { organizationId: DEMO_ORG_ID } },
  });
  if (foreignProps > 0) throw new DemoRefusedError("property_id_collision");

  const [properties, reservations, conversations, tasks] = await Promise.all([
    db.property.count({ where: { organizationId: DEMO_ORG_ID } }),
    db.reservation.count({ where: { property: { organizationId: DEMO_ORG_ID } } }),
    db.conversation.count({ where: { property: { organizationId: DEMO_ORG_ID } } }),
    db.task.count({ where: { property: { organizationId: DEMO_ORG_ID } } }),
  ]);
  return { orgExists: Boolean(org), reviewerExists, needsReviewerPassword, existing: { properties, reservations, conversations, tasks } };
}

/** Kuru koşu: reddetme kontrolleri + mevcut satır sayıları. HİÇBİR ŞEY YAZMAZ. */
export function preflightDemoTenant(db: Db, ds: DemoDataset, opts: { hasReviewerPassword: boolean }): Promise<DemoPreflight> {
  return check(db, ds, opts.hasReviewerPassword, false);
}

export interface DemoApplyOptions {
  /** İlk oluşturmada ZORUNLU; sonraki yenilemelerde yalnız `rotatePassword` ile yazılır. */
  reviewerPasswordHash: string | null;
  /** Personel hesaplarının kullanılmayan (rastgele) şifre özeti — yalnız oluşturmada. */
  staffPasswordHash: string;
  rotatePassword?: boolean;
  /** 2FA + kurtarma kodları + oturumlar sıfırlanır (inceleme sonrası hesap geri alınır). */
  resetSecurity?: boolean;
}

export interface DemoApplyResult {
  preflight: DemoPreflight;
  written: { properties: number; reservations: number; conversations: number; messages: number; tasks: number; kbItems: number; templates: number };
  photoDeletionsQueued: number;
}

export async function applyDemoTenant(db: Db, ds: DemoDataset, opts: DemoApplyOptions): Promise<DemoApplyResult> {
  return db.$transaction(
    async (tx) => {
      const preflight = await check(tx, ds, opts.reviewerPasswordHash !== null, true);
      const now = ds.now;

      // --- Kuruluş: ayarlar veri kümesine döner (inceleme ekibinin değişiklikleri geri alınır). ---
      const orgSettings = {
        name: ds.org.name,
        timezone: ds.org.timezone,
        language: ds.org.language,
        aiReplyTone: ds.org.aiReplyTone,
        aiSignature: ds.org.aiSignature,
        autoReplyHospitable: ds.org.autoReplyHospitable,
        autoReplyStartHour: ds.org.autoReplyStartHour,
        autoReplyEndHour: ds.org.autoReplyEndHour,
        autoWelcome: ds.org.autoWelcome,
        autoCheckin: ds.org.autoCheckin,
        autoCheckout: ds.org.autoCheckout,
        lateCheckoutOfferText: ds.org.lateCheckoutOfferText,
        autoReplyEnabledAt: now,
        autoWelcomeEnabledAt: now,
        autoCheckinEnabledAt: now,
        autoCheckoutEnabledAt: now,
        // Uyarı e-postası adresi SIFIRLANIR: paylaşılan bir hesapta keyfi adrese e-posta yollatılamasın.
        alertEmail: null,
        autoHoldingReplyEnabled: false,
        autoClosingReplyEnabled: false,
        closingReplyText: null,
        autoTaskFromMessageEnabled: false,
        autoSupplyRequestEnabled: false,
        icalShowGuestName: false,
        qrChatPinRequired: false,
        aiStyleProfile: null,
        aiStyleProfileAt: null,
      };
      await tx.organization.upsert({ where: { id: DEMO_ORG_ID }, create: { id: DEMO_ORG_ID, ...orgSettings }, update: orgSettings });

      // --- Kullanıcılar ---
      for (const u of ds.users) {
        const isReviewer = u.email === DEMO_LOGIN_EMAIL;
        const existing = await tx.user.findUnique({ where: { id: u.id }, select: { id: true } });
        if (!existing) {
          const passwordHash = isReviewer ? opts.reviewerPasswordHash : opts.staffPasswordHash;
          if (!passwordHash) throw new DemoRefusedError("first_run_needs_password");
          await tx.user.create({
            data: { id: u.id, organizationId: DEMO_ORG_ID, name: u.name, email: u.email, role: u.role, passwordHash, emailVerifiedAt: now },
          });
          continue;
        }
        // Kimlik + demo org BİRLİKTE (inceleme 09-24): başka org'a ait aynı kimlikli bir satır asla güncellenmez.
        await tx.user.updateMany({
          where: { id: u.id, organizationId: DEMO_ORG_ID },
          data: {
            name: u.name,
            role: u.role,
            emailVerifiedAt: now,
            ...(isReviewer && opts.rotatePassword && opts.reviewerPasswordHash ? { passwordHash: opts.reviewerPasswordHash } : {}),
            ...(opts.resetSecurity || (isReviewer && opts.rotatePassword)
              ? {
                  twoFactorSecret: null,
                  twoFactorEnabledAt: null,
                  twoFactorLastStep: null,
                  // Bekleyen şifre değiştirme kodu (kimlik özet kolonu) BİLEREK yazılmaz: e-posta kuyruğu
                  // "kimlik özetine dokunan dosyalar kapalı listedir" pini; onay zaten oturum ister ve
                  // oturumlar aşağıda düşürülür.
                  sessionEpoch: { increment: 1 },
                }
              : {}),
          },
        });
        if (opts.resetSecurity) {
          await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: u.id, user: { organizationId: DEMO_ORG_ID } } });
        }
      }

      // --- Görev fotoğrafları: satır silinmeden önce depolama nesnesi silme kuyruğuna ---
      const photos = await tx.taskUpdate.findMany({
        where: { task: { property: { organizationId: DEMO_ORG_ID } }, photoUrl: { startsWith: DEMO_STORAGE_PHOTO_URL_PREFIX } },
        select: { photoUrl: true },
      });
      const keys = [...new Set(photos.map((p) => (p.photoUrl ?? "").slice(DEMO_STORAGE_PHOTO_URL_PREFIX.length)))].filter((k) =>
        DEMO_PHOTO_KEY.test(k),
      );
      const queued = keys.length
        ? (await tx.storageDeletion.createMany({ data: keys.map((objectKey) => ({ objectKey, organizationId: DEMO_ORG_ID })), skipDuplicates: true }))
            .count
        : 0;

      // --- Demo org'unun işletme verisi silinir (denetim kaydı KORUNUR) ---
      await tx.conversation.deleteMany({ where: { property: { organizationId: DEMO_ORG_ID } } }); // mesajlar zincirleme
      await tx.task.deleteMany({ where: { property: { organizationId: DEMO_ORG_ID } } }); // güncellemeler zincirleme
      await tx.supplyRequest.deleteMany({ where: { property: { organizationId: DEMO_ORG_ID } } });
      await tx.reservation.deleteMany({ where: { property: { organizationId: DEMO_ORG_ID } } });
      await tx.knowledgeBaseItem.deleteMany({ where: { property: { organizationId: DEMO_ORG_ID } } });
      await tx.messageTemplate.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
      await tx.signal.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
      await tx.propertyMemory.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
      await tx.ingestEvent.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
      await tx.riskEvent.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
      await tx.shadowVerdict.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
      await tx.messageOutbox.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
      await tx.automationRule.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
      // İnceleme sırasında eklenmiş, veri kümesinde olmayan mülkler.
      await tx.property.deleteMany({ where: { organizationId: DEMO_ORG_ID, id: { notIn: ds.properties.map((p) => p.id) } } });

      // --- Mülkler: güncelle ya da oluştur (QR/takvim token'ı varsa KORUNUR, yazılmaz) ---
      for (const p of ds.properties) {
        const data = { name: p.name, address: p.address, city: p.city, country: p.country, checkInTime: p.checkInTime, checkOutTime: p.checkOutTime, notes: null, supplyProfileJson: null };
        await tx.property.upsert({
          where: { id: p.id },
          create: { id: p.id, organizationId: DEMO_ORG_ID, chatEnabled: false, ...data },
          update: data,
        });
      }

      await tx.reservation.createMany({ data: ds.reservations });
      await tx.conversation.createMany({ data: ds.conversations });
      await tx.message.createMany({ data: ds.messages });
      await tx.task.createMany({ data: ds.tasks });
      await tx.knowledgeBaseItem.createMany({
        data: ds.kbItems.map((k) => ({ ...k, isActive: true, source: "host_manual", reviewState: "approved", approvedAt: now })),
      });
      await tx.messageTemplate.createMany({ data: ds.templates.map((t) => ({ ...t, organizationId: DEMO_ORG_ID, propertyId: null, isActive: true })) });

      const written = {
        properties: ds.properties.length,
        reservations: ds.reservations.length,
        conversations: ds.conversations.length,
        messages: ds.messages.length,
        tasks: ds.tasks.length,
        kbItems: ds.kbItems.length,
        templates: ds.templates.length,
      };
      await tx.auditLog.create({
        data: {
          organizationId: DEMO_ORG_ID,
          actorUserId: null,
          action: "demo_tenant.refreshed",
          metadataJson: JSON.stringify({ ...written, resetSecurity: Boolean(opts.resetSecurity), rotatePassword: Boolean(opts.rotatePassword) }),
        },
      });
      return { preflight, written, photoDeletionsQueued: queued };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
