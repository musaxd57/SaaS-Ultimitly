import "server-only";

import { prisma } from "@/lib/db";
import { readOutboundThread, resolveOutboundRoute } from "@/lib/channels";
import { matchSendInThread, normalizeForReconcile, type ReconcileMatch } from "./reconcile-match";

// ---------------------------------------------------------------------------
// BELİRSİZ GÖNDERİMİ KANALDAN DOĞRULA — OKUMA + KARAR (kurucu 11-19 AK-1 / KU-1; tasarım
// `docs/TASARIM-2026-11-19-belirsiz-gonderimi-lixus-kendisi-dogrular.md`). Kuyruk uzlaştırması (`worker.ts defaultReconcile`) ve doğrudan
// yol (`host-send.ts`, belirsiz sonuçtan hemen sonra tek bakış) AYNI kuralı kullanır. Kanal katmanından okur (çekirdek sağlayıcıyı görmez),
// karar saf (`reconcile-match.ts`). Asla fırlatmaz. Sonuç ne olursa olsun çağıran YENİDEN GÖNDERMEZ.
// ---------------------------------------------------------------------------

export type ChannelReconcileResult = ReconcileMatch | { found: false; evidence: "unreadable" };

/**
 * Anahtar (VARSAYILAN KAPALI, yalnız "1"; açılışta açılır): kapalıyken kanal OKUNMAZ — kuyruk ve doğrudan yol bugünkü gibi davranır
 * (belirsiz → inceleme / "doğrulanamadı"). Kapalı doğmasının sebebi: kanal okuması ağa çıkar; açılış belgesinde sırası var.
 */
export function channelSendReconcileEnabled(): boolean {
  return process.env.CHANNEL_SEND_RECONCILE_ENABLED === "1";
}

export async function reconcileSendFromChannel(input: {
  organizationId: string;
  externalReservationId: string | null;
  body: string;
  /** Gönderim başlangıcı (kuyrukta "dış gönderim başladı" işareti; doğrudan yolda gönder'e basılan an). */
  anchor: Date;
  token: string | undefined;
  /** Bu gönderimin KENDİ yerel mesajı / kuyruk satırı (kendi kimliği "başka kayıt" sayılmasın). */
  ownMessageId?: string | null;
  ownOutboxId?: string | null;
}): Promise<ChannelReconcileResult> {
  try {
    const route = resolveOutboundRoute({ externalReservationId: input.externalReservationId });
    if (route.kind !== "external") return { found: false, evidence: "unreadable" };
    const read = await readOutboundThread(route.destination, { provider: route.destination.provider, token: input.token });
    if (!read || !read.ok) return { found: false, evidence: "unreadable" };
    // "Başka kayda ait" kimlikler: yalnız metni eşleşen adayların kimlikleri sorulur (sorgu küçük kalır).
    const want = normalizeForReconcile(input.body);
    const candidateIds = read.messages
      .filter((m) => m.direction === "outbound" && m.externalId && typeof m.body === "string" && normalizeForReconcile(m.body) === want)
      .map((m) => m.externalId as string);
    const taken = new Set<string>();
    if (candidateIds.length > 0) {
      const [otherRows, localMessages] = await Promise.all([
        prisma.messageOutbox.findMany({
          where: {
            organizationId: input.organizationId,
            providerMessageId: { in: candidateIds },
            ...(input.ownOutboxId ? { NOT: { id: input.ownOutboxId } } : {}),
          },
          select: { providerMessageId: true },
        }),
        prisma.message.findMany({
          where: {
            externalId: { in: candidateIds },
            // YALNIZ Lixus'un yazdığı satır (teslim yolu dolu): senkronun kanaldan içe aldığı satır (yol NULL) "başka kayıt" DEĞİLDİR — çoğu
            // zaman bu gönderimin kendi yankısıdır (senkron 2 dk'da bir koşar, uzlaştırma ~31 dk sürer; G1 11-19). Kanaldan elle yazılmış aynı
            // metin de misafire ulaşmıştır (tasarım §2). Başka bir LİXUS gönderimi ya kuyruk satırında ya teslim yolu dolu satırda durur.
            deliveryPath: { not: null },
            conversation: { externalReservationId: input.externalReservationId, property: { organizationId: input.organizationId } },
            ...(input.ownMessageId ? { NOT: { id: input.ownMessageId } } : {}),
          },
          select: { externalId: true },
        }),
      ]);
      for (const r of otherRows) if (r.providerMessageId) taken.add(r.providerMessageId);
      for (const m of localMessages) if (m.externalId) taken.add(m.externalId);
    }
    return matchSendInThread({ body: input.body, anchor: input.anchor, messages: read.messages, taken });
  } catch {
    return { found: false, evidence: "unreadable" };
  }
}
