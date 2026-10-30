import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { decryptSecretBound, encryptSecretBound } from "@/lib/crypto";
import {
  BINDING_CODE_MAX_ATTEMPTS,
  BINDING_CODE_TTL_MS,
  addressHash,
  bindingCodeHash,
  bindingUsable,
  judgeBindingCode,
  maskE164,
  newBindingCode,
  normalizeE164Digits,
  type BindingCodeVerdict,
} from "./binding-code";

// ---------------------------------------------------------------------------
// NUMARA BAĞLAMA — veritabanı katmanı (tasarım §5.3–5.5, migration 88 `HostChannelBinding`). Çağıranlar: Ayarlar rotası (başlat / kaldır) ve
// gelen mesaj işleyicisi (kodla doğrula). Sağlayıcı bilmez (V0): sağlayıcı kimliği yalnız bir dize (`whatsapp_cloud` | `fake`).
//
//  · Numara düz saklanmaz: arama anahtarı HMAC (`addressHash`), gösterim için şifreli (AAD = bağlantı kimliği).
//  · Bir numara tek satır (`@@unique([provider, addressHash])`): başka hesabın ETKİN bağlantısı devralınamaz (`number_in_use`); başka hesabın
//    süresi dolmamış bekleyen kodu da devralınamaz (`number_pending_elsewhere`, ele geçirme yarışı); süresi dolmuş / kaldırılmış satır devralınır.
//  · Doğrulama kodu ev sahibinin KENDİ WhatsApp'ından gelir: gönderen numaranın anahtarıyla bulunan bekleyen satır + kod hükmü. Kod numaraya
//    değil hesaba bağlıdır (ekranı gören hesap üretti).
//  · Etkinleşince aynı kullanıcının öteki etkin bağlantıları kapanır (ilk dilim: kullanıcı başına tek numara).
//  · Oturum kuşağı doğrulama anında saklanır; kullanıcının kuşağı artınca bağlantı soru almaz (`bindingUsable`).
//  · 🚨 Ayrıntılı ret sebepleri (`number_in_use`, `number_pending_elsewhere`) YALNIZ günlük / test içindir: Ayarlar rotası ev sahibine TEK genel
//    cümle gösterir, rolü (sahip / yönetici) ve oturumun işletmesini kendisi doğrular, işletme + numara başına hız sınırı uygular — aksi hâlde
//    bir hesap başka numaraların Lixus'ta bağlı olup olmadığını yoklayabilir ya da kod yenileyerek numarayı kilitleyebilir (Haiku 10-30 P2-4).
// ---------------------------------------------------------------------------

/** Anahtar (en az 32 karakter) yoksa bağlama kapalıdır — eksik anahtarla zayıf özet üretilmez. */
export function hostChannelSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.HOST_CHANNEL_HMAC_SECRET?.trim();
  return s && s.length >= 32 ? s : null;
}

const addressAad = (bindingId: string, organizationId: string) => `host-channel-address:v1:${bindingId}:${organizationId}`;

export type StartBindingResult =
  | { ok: true; bindingId: string; code: string; masked: string; expiresAt: Date }
  | { ok: false; reason: "disabled" | "bad_number" | "number_in_use" | "number_pending_elsewhere" | "already_active" };

export async function startHostBinding(input: {
  organizationId: string;
  userId: string;
  provider: string;
  rawNumber: string;
  optInTextVersion: string;
  now?: Date;
}): Promise<StartBindingResult> {
  const secret = hostChannelSecret();
  if (!secret) return { ok: false, reason: "disabled" };
  const digits = normalizeE164Digits(input.rawNumber);
  if (!digits) return { ok: false, reason: "bad_number" };
  const now = input.now ?? new Date();
  const hash = addressHash(input.provider, digits, secret);
  const code = newBindingCode();
  const expiresAt = new Date(now.getTime() + BINDING_CODE_TTL_MS);
  const pending = {
    organizationId: input.organizationId,
    userId: input.userId,
    status: "pending",
    verifyCodeHash: bindingCodeHash(code, secret),
    verifyExpiresAt: expiresAt,
    verifyAttempts: 0,
    verifiedAt: null,
    optInAt: now,
    optInTextVersion: input.optInTextVersion,
    revokedAt: null,
    revokedReason: null,
  };
  const existing = await prisma.hostChannelBinding.findUnique({
    where: { provider_addressHash: { provider: input.provider, addressHash: hash } },
    select: { id: true, organizationId: true, userId: true, status: true, verifyExpiresAt: true, userSessionEpoch: true },
  });
  const sameOwner = existing && existing.organizationId === input.organizationId && existing.userId === input.userId;
  // Aynı sahibin ÇALIŞAN bağlantısı yeniden başlatılınca beklemeye düşmez (Haiku 10-30 P3-4: sorular doğrulamaya kadar dururdu); oturum kuşağı
  // eskiyse (şifre değişimi) yeniden doğrulama yolu açık kalır.
  if (existing && sameOwner && existing.status === "active") {
    const fresh = await prisma.hostChannelBinding.findFirst({
      where: { id: existing.id, user: { sessionEpoch: { equals: existing.userSessionEpoch } } },
      select: { id: true },
    });
    if (fresh) return { ok: false, reason: "already_active" };
  }
  if (existing && !sameOwner) {
    if (existing.status === "active") return { ok: false, reason: "number_in_use" };
    if (existing.status === "pending" && existing.verifyExpiresAt && existing.verifyExpiresAt.getTime() > now.getTime()) {
      return { ok: false, reason: "number_pending_elsewhere" };
    }
  }
  if (existing) {
    // Devralma / yeniden bağlama: satır kimliği aynı kalır, adres şifresi YENİ sahibin işletmesine bağlanır. Yalnız okunan durum hâlâ
    // geçerliyse yazılır (yarış: başka biri arada etkinleştirdiyse sayım 0 → kullanımda).
    const updated = await prisma.hostChannelBinding.updateMany({
      where: { id: existing.id, status: existing.status, organizationId: existing.organizationId, userId: existing.userId },
      data: { ...pending, addressEnc: encryptSecretBound(digits, addressAad(existing.id, input.organizationId)) },
    });
    if (updated.count !== 1) return { ok: false, reason: "number_in_use" };
    return { ok: true, bindingId: existing.id, code, masked: maskE164(digits), expiresAt };
  }
  const id = randomUUID();
  try {
    await prisma.hostChannelBinding.create({
      data: {
        id,
        provider: input.provider,
        addressHash: hash,
        addressEnc: encryptSecretBound(digits, addressAad(id, input.organizationId)),
        ...pending,
      },
    });
  } catch (err) {
    // Aynı numaranın eşzamanlı ilk kaydı: tekil kısıt yarışı kaybeden "kullanımda" alır (yeniden denerse satırı görür).
    if ((err as { code?: string })?.code === "P2002") return { ok: false, reason: "number_pending_elsewhere" };
    throw err;
  }
  return { ok: true, bindingId: id, code, masked: maskE164(digits), expiresAt };
}

export type ConfirmBindingResult =
  | { ok: true; bindingId: string; organizationId: string; userId: string }
  | { ok: false; reason: "disabled" | "unknown_address" | "not_allowed" | Exclude<BindingCodeVerdict, "ok"> };

/**
 * Gelen mesajdaki kodla doğrula. `fromDigits` sağlayıcının bildirdiği gönderen (yalnız rakam). Yanlış kodda deneme sayacı artar; doğru kodda
 * bağlantı etkinleşir, kod silinir, oturum kuşağı yazılır, aynı kullanıcının öteki etkin bağlantıları kapanır. Tek işlem; durum değişikliği
 * okunan sürüme koşullu (iki eşzamanlı doğrulamadan biri kazanır). Kodu üreten kullanıcı bu arada işletmeden çıktıysa ya da rolü personele
 * düştüyse bağlantı ETKİNLEŞMEZ (`not_allowed`; tasarım §5.3 "gelen yolda da her işlemde rol yeniden okunur").
 */
export async function confirmHostBindingFromInbound(input: {
  provider: string;
  fromDigits: string;
  code: string;
  now?: Date;
}): Promise<ConfirmBindingResult> {
  const secret = hostChannelSecret();
  if (!secret) return { ok: false, reason: "disabled" };
  const now = input.now ?? new Date();
  const hash = addressHash(input.provider, input.fromDigits, secret);
  return prisma.$transaction(async (tx) => {
    const b = await tx.hostChannelBinding.findUnique({
      where: { provider_addressHash: { provider: input.provider, addressHash: hash } },
      select: { id: true, organizationId: true, userId: true, status: true, verifyCodeHash: true, verifyExpiresAt: true, verifyAttempts: true },
    });
    if (!b) return { ok: false as const, reason: "unknown_address" as const };
    const verdict = judgeBindingCode(b, input.code, secret, now);
    if (verdict !== "ok" && verdict !== "mismatch") return { ok: false as const, reason: verdict };
    if (verdict === "ok") {
      const user = await tx.user.findUnique({ where: { id: b.userId }, select: { organizationId: true, role: true } });
      if (!user || user.organizationId !== b.organizationId || (user.role !== "owner" && user.role !== "manager")) {
        return { ok: false as const, reason: "not_allowed" as const };
      }
    }
    // Deneme hakkı, karşılaştırmanın sonucu KULLANILMADAN önce ayrılır (Haiku 10-30 P3): okunan sayaç eşzamanlı isteklerde bayattır; ayırma
    // satırı kilitler, eşzamanlı doğrulamaları sıraya sokar ve 5'ten fazla denemenin — doğru kod dahil — sonuç doğurmasını engeller.
    const reserved = await tx.hostChannelBinding.updateMany({
      where: { id: b.id, status: "pending", verifyCodeHash: b.verifyCodeHash, verifyAttempts: { lt: BINDING_CODE_MAX_ATTEMPTS } },
      data: { verifyAttempts: { increment: 1 } },
    });
    if (reserved.count !== 1) {
      const after = await tx.hostChannelBinding.findUnique({ where: { id: b.id }, select: { status: true } });
      return { ok: false as const, reason: after?.status === "pending" ? ("too_many_attempts" as const) : ("not_pending" as const) };
    }
    if (verdict === "mismatch") return { ok: false as const, reason: verdict };
    // Kullanıcı satırı kilitlenir: aynı kullanıcının İKİ bekleyen numarası eşzamanlı doğrulanırsa ikisi de etkin kalmasın (her işlem ötekinin
    // henüz yazılmamış etkinleşmesini göremezdi — inceleme 10-30 gece P3). İkinci işlem birincinin sonucunu görür, "kullanıcı başına tek numara".
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${b.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: b.userId }, select: { sessionEpoch: true } });
    if (!user) return { ok: false as const, reason: "not_allowed" as const };
    const won = await tx.hostChannelBinding.updateMany({
      where: { id: b.id, status: "pending", verifyCodeHash: b.verifyCodeHash },
      data: {
        status: "active",
        verifiedAt: now,
        verifyCodeHash: null,
        verifyExpiresAt: null,
        verifyAttempts: 0,
        userSessionEpoch: user.sessionEpoch,
        lastInboundAt: now,
      },
    });
    if (won.count !== 1) return { ok: false as const, reason: "not_pending" as const };
    await tx.hostChannelBinding.updateMany({
      where: { userId: b.userId, status: "active", id: { not: b.id } },
      data: { status: "revoked", revokedAt: now, revokedReason: "user" },
    });
    return { ok: true as const, bindingId: b.id, organizationId: b.organizationId, userId: b.userId };
  });
}

/** Ev sahibinin kaldırması / "DUR" yazması / sağlayıcının engel bildirimi. Kaldırılmış satır dokunulmaz (idempotent). */
export async function revokeHostBinding(input: {
  bindingId: string;
  organizationId: string;
  reason: "user" | "opt_out" | "epoch" | "operator" | "provider_blocked" | "number_changed" | "key_rotated";
  now?: Date;
}): Promise<boolean> {
  const r = await prisma.hostChannelBinding.updateMany({
    where: { id: input.bindingId, organizationId: input.organizationId, status: { not: "revoked" } },
    data: { status: "revoked", revokedAt: input.now ?? new Date(), revokedReason: input.reason, verifyCodeHash: null, verifyExpiresAt: null },
  });
  return r.count === 1;
}

/**
 * İşletmenin soru alabilecek bağlantısı (ilk dilim: tek alıcı — en son doğrulanan). Kullanıcı hâlâ işletmede sahip / yönetici olmalı ve oturum
 * kuşağı doğrulama anındakiyle aynı olmalı (`bindingUsable`); değilse `null` → bugünkü e-posta.
 */
export async function usableHostBindingForOrg(organizationId: string): Promise<{ id: string; userId: string } | null> {
  const rows = await prisma.hostChannelBinding.findMany({
    where: { organizationId, status: "active" },
    orderBy: [{ verifiedAt: "desc" }, { id: "asc" }],
    // Bayat (rolü düşmüş / kuşağı eskimiş) satırlar süzülmeden önce geçerli olanı dışarıda bırakmasın (Haiku 10-30 P3-3).
    take: 50,
    select: { id: true, userId: true, status: true, userSessionEpoch: true, user: { select: { sessionEpoch: true, organizationId: true, role: true } } },
  });
  for (const r of rows) {
    if (r.user.organizationId !== organizationId) continue;
    if (r.user.role !== "owner" && r.user.role !== "manager") continue;
    if (!bindingUsable(r, r.user.sessionEpoch)) continue;
    return { id: r.id, userId: r.userId };
  }
  return null;
}

export type HostBindingView = {
  /** `suspended`: etkin ama oturum kuşağı değişti (şifre değişimi / sıfırlama) — soru almaz, yeniden doğrulama ister. */
  status: "pending" | "active" | "suspended";
  /** Maskeli numara (yalnız son iki hane). */
  masked: string;
  /** Bekleyen kodun bitişi; etkin bağlantıda `null`. */
  expiresAt: Date | null;
};

/**
 * Ayarlar ekranı için kullanıcının KENDİ bağlantısı (işletme + kullanıcı ile kapsanır; başka kullanıcının / işletmenin bağlantısı görünmez).
 * Süresi dolmuş bekleyen kod → `null` (yeniden başlatılır). Numara yalnız maskeli döner.
 */
export async function hostBindingForUser(organizationId: string, userId: string, now: Date = new Date()): Promise<HostBindingView | null> {
  const row = await prisma.hostChannelBinding.findFirst({
    where: { organizationId, userId, status: { in: ["pending", "active"] } },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { id: true, status: true, addressEnc: true, verifyExpiresAt: true, userSessionEpoch: true, user: { select: { sessionEpoch: true } } },
  });
  if (!row) return null;
  if (row.status === "pending" && (!row.verifyExpiresAt || row.verifyExpiresAt.getTime() <= now.getTime())) return null;
  let masked = "••••";
  try {
    masked = maskE164(decryptSecretBound(row.addressEnc, addressAad(row.id, organizationId)));
  } catch {
    // Çözülemeyen adres gösterilmez; durum yine doğru döner.
  }
  if (row.status === "pending") return { status: "pending", masked, expiresAt: row.verifyExpiresAt };
  return { status: bindingUsable(row, row.user.sessionEpoch) ? "active" : "suspended", masked, expiresAt: null };
}

/** Ayarlar'dan "Bağlantıyı kaldır": kullanıcının bu işletmedeki bekleyen / etkin bağlantıları kapanır. Kapatılan satır sayısı döner. */
export async function revokeHostBindingsForUser(organizationId: string, userId: string, now: Date = new Date()): Promise<number> {
  const r = await prisma.hostChannelBinding.updateMany({
    where: { organizationId, userId, status: { in: ["pending", "active"] } },
    data: { status: "revoked", revokedAt: now, revokedReason: "user", verifyCodeHash: null, verifyExpiresAt: null },
  });
  return r.count;
}
