import "server-only";

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { decryptSecretBound, encryptSecretBound } from "@/lib/crypto";
import { addressHash, maskE164, normalizeE164Digits } from "@/lib/host-channel/binding-code";
import { hostChannelSecret } from "@/lib/host-channel/binding";
import { createUserWithMembership } from "@/lib/membership/write";
import {
  STAFF_CODE_TTL_MS,
  judgeStaffCode,
  newStaffCode,
  normalizeTeamContactName,
  staffCodeHash,
  staffWaMeLink,
  teamContactEmail,
} from "./core";
import { teamWhatsAppNumber } from "./flag";

// ---------------------------------------------------------------------------
// EKİP KİŞİSİ — veritabanı katmanı (T3, migration 97). Çağıranlar: Ayarlar rotaları (ekle / kod üret / bağı kaldır) ve personel numarasının
// web kancası (kodla bağla). Sağlayıcı bilmez: sağlayıcı yalnız bir dize.
//
//  · Ekip kişisi `User` satırıdır (rol `staff`, `loginDisabled`, yapay `.invalid` e-posta, kimsenin bilmediği rastgele parolanın özeti) +
//    ANA üyelik (köken `team`). Böylece görev ataması, iş izi, "kim başladı" adı ve yedek temizlikçi kuralı hiç değişmeden çalışır.
//  · Bekleyen bağda numara YOK: kod HMAC özetiyle aranır. Yanlış kod satır bulmaz → deneme sayacı yoktur; tahmin alanı 32⁶ ≈ 10⁹, kod 72
//    saat yaşar ve her deneme gerçek bir WhatsApp mesajıdır (bilinen sınır, tasarım belgesinde).
//  · Kapanan bağ numarayı tutmaz (şifreli numara + özet silinir). Kod kiracıdan bağımsız aranır: iki bekleyen kodun aynı diziye düşmesi
//    ~P / 2³⁰ (P = 72 saatteki bekleyen kod sayısı) — en yeni satır seçilir; bilinen sınır.
//  · Numara işletme içinde tek kişide: aynı numara başka bir kişide etkinse o bağ `number_moved` ile kapanır (telefonu elinde tutan kodu
//    gönderdi). İşletmeler arası serbest — bir temizlikçi birden çok ev sahibiyle çalışabilir.
//  · Kişi başına tek etkin numara: yeni numara doğrulanınca eskisi `replaced` ile kapanır. Yeni kod üretmek eski bekleyen kodu geçersiz kılar.
// ---------------------------------------------------------------------------

/** Kapanan bağ numarayı TUTMAZ (Haiku T3 #1): kaldırılan / değişen / taşınan bağın şifreli numarası ve arama özeti silinir — iz yalnız durum,
 *  zaman ve sebep. Böylece numara süpürmesi de yalnız gerçekten numarayı tutan (etkin) satırı bulur, eski sebepler ezilmez (#9). */
class LostRace extends Error {}

const addressAad = (bindingId: string, organizationId: string) => `staff-channel-address:v1:${bindingId}:${organizationId}`;

export type CreateTeamContactResult = { ok: true; userId: string; name: string } | { ok: false; reason: "bad_name" };

export async function createTeamContact(input: { organizationId: string; name: unknown; now?: Date }): Promise<CreateTeamContactResult> {
  const name = normalizeTeamContactName(input.name);
  if (!name) return { ok: false, reason: "bad_name" };
  const now = input.now ?? new Date();
  // Rastgele, hiçbir yerde saklanmayan parolanın özeti: `passwordHash` zorunlu kolon; `loginDisabled` zaten girişi kapatır, bu ikinci kemer.
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  const user = await prisma.$transaction((tx) =>
    createUserWithMembership(
      tx,
      {
        organizationId: input.organizationId,
        name,
        email: teamContactEmail(),
        passwordHash,
        role: "staff",
        loginDisabled: true,
        emailVerifiedAt: now,
      },
      "team",
    ),
  );
  return { ok: true, userId: user.id, name: user.name };
}

export type TeamContactView = {
  userId: string;
  name: string;
  binding: { status: "active"; masked: string; verifiedAt: string } | { status: "pending"; expiresAt: string } | { status: "none" };
};

/** Ayarlar listesi: işletmenin giriş yapamayan personeli + bağ durumu. Numara yalnız maskeli. */
export async function listTeamContacts(organizationId: string, now: Date = new Date()): Promise<TeamContactView[]> {
  const users = await prisma.user.findMany({
    where: { organizationId, loginDisabled: true, role: "staff" },
    select: { id: true, name: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  if (users.length === 0) return [];
  const rows = await prisma.staffChannelBinding.findMany({
    where: { organizationId, userId: { in: users.map((u) => u.id) }, status: { in: ["active", "pending"] } },
    select: { id: true, userId: true, status: true, addressEnc: true, verifiedAt: true, codeExpiresAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return users.map((u) => {
    const mine = rows.filter((r) => r.userId === u.id);
    const active = mine.find((r) => r.status === "active" && r.addressEnc);
    if (active) {
      let masked = "•••";
      try {
        masked = maskE164(decryptSecretBound(active.addressEnc!, addressAad(active.id, organizationId)));
      } catch {
        // Çözülemeyen adres gösterimi düşürmez; bağ yine "bağlı" görünür.
      }
      return { userId: u.id, name: u.name, binding: { status: "active" as const, masked, verifiedAt: (active.verifiedAt ?? now).toISOString() } };
    }
    const pending = mine.find((r) => r.status === "pending" && r.codeExpiresAt && r.codeExpiresAt.getTime() > now.getTime());
    if (pending) return { userId: u.id, name: u.name, binding: { status: "pending" as const, expiresAt: pending.codeExpiresAt!.toISOString() } };
    return { userId: u.id, name: u.name, binding: { status: "none" as const } };
  });
}

export type StartStaffBindingResult =
  | { ok: true; code: string; link: string | null; expiresAt: Date }
  | { ok: false; reason: "disabled" | "not_found" };

/** Kişiye özel kod üretir (eski bekleyen kodu geçersiz kılar). Yalnız işletmenin giriş yapamayan personeli için. */
export async function startStaffBinding(input: { organizationId: string; userId: string; provider: string; now?: Date }): Promise<StartStaffBindingResult> {
  const secret = hostChannelSecret();
  if (!secret) return { ok: false, reason: "disabled" };
  const now = input.now ?? new Date();
  const code = newStaffCode();
  const expiresAt = new Date(now.getTime() + STAFF_CODE_TTL_MS);
  const done = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: input.userId, organizationId: input.organizationId, loginDisabled: true, role: "staff" },
      select: { id: true },
    });
    if (!user) return false;
    await tx.staffChannelBinding.updateMany({
      where: { organizationId: input.organizationId, userId: input.userId, status: "pending" },
      data: { status: "revoked", revokedAt: now, revokedReason: "replaced", codeHash: null, codeExpiresAt: null },
    });
    await tx.staffChannelBinding.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        provider: input.provider,
        status: "pending",
        codeHash: staffCodeHash(code, secret),
        codeExpiresAt: expiresAt,
      },
    });
    return true;
  });
  if (!done) return { ok: false, reason: "not_found" };
  return { ok: true, code, link: staffWaMeLink(teamWhatsAppNumber(), code), expiresAt };
}

export type ConfirmStaffBindingResult =
  | { ok: true; bindingId: string; organizationId: string; userId: string }
  | { ok: false; reason: "disabled" | "bad_number" | "unknown_code" | "expired" | "not_pending" | "not_allowed" | "conflict" };

/** Personel numarasına gelen kodlu mesaj. Gönderen numara = bağlanacak numara; ilk mesaj = izin anı. Yinelenen teslimat zararsız. */
export async function confirmStaffBindingFromInbound(input: {
  provider: string;
  fromRaw: string;
  code: string;
  now?: Date;
}): Promise<ConfirmStaffBindingResult> {
  const secret = hostChannelSecret();
  if (!secret) return { ok: false, reason: "disabled" };
  // Meta `from` artısız rakam verir (ev sahibi akışıyla aynı biçimleme); elle verilmiş "+…" da kabul.
  const digits = normalizeE164Digits(input.fromRaw.startsWith("+") ? input.fromRaw : `+${input.fromRaw}`);
  if (!digits) return { ok: false, reason: "bad_number" };
  const now = input.now ?? new Date();
  const codeHash = staffCodeHash(input.code, secret);
  const addrHash = addressHash(input.provider, digits, secret);
  try {
    return await prisma.$transaction(async (tx) => {
      const b = await tx.staffChannelBinding.findFirst({
        where: { codeHash, provider: input.provider },
        select: { id: true, organizationId: true, userId: true, status: true, codeHash: true, codeExpiresAt: true },
        orderBy: { createdAt: "desc" },
      });
      if (!b) return { ok: false as const, reason: "unknown_code" as const };
      const verdict = judgeStaffCode(b, now);
      if (verdict !== "ok") return { ok: false as const, reason: verdict };
      // Kişi satırı kilitlenir: aynı kişinin iki kodu eşzamanlı doğrulanırsa ikisi birden etkin kalmasın.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${b.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: b.userId }, select: { organizationId: true, loginDisabled: true, role: true } });
      if (!user || user.organizationId !== b.organizationId || !user.loginDisabled || user.role !== "staff") {
        return { ok: false as const, reason: "not_allowed" as const };
      }
      // Aynı işletmede bu numara başka bir satırda (etkin ya da kaldırılmış) → tekil dizin için önce boşaltılır; etkinse o bağ kapanır.
      await tx.staffChannelBinding.updateMany({
        where: { organizationId: b.organizationId, provider: input.provider, addressHash: addrHash, id: { not: b.id } },
        data: { addressHash: null, addressEnc: null, status: "revoked", revokedAt: now, revokedReason: "number_moved" },
      });
      const won = await tx.staffChannelBinding.updateMany({
        where: { id: b.id, status: "pending", codeHash: b.codeHash },
        data: {
          status: "active",
          addressHash: addrHash,
          addressEnc: encryptSecretBound(digits, addressAad(b.id, b.organizationId)),
          verifiedAt: now,
          optInAt: now,
          codeHash: null,
          codeExpiresAt: null,
        },
      });
      // Kaybeden işlem yukarıdaki numara süpürmesini COMMIT ETMEMELİ (Haiku T3 #2): fırlatma geri alır, dışarıda `not_pending` olur.
      if (won.count !== 1) throw new LostRace();
      await tx.staffChannelBinding.updateMany({
        where: { organizationId: b.organizationId, userId: b.userId, status: "active", id: { not: b.id } },
        data: { status: "revoked", revokedAt: now, revokedReason: "replaced", addressHash: null, addressEnc: null },
      });
      return { ok: true as const, bindingId: b.id, organizationId: b.organizationId, userId: b.userId };
    });
  } catch (err) {
    if (err instanceof LostRace) return { ok: false, reason: "not_pending" };
    // Aynı numaranın eşzamanlı iki kodu: tekil dizin kaybedeni düşürür (kazanan bağlıdır).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { ok: false, reason: "conflict" };
    throw err;
  }
}

/** Ev sahibinin kaldırması: kişinin etkin ve bekleyen bağları kapanır (idempotent). Kapanan satır sayısı. */
export async function revokeStaffBindings(input: { organizationId: string; userId: string; now?: Date }): Promise<number> {
  const now = input.now ?? new Date();
  const r = await prisma.staffChannelBinding.updateMany({
    where: { organizationId: input.organizationId, userId: input.userId, status: { in: ["active", "pending"] } },
    data: { status: "revoked", revokedAt: now, revokedReason: "user", codeHash: null, codeExpiresAt: null, addressHash: null, addressEnc: null },
  });
  return r.count;
}
