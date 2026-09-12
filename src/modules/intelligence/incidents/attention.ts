import "server-only";

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// V2.1 — "DİKKAT GEREKTİRENLER". Salt-okuma; hiçbir şey YAZMAZ, migration İSTEMEZ.
//
// NEREDEN GELDİ: panelin kendi kodundaki not (dashboard/page.tsx, "AI günlük
// özet" kartı kaldırılırken): gerçek bir özet "kutucukların GÖSTEREMEDİĞİ
// şeyleri söylemeli (tekrar eden arıza, cevapsız kalıp çıkışı yaklaşan misafir)
// ve SAKİN GÜNDE HİÇ GÖRÜNMEMELİ". O not önbellek tablosu = migration diyordu;
// HESAPLANAN bir görünüm ise mevcut kolonlarla yetiniyor.
//
// 🚨 DÖRT SATIR TÜRÜ, HEPSİ BUGÜN GÖRÜNMEYEN BİR GERÇEK:
//  · feed_broken          — `CalendarSource.lastStatus="error"` bugün YALNIZ tek
//                           tek mülk sayfasında görünüyor; 10 dairelik portföyde
//                           sessizce rezervasyon kaçıran besleme fark edilmiyor.
//  · departing_unanswered — panelin notunun adıyla andığı bileşik durum.
//  · unanswered_aging     — mesaj YAŞI hiçbir yüzeyde yok; "Bekleyen Mesajlar"
//                           kartı YENİDEN eskiye sıralayıp 5 alıyor, yani EN ESKİ
//                           cevapsız mesaj görünmeyen tek şey.
//  · recurring_issue      — V1 örüntü hafızası; bugün yalnız mülk sayfasında.
//
// 🚨 BİLEREK DIŞARIDA:
//  · KB boşlukları → `/knowledge`te zaten var (A3/A4). Çift kopya yasağı.
//  · Outbox → `DURABLE_OUTBOX_ENABLED` bilinçli kapalı; hep boş bir satır gürültüdür.
//  · Para etkisi → AYRI SÖZLEŞME. `Reservation.totalAmount` rezervasyonun brüt
//    tutarıdır, kayıp DEĞİL; ikisini aynı kolona bağlamak sahte kesinlik üretirdi.
//
// 🚨 TEK BİR `decisive: false` BAYRAĞI BU DÖRDÜ İÇİN DÜRÜST OLMAZDI: bozuk
// besleme ile cevapsız mesaj GÖZLEMDİR (senkronun/mesajın kendi kaydı), tekrar
// eden arıza ise kelime ağıyla sınıflandırılmış sinyallerden ÇIKARIMDIR. Bu
// yüzden satır başına `certainty` taşınır ve arayüz sözünü ona göre kurar.
// ---------------------------------------------------------------------------

export const ATTENTION_KINDS = [
  "feed_broken",
  "departing_unanswered",
  "unanswered_aging",
  "recurring_issue",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** `observed` = biz kaydettik · `inferred` = sınıflandırmadan türedi. */
export type AttentionCertainty = "observed" | "inferred";

/** Bu kadar saattir cevapsız bir misafir mesajı listeye girer. */
export const UNANSWERED_HOURS = 6;
/** Çıkışı yaklaşan misafirde eşik daha DAR: gitmeden önce cevap gerekiyor. */
export const DEPARTING_UNANSWERED_HOURS = 2;
/** "Çıkışı yaklaşan" penceresi. */
export const DEPARTURE_SOON_HOURS = 24;
/** Örüntü bu kadar gün içinde SON KEZ gözlendiyse hâlâ güncel sayılır. */
export const RECURRING_FRESH_DAYS = 30;
/**
 * Konuşma tarama penceresi. Bundan eski hiç dokunulmamış bir konuşma "bugünün
 * dikkati" değildir — hiç unutmayan bir liste duvar kâğıdına döner.
 */
export const ATTENTION_WINDOW_DAYS = 30;
/** Liste tavanı: dikkat çekmek için kısa kalmak zorunda. */
export const ATTENTION_MAX_ITEMS = 8;
/** Tek sorguda incelenecek en fazla konuşma (sınırsız tarama yok). */
export const CONVERSATION_CANDIDATE_CAP = 200;

/**
 * KONUŞMANIN KENDİ YÜZEYİ (kurucu bildirimi 09-12: "normalde qr sohbeti ama
 * ordan tıklayınca mesajlar sekmesinde açıyor sohbeti").
 *
 * 🚨 Bu satırlar eskiden KOŞULSUZ `/inbox/${id}` üretiyordu ve sorgu `channel`
 * alanını SEÇMİYORDU bile. Panel, QR sohbetini kanal (Airbnb) yüzeyinin
 * arkasına koyuyordu — üstelik iki yüzeyin İŞLEVLERİ farklı: "AI yanıtlarını
 * yeniden başlat" düğmesi, "siz yanıtlarsanız AI susar" ön uyarısı ve
 * "İnsan desteğinde" rozeti YALNIZ `/guest-chats/[id]` üzerinde var. Yani
 * host, AI'ı geri açamadığı ve sustuğunu söylemeyen bir ekranda açıyordu.
 *
 * Ayrım ürünün başka yerinde ZATEN yaşıyor: gelen kutusu listesi QR'ı
 * `channel: { not: "chat" }` ile dışlar, QR konuşmaları `channel: "chat"`
 * doğar. Burada aynı ayrımı kullanıyoruz — yeni bir kavram icat etmiyoruz.
 *
 * ⚠️ Yalnız YÖNLENDİRME. Inbox'tan bir QR konuşmasına yazmak BUGÜN DE
 * çalışıyor (mesaj `local` rotayla kalıcı yazılır, misafir onu görür, AI
 * duraklatması da tetiklenir); o yol kapatılmadı — host artık oraya
 * YANLIŞLIKLA düşmüyor.
 */
function conversationHref(id: string, channel: string | null): string {
  return channel === "chat" ? `/guest-chats/${id}` : `/inbox/${id}`;
}

export interface AttentionItem {
  kind: AttentionKind;
  certainty: AttentionCertainty;
  propertyId: string;
  propertyName: string;
  /** Sıralama anahtarı; büyük olan üstte. Bir "puan" değil, sadece sıra. */
  severity: number;
  /** Satırın dayandığı OLAYIN zamanı. */
  occurredAt: Date;
  /** Host'un gideceği yer (göreli yol; mutlak URL kurulmaz). */
  href: string;
  /** Yalnız cevapsız satırlarda: kaç saattir bekliyor (aşağı yuvarlanmış). */
  hoursWaiting?: number;
  /** Yalnız `feed_broken`: host'un verdiği ETİKET. 🚨 URL ASLA taşınmaz. */
  sourceLabel?: string;
  /** Yalnız `recurring_issue`: kapalı-küme kategori kodu (PII yok). */
  category?: string;
  /** Yalnız `recurring_issue`: örüntüyü besleyen sinyal sayısı. */
  evidenceCount?: number;
}

export interface FindAttentionOptions {
  /** Tek mülke daralt. */
  propertyId?: string;
  /** Deterministik test için "şimdi". */
  now?: Date;
}

const HOUR = 3_600_000;

function evidenceCount(json: string): number {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Mülk × olay bazında "şu an dikkat isteyen" satırları hesaplar.
 *
 * SAKİN GÜNDE BOŞ DİZİ döner — çağıran hiçbir şey çizmemelidir.
 */
export async function findAttentionItems(
  organizationId: string,
  options: FindAttentionOptions = {},
): Promise<AttentionItem[]> {
  const now = options.now ?? new Date();
  const scope = options.propertyId ? { id: options.propertyId } : {};

  const properties = await prisma.property.findMany({
    where: { organizationId, ...scope },
    select: { id: true, name: true },
  });
  if (properties.length === 0) return [];
  const propertyIds = properties.map((p) => p.id);
  const nameById = new Map(properties.map((p) => [p.id, p.name]));

  const windowStart = new Date(now.getTime() - ATTENTION_WINDOW_DAYS * 24 * HOUR);
  const recurringSince = new Date(now.getTime() - RECURRING_FRESH_DAYS * 24 * HOUR);

  const [brokenFeeds, conversations, patterns] = await Promise.all([
    prisma.calendarSource.findMany({
      where: { propertyId: { in: propertyIds }, lastStatus: "error" },
      // 🚨 `url` ve `urlEnc` BİLEREK SEÇİLMİYOR: besleme adresi sorgu dizesinde
      // kimlik bilgisi taşır, yani bir SIRDIR. Panele hiçbir biçimde çıkmaz.
      select: { id: true, propertyId: true, label: true, lastSyncedAt: true, updatedAt: true },
    }),
    // 🚨 `lastMessageAt` bir CEVAPSIZLIK ÖLÇÜSÜ DEĞİLDİR: `resume-ai` rotası
    // sistem olayı yazarken onu ŞİMDİ'ye çekiyor. O alana göre "eski mi" diye
    // sormak, cevapsız kalmış gerçek bir misafir mesajını KAÇIRIRDI. Burada
    // yalnızca pencereyi daraltmak için kullanılıyor; karar GÖRÜNÜR SON
    // MESAJDAN veriliyor (aşağıda).
    prisma.conversation.findMany({
      where: { propertyId: { in: propertyIds }, lastMessageAt: { gte: windowStart } },
      orderBy: { lastMessageAt: "asc" },
      take: CONVERSATION_CANDIDATE_CAP,
      select: {
        id: true,
        propertyId: true,
        // 🚨 Kanal, BAĞLANTIYI belirler (↓ `conversationHref`). Eskiden bu alan
        // seçilmiyordu bile ve href sabit `/inbox/${id}` idi — QR sohbetleri
        // kanal yüzeyinin arkasına düşüyordu.
        channel: true,
        reservation: { select: { departureDate: true, status: true } },
        messages: {
          // Misafirin GÖRMEDİĞİ satırlar (sistem olayı, gövdesiz) mesaj sayılmaz.
          where: { systemEventType: null, NOT: { body: "" } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { direction: true, createdAt: true },
        },
      },
    }),
    prisma.propertyMemory.findMany({
      where: {
        organizationId,
        propertyId: { in: propertyIds },
        status: "active",
        // Yalnız SİNYALDEN türeyen örüntü; KB'den gelen hafıza bir arıza değildir.
        source: "signal_pattern",
        observedAt: { gte: recurringSince },
      },
      select: { propertyId: true, category: true, observedAt: true, evidenceJson: true },
    }),
  ]);

  const items: AttentionItem[] = [];

  for (const feed of brokenFeeds) {
    items.push({
      kind: "feed_broken",
      certainty: "observed",
      propertyId: feed.propertyId,
      propertyName: nameById.get(feed.propertyId) ?? "",
      severity: 100,
      occurredAt: feed.lastSyncedAt ?? feed.updatedAt,
      href: `/properties/${feed.propertyId}`,
      sourceLabel: feed.label,
    });
  }

  const departureCutoff = new Date(now.getTime() + DEPARTURE_SOON_HOURS * HOUR);
  for (const convo of conversations) {
    const last = convo.messages[0];
    // Görünür mesajı olmayan ya da son sözü BİZDE olan konuşma cevapsız değildir.
    if (!last || last.direction !== "inbound") continue;

    const waitedMs = now.getTime() - last.createdAt.getTime();
    if (waitedMs < 0) continue;
    const hoursWaiting = Math.floor(waitedMs / HOUR);

    const departure = convo.reservation?.departureDate ?? null;
    const departingSoon =
      departure !== null &&
      (convo.reservation?.status === "confirmed" || convo.reservation?.status === "completed") &&
      departure >= now &&
      departure <= departureCutoff;

    if (departingSoon) {
      if (hoursWaiting < DEPARTING_UNANSWERED_HOURS) continue;
      items.push({
        kind: "departing_unanswered",
        certainty: "observed",
        propertyId: convo.propertyId,
        propertyName: nameById.get(convo.propertyId) ?? "",
        // 🚨 SIRA YAŞA GÖRE DEĞİL ÖNEME GÖRE: misafir gidiyor, cevabın değeri
        // saat başı düşüyor. Tabanı `unanswered_aging`in TAVANININ üstünde.
        severity: 90 + Math.min(9, hoursWaiting),
        occurredAt: last.createdAt,
        href: conversationHref(convo.id, convo.channel),
        hoursWaiting,
      });
      continue;
    }

    if (hoursWaiting < UNANSWERED_HOURS) continue;
    items.push({
      kind: "unanswered_aging",
      certainty: "observed",
      propertyId: convo.propertyId,
      propertyName: nameById.get(convo.propertyId) ?? "",
      severity: 50 + Math.min(39, hoursWaiting),
      occurredAt: last.createdAt,
      href: conversationHref(convo.id, convo.channel),
      hoursWaiting,
    });
  }

  for (const p of patterns) {
    items.push({
      kind: "recurring_issue",
      // 🚨 ÇIKARIM: sinyaller kelime ağıyla sınıflandırıldı (Türkçe olumsuz fiil
      // boşluğu ÖLÇÜLMÜŞ bir açıktır) → "gözlem" demek sahte kesinlik olurdu.
      certainty: "inferred",
      propertyId: p.propertyId,
      propertyName: nameById.get(p.propertyId) ?? "",
      severity: 30,
      occurredAt: p.observedAt,
      href: `/properties/${p.propertyId}`,
      category: p.category,
      evidenceCount: evidenceCount(p.evidenceJson),
    });
  }

  items.sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    // Eşit önemde ESKİ olan üstte: daha uzun süredir bekliyor.
    return a.occurredAt.getTime() - b.occurredAt.getTime();
  });
  return items.slice(0, ATTENTION_MAX_ITEMS);
}
