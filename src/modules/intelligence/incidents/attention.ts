import "server-only";

import { prisma } from "@/lib/db";
import { isClosingHandled } from "@/lib/conversation-attention";
import { alertOnTransition } from "@/lib/alert-state";
import { findUpcomingConflicts, type UpcomingConflict } from "@/modules/availability/conflicts";
import { estimateConflictImpact, type MoneyImpact, type NightlyRateRange } from "@/modules/intelligence/money/impact";
import { loadNightlyRates } from "@/modules/intelligence/money/rates";

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
//  · calendar_conflict    — (09-24, müsaitlik motoru) önümüzdeki 60 gecede AYNI geceyi
//                           işgal eden iki rezervasyon. Hiçbir yazma yolu bunu engellemiyor,
//                           takvim sayfası gece başına mülk saydığı için GÖRÜNMÜYORDU.
//                           Motor arızası kartın geri kalanını düşürmez (ayrı `.catch`).
//
// 🚨 BİLEREK DIŞARIDA:
//  · KB boşlukları → `/knowledge`te zaten var (A3/A4). Çift kopya yasağı.
//  · Outbox → `DURABLE_OUTBOX_ENABLED` bilinçli kapalı; hep boş bir satır gürültüdür.
//  · Para etkisi → YALNIZ `calendar_conflict` satırında ve YALNIZ ev sahibinin girdiği tipik gecelik
//    aralıktan (V2, 09-24; `money/impact.ts`): tek nokta değer değil ARALIK + varsayım + güven.
//    `Reservation.totalAmount`/`currency` OKUNMAZ (tutar pratikte dolmuyor, para birimi uydurma "EUR"
//    olabiliyor; rezervasyonun brüt tutarı kayıp da değildir).
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
  "calendar_conflict",
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
function conversationHref(id: string, channel: string): string {
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
  /** Yalnız `calendar_conflict`: çakışan geceler, yarı açık [from, to) mülk takvim günleri. */
  nights?: { from: string; to: string };
  /** Yalnız `calendar_conflict`: iki satırın tarihleri birebir aynı — aynı konaklama olabilir. */
  possibleDuplicate?: boolean;
  /** Yalnız `calendar_conflict`: çakışmada onay bekleyen bir TALEP var (kesin çift rezervasyon değil). */
  heldRequest?: boolean;
  /** Yalnız `calendar_conflict`: bu mülkteki çakışma aralığı sayısı (satır EN ÖNEMLİSİNİ gösterir). */
  conflictCount?: number;
  /**
   * Yalnız `calendar_conflict`: risk altındaki tutar (ARALIK, varsayım, güven) ya da neden bilinmediği.
   * Sıralamaya GİRMEZ (önem kanıta göre kalır; paraya göre sıralama ayrı kurucu kararı).
   */
  money?: MoneyImpact;
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

  const [brokenFeeds, conversations, patterns, conflicts] = await Promise.all([
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
        // "Cevap gerekmedi" hâli (`conversation-attention.ts`): kapanışa bilerek sessiz kalınmış konuşma cevapsız değildir.
        status: true,
        skippedReason: true,
        autoReplyAttemptedAt: true,
        lastMessageAt: true,
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
    // Motorun kendi arızası öteki satırları düşürmez: bu bacak başarısızsa yalnız o yok. Arıza
    // SESSİZ de kalmaz: geçiş tabanlı alarm (aynı sınıf sürerken günde en fazla bir e-posta).
    findUpcomingConflicts(organizationId, { propertyIds, now }).catch((err): UpcomingConflict[] => {
      void alertOnTransition("attention:calendar-conflict", "attention calendar_conflict", err).catch(() => {});
      return [];
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
    // Misafirin son sözü yalnız teşekkür/kapanıştı ve bilerek cevap verilmedi — bekleyen iş değil.
    if (isClosingHandled(convo)) continue;

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

  // Çakışmalar MÜLK BAŞINA TEK satır (inceleme 09-24): köprü + aynı ilanın iCal'i birlikte beslenirse
  // gelecekteki HER konaklama bir çakışma aralığı üretir; aralık başına satır kartı doldurup tekrar eden
  // arıza satırlarını dışarı itiyordu. Satır mülkün EN ÖNEMLİ çakışmasını gösterir + toplam sayı.
  // Önem KANITA göre: iki taraflı kesin işgal 97 (misafir kapıda kalabilir) · onay bekleyen talep ya da
  // yalnız kanıtsız iddialar (hayalet satır olabilir) 70 · birebir aynı tarihli çift 45.
  const conflictRank = (c: UpcomingConflict): number =>
    c.possibleDuplicate ? 45 : c.anyHeld || c.allUnconfirmed ? 70 : 97;
  const worstByProperty = new Map<string, { c: UpcomingConflict; count: number }>();
  for (const c of conflicts) {
    const cur = worstByProperty.get(c.propertyId);
    if (!cur) {
      worstByProperty.set(c.propertyId, { c, count: 1 });
      continue;
    }
    cur.count++;
    const better = conflictRank(c) > conflictRank(cur.c) || (conflictRank(c) === conflictRank(cur.c) && c.from < cur.c.from);
    if (better) cur.c = c;
  }
  // Para etkisi için ev sahibinin aralıkları — YALNIZ çakışma varsa okunur (sakin günde ek sorgu yok). Okuma
  // arızası satırı düşürmez: tutar yalnız "bilinmiyor" olur; alarm geçiş tabanlı (kalıcı arızada günde bir).
  let rates = new Map<string, NightlyRateRange>();
  let ratesFailed = false;
  if (worstByProperty.size > 0) {
    rates = await loadNightlyRates(organizationId, [...worstByProperty.keys()]).catch((err): Map<string, NightlyRateRange> => {
      ratesFailed = true;
      void alertOnTransition("attention:money-rates", "attention money rates", err).catch(() => {});
      return new Map();
    });
  }
  for (const { c, count } of worstByProperty.values()) {
    const [y, m, d] = c.from.split("-").map(Number);
    const severity = conflictRank(c);
    items.push({
      kind: "calendar_conflict",
      // Satırlar BİZİM kayıtlarımız: çakışma gözlemdir — ancak iddiaların hiçbiri taze kaynaktan ya da
      // host girişinden gelmiyorsa satırlardan biri hayalet olabilir → çıkarım.
      certainty: c.allUnconfirmed ? "inferred" : "observed",
      propertyId: c.propertyId,
      propertyName: nameById.get(c.propertyId) ?? "",
      severity,
      occurredAt: new Date(Date.UTC(y, m - 1, d)),
      href: `/calendar?property=${encodeURIComponent(c.propertyId)}&month=${c.from.slice(0, 7)}`,
      nights: { from: c.from, to: c.to },
      possibleDuplicate: c.possibleDuplicate,
      heldRequest: c.anyHeld,
      conflictCount: count,
      ...(ratesFailed
        ? {}
        : {
            money: estimateConflictImpact(
              {
                overlapNights: c.overlapNights,
                longestStayNights: c.longestStayNights,
                possibleDuplicate: c.possibleDuplicate,
                heldRequest: c.anyHeld,
                allUnconfirmed: c.allUnconfirmed,
              },
              rates.get(c.propertyId),
              now,
            ),
          }),
    });
  }

  items.sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    // Eşit önemde ESKİ olan üstte: daha uzun süredir bekliyor.
    return a.occurredAt.getTime() - b.occurredAt.getTime();
  });
  return items.slice(0, ATTENTION_MAX_ITEMS);
}
