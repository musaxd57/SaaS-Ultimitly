import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/event-log";
import { codeAnswerKind } from "./answer-kind";
import { confirmHostBindingFromInbound, hostChannelSecret, revokeHostBinding } from "./binding";
import { addressHash, extractBindingCode, normalizeE164Digits } from "./binding-code";
import type { HostChannelFlags } from "./routing";
import type { HostChannelTransport, HostInboundEvent } from "./types";

// ---------------------------------------------------------------------------
// EV SAHİBİNDEN GELEN MESAJ — çekirdek işleyici (tasarım §5.2, §5.4, §5.6, §3.5). Sağlayıcı bilmez (V0): web kancası rotası imzayı doğrular,
// gövdeyi `HostInboundEvent`e çevirir, buraya yalnız sağlayıcı kimliği + olaylar gelir. Bu dilim: numara bağlama kodu ve "DUR". Ev sahibinin
// soruya cevabı sonraki dilimde (soru ↔ cevap eşleme); bugün yalnız alınır.
//
//  · KİRACI YALNIZ GÖNDEREN NUMARADAN: numara → anahtarlı özet → tek bağlantı satırı → onun işletmesi. Gövdedeki hiçbir kimlik (`context.id`,
//    düğme kimliği, soru kimliği) işletme seçmez.
//  · Bilinmeyen gönderen / kaldırılmış bağlantı: HİÇBİR ŞEY yazılmaz, cevap gitmez (numara yoklanamaz, cevap döngüsü olmaz, dünyanın
//    herhangi bir yerinden gelen mesaj seli veritabanına yazı açmaz). Liste dışı işletmenin numarasından yalnız "DUR" işlenir (aşağıda).
//  · Tekrar önleme: tanınan gönderenin her mesajı `SystemLock` `host-in:<sha256>`. Önce kısa bir İŞLENİYOR kirası (2 dk), iş bitince BİTTİ
//    (8 gün; Meta bir haftaya kadar yeniden dener). Aynı mesaj bitmişse tekrar sayılır; hâlâ işleniyorsa "meşgul" (rota 503 → Meta sonra
//    yeniden dener); işleme yarıda kaldıysa (süreç öldü / veritabanı koptu, kilit silinemedi) kira dolunca yeniden denemede devralınır —
//    mesaj sessizce "tekrar" sayılıp KAYBOLMAZ (Haiku 10-30 P2-2).
//  · Bağlama kodu taşıyan mesaj kod denemesidir, ASLA cevap sayılmaz. Kod sonucu WhatsApp'tan bildirilmez (ekran gösterir; tasarım §5.4).
//  · "DUR" / "STOP" (mesajın tamamı) bağlantıyı kapatır — numaranın sahibi HER ZAMAN durdurabilir: rolü düşmüş ya da işletmesi liste dışına
//    alınmış olsa da (yoksa liste geri açılınca durdurmuş ev sahibine yine soru giderdi — Haiku 10-30 P2-1).
// ---------------------------------------------------------------------------

export const INBOUND_DEDUPE_PREFIX = "host-in:";
export const INBOUND_DEDUPE_TTL_MS = 8 * 24 * 60 * 60 * 1000;
/** İşleniyor kirası: bir mesajın işlenmesi (veritabanı + en çok bir gönderim) bundan uzun sürmez. */
export const INBOUND_LEASE_MS = 2 * 60 * 1000;
const PROCESSING = "processing";
const DONE = "done";
/** Tasarım §3.5 tablosu ("Çıkış" satırı). */
export const OPT_OUT_REPLY = "WhatsApp bildirimleri kapatıldı.";

export interface HostInboundResult {
  /** Tanınan gönderenden gelip işlenen mesaj. */
  processed: number;
  /** Daha önce işlenmiş teslimat tekrarı. */
  duplicates: number;
  /** Bilinmeyen gönderen / kaldırılmış bağlantı / liste dışı işletme / işlenecek bir şey yok. */
  ignored: number;
  /** Aynı mesaj şu an başka bir teslimatta işleniyor — çağıran yeniden deneme ister (503). */
  busy: number;
  /** İşlenen mesajların işletmeleri (günlük için; gönderen numaradan bulundu). */
  organizationIds: string[];
}

export function inboundDedupeName(provider: string, providerMessageId: string): string {
  return INBOUND_DEDUPE_PREFIX + createHash("sha256").update(`${provider}\nmsg\n${providerMessageId}`, "utf8").digest("hex");
}

const orgListed = (flags: HostChannelFlags, organizationId: string) => flags.orgIds === "*" || flags.orgIds.has(organizationId);

/**
 * Mesajı işlemeye al: yeni → işleniyor kirası; bitmiş → tekrar; kirası süren (ya da arada silinmiş) → meşgul. Kirası DOLMUŞ yarım iş, her
 * çağrının başındaki süpürmede silinir → yeniden deneme onu yeni mesaj gibi alır.
 */
async function claimInbound(name: string, now: Date): Promise<"claimed" | "duplicate" | "busy"> {
  try {
    await prisma.systemLock.create({ data: { name, holder: PROCESSING, lockedUntil: new Date(now.getTime() + INBOUND_LEASE_MS) } });
    return "claimed";
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
  const held = await prisma.systemLock.findUnique({ where: { name }, select: { holder: true } });
  return held?.holder === DONE ? "duplicate" : "busy";
}

export async function handleHostInbound(input: {
  provider: string;
  events: readonly HostInboundEvent[];
  flags: HostChannelFlags;
  transport: HostChannelTransport | null;
  now?: Date;
}): Promise<HostInboundResult> {
  const result = { processed: 0, duplicates: 0, ignored: 0, busy: 0 };
  const orgs = new Set<string>();
  const secret = hostChannelSecret();
  if (!input.flags.channel || !secret) return { ...result, ignored: input.events.length, organizationIds: [] };
  const now = input.now ?? new Date();
  let swept = false;

  for (const ev of input.events) {
    const digits = normalizeE164Digits(`+${ev.from}`);
    const row = digits
      ? await prisma.hostChannelBinding.findUnique({
          where: { provider_addressHash: { provider: input.provider, addressHash: addressHash(input.provider, digits, secret) } },
          select: { id: true, organizationId: true, status: true },
        })
      : null;
    if (!digits || !row || row.status === "revoked") {
      result.ignored++;
      continue;
    }
    const optOut = codeAnswerKind(ev) === "opt_out";
    if (!optOut && !orgListed(input.flags, row.organizationId)) {
      result.ignored++;
      continue;
    }

    if (!swept) {
      // Süresi dolmuş kilitler: 8 günü geçmiş bitmiş mesajlar + kirası dolmuş yarım işler (yeniden denemede baştan işlenir).
      swept = true;
      await prisma.systemLock.deleteMany({ where: { name: { startsWith: INBOUND_DEDUPE_PREFIX }, lockedUntil: { lt: now } } }).catch(() => {});
    }
    const name = inboundDedupeName(input.provider, ev.providerMessageId);
    const claim = await claimInbound(name, now);
    if (claim !== "claimed") {
      if (claim === "duplicate") result.duplicates++;
      else result.busy++;
      orgs.add(row.organizationId);
      continue;
    }

    try {
      let handled = true;
      const code = ev.kind === "text" ? extractBindingCode(ev.text) : null;
      if (code) {
        const confirmed = await confirmHostBindingFromInbound({ provider: input.provider, fromDigits: digits, code, now });
        if (confirmed.ok) await logEvent("host_channel.binding.verified", {}, { organizationId: confirmed.organizationId });
      } else if (optOut) {
        const revoked = await revokeHostBinding({ bindingId: row.id, organizationId: row.organizationId, reason: "opt_out", now });
        if (revoked) {
          await logEvent("host_channel.binding.opt_out", {}, { organizationId: row.organizationId });
          // Gönderim düşerse bağlantı yine kapalıdır; onay mesajı en iyi çaba.
          if (input.transport) await input.transport.sendText(digits, OPT_OUT_REPLY).catch(() => null);
        }
      } else if (row.status === "active") {
        // Ev sahibinin son yazdığı an — serbest metin penceresinin (24 saat) başlangıcı. Cevabın soruya bağlanması sonraki dilimde.
        await prisma.hostChannelBinding.updateMany({
          where: { id: row.id, organizationId: row.organizationId, status: "active" },
          data: { lastInboundAt: now },
        });
      } else {
        handled = false;
      }
      await prisma.systemLock.updateMany({
        where: { name, holder: PROCESSING },
        data: { holder: DONE, lockedUntil: new Date(now.getTime() + INBOUND_DEDUPE_TTL_MS) },
      });
      if (handled) {
        result.processed++;
        orgs.add(row.organizationId);
      } else {
        result.ignored++;
      }
    } catch (err) {
      // Yarıda düştü: kilit bırakılır, Meta'nın yeniden denemesi bu mesajı işler (silinemezse kira dolunca devralınır). Önceki mesajların
      // kilitleri kalır (tekrar işlenmez).
      await prisma.systemLock.deleteMany({ where: { name, holder: PROCESSING } }).catch(() => {});
      throw err;
    }
  }
  return { ...result, organizationIds: [...orgs] };
}
