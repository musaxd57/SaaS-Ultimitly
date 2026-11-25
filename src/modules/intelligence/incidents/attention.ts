import "server-only";

import { prisma } from "@/lib/db";
import { isClosingHandled } from "@/lib/conversation-attention";
import { alertOnTransition } from "@/lib/alert-state";
import { findUpcomingConflicts, findUpcomingConflictsAndGaps, type UpcomingConflict, type UpcomingGap } from "@/modules/availability/conflicts";
import { estimateConflictImpact, type MoneyImpact, type NightlyRateRange } from "@/modules/intelligence/money/impact";
import { loadNightlyRates } from "@/modules/intelligence/money/rates";
import { heldRequestsByConversation, type HeldRequestSummary } from "@/lib/conversation-items/store";
import type { ItemKind } from "@/lib/conversation-items/core";
import { notAutomationMessageWhere } from "@/lib/message-author";
import { addZonedDays, dateKeyInTimeZone, orgTimezone } from "@/lib/timezone";
import { reservationDayRangeWhere } from "@/lib/day-where";
import { addNights, calendarDateOf, todayKey } from "@/modules/availability/core";
import { hostDecisionsEnabled } from "@/lib/decisions/flag";
import { openDecisionsForOrg, type DecisionView } from "@/lib/decisions/store";
import { decisionTitle } from "@/lib/decisions/core";
import {
  COMMITMENT_REMIND_AFTER_MIN,
  commitmentLateAt,
  hostCommitmentAutoEnabled,
  isCommitmentKind,
  storedCommitmentWhen,
  type CommitmentKind,
} from "@/lib/guest-commitments-core";
import { connectionHealth, connectionNeedsAttention } from "@/lib/channels/health";
import { isFounderOrg } from "@/lib/billing/subscription";
import type { IngestErrorKind } from "@/lib/channels/ingest";
import { REACTIVATION_ATTENTION_DAYS, REACTIVATION_BLOCKED_FIELD } from "@/lib/ingest/reactivation";
import { PROVIDER_OUTAGE_REASON } from "@/lib/outbox/state";
import { hasRecipientWhere } from "@/lib/internal-record";
import { activeBookingConflicts, BOOKING_CONFLICT_ROW_CAP, type ActiveBookingConflict } from "@/lib/booking-property-conflict";
import { autoSendStoppedByConflict } from "@/lib/booking-conflict-auto-send";
import { isClockText, type DepartureOpen, type DepartureTopic } from "@/modules/intelligence/incidents/departure-open";

// ---------------------------------------------------------------------------
// V2.1 — "DİKKAT GEREKTİRENLER". Salt-okuma; hiçbir şey YAZMAZ (okuduğu tablolar başka dilimlerin migration'larıyla geldi).
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
//  · held_request         — (09-26, konuşma öğeleri) misafirin ev sahibine BIRAKILAN hassas isteği (IBAN, şikâyet, iade,
//                           ev sahibiyle görüşme…): güvenli kısmı cevaplanmış konuşma "Cevaplandı" görünür; iş burada
//                           görünür kalır. Konuşma başına TEK satır; aynı konuşmanın "cevapsız" satırının yerini alır.
//  · decision_pending     — (10-02, Host Karar Motoru, `HOST_DECISIONS_ENABLED`) ev sahibinin KARARINI bekleyen konaklama isteği
//                           ("13:00 erken giriş"). Kurucu: "panelde 'karar bekliyor' açık kalır". Karar başına satır; aynı
//                           konuşmanın "cevapsız" satırının yerini alır.
//  · channel_reactivation — (10-13, G9) kanal İPTALLİ bir rezervasyonu yeniden etkin gösterdi; satır iptal tutuldu (kendiliğinden
//                           geri açılmaz), ev sahibi kanaldan kontrol eder.
//  · booking_two_properties — (kurucu 11-18 akşam) aynı kanal rezervasyonu iki FARKLI dairede etkin kayıtlı: otomatik mesajlar
//                           tutuluyor (`booking-property-conflict.ts`, sistem daire tahmin etmez); ev sahibi yanlış kaydı kaldırır.
//                           Rezervasyon başına TEK satır; tutma ile AYNI yüklem. Kartta en çok 3 satır (UA-1, fazlası sayıyla);
//                           bağlantı "Kayıtları karşılaştır" sayfası.
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
  "held_request",
  "decision_pending",
  "commitment_due",
  "connection_unhealthy",
  "booking_gap",
  "channel_reactivation",
  "provider_outage",
  "booking_two_properties",
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

/**
 * Çıkış "yakın" mı (Tur 5, 11-05, ölçüldü). Ham `departure >= şimdi` kıyası tarih-yalnız çapada (Hospitable çıkışı D 00:00Z = İstanbul
 * 03:00) çıkış GÜNÜ sabahından itibaren "geçti" diyordu: çıkış günü cevap bekleyen misafirin "Çıkışı yaklaşan" satırı hiç çıkmıyordu
 * (aynı gün iCal saatli kayıtta çıkıyordu). Tarih-yalnız çapa → işletme gününe göre çıkış günü BUGÜN ya da YARIN (çıkış günü boyunca
 * "bitmedi", `stayEndedBefore` ile aynı); gerçek an (saatli kayıt) → eski 24 saat penceresi aynen.
 */
export function departingWithinSoonWindow(departure: Date, now: Date, timeZone: string): boolean {
  const { key, anchor } = calendarDateOf(departure, timeZone);
  if (anchor === "instant") return departure >= now && departure.getTime() <= now.getTime() + DEPARTURE_SOON_HOURS * HOUR;
  const today = todayKey(now, timeZone);
  return key >= today && key <= addNights(today, 1);
}
/** Örüntü bu kadar gün içinde SON KEZ gözlendiyse hâlâ güncel sayılır. */
export const RECURRING_FRESH_DAYS = 30;
/**
 * Konuşma tarama penceresi. Bundan eski hiç dokunulmamış bir konuşma "bugünün
 * dikkati" değildir — hiç unutmayan bir liste duvar kâğıdına döner.
 */
export const ATTENTION_WINDOW_DAYS = 30;
/** Misafire verilen söz bu kadar saat kala listeye girer (geçmiş olan her zaman). */
export const COMMITMENT_HORIZON_HOURS = 24;
/** Bu kadar saatten az kalmış söz "yaklaşıyor" sayılır (daha üstte). */
export const COMMITMENT_SOON_HOURS = 2;
/** Bundan eski gecikmiş söz listeye girmez (unutulmuş söz kartı süresiz doldurmasın — Haiku incelemesi; söz konuşma kartında kalır). */
export const COMMITMENT_STALE_HOURS = 48;
/** En fazla bu kadar söz satırı (öteki dikkat satırlarını dışarı itmesin). */
export const COMMITMENT_MAX_ROWS = 3;
/** Söz satırı adayı olarak okunan en çok satır (önem sırasıyla `COMMITMENT_MAX_ROWS` seçilir). */
export const COMMITMENT_SCAN_ROWS = 200;

/** Sağlayıcı arızası satırı bu kadar saat içinde bu sebeple bekleyen konuşmaları sayar (G10). */
export const PROVIDER_OUTAGE_WINDOW_HOURS = 48;

/** Liste tavanı: dikkat çekmek için kısa kalmak zorunda. */
export const ATTENTION_MAX_ITEMS = 8;

/**
 * "İki dairede kayıtlı" satırının kart içi tavanı (UA-1, kurucu 11-19): en yakın varışlı bu kadar rezervasyon satır olur; fazlası son
 * satırın alt satırında "· N rezervasyon daha" (öteki türlerin "· N … daha" kalıbı). Toplu bir eşleştirme hatası kartı tek başına
 * doldurmasın (öteki satırlar `ATTENTION_MAX_ITEMS` dışına itilirdi).
 */
export const BOOKING_TWO_PROPERTIES_PANEL_CAP = 3;

/**
 * V2 boşluk satırı anahtarı (kurucu talimatı 09-07 "REVENUE LEAK · 2-night gap" örneği). VARSAYILAN KAPALI: satır metni ve önemi
 * kurucu onayı bekliyor (`docs/hazir-yamalar/` önerisi). Yalnız "1" açar (`STRICT_ONE_FLAGS`).
 */
export function attentionGapEnabled(): boolean {
  return process.env.ATTENTION_GAP_ENABLED === "1";
}
/** Boşluk satırının önemi: fırsat, risk değil — risk satırlarının (çakışma, söz, cevapsız) ALTINDA; yakın boşluk öne. */
export const GAP_SEVERITY_SOON = 35;
export const GAP_SEVERITY_LATER = 25;
/** Bu kadar gün içinde başlayan boşluk "yakın" sayılır. */
export const GAP_SOON_DAYS = 7;
/** Komşularından biri kanıtsız boşluğun önem düşüşü. */
export const GAP_UNCONFIRMED_PENALTY = 5;
/** Tek sorguda incelenecek en fazla konuşma (sınırsız tarama yok). */
export const CONVERSATION_CANDIDATE_CAP = 200;
/** "En uzun bekleyen" okumasının durumları (cevaplanmış konuşma o okumanın tavanını doldurmasın). `answered` YOK: QR konuşmaları en yeni okumadan gelir. */
export const OPEN_CANDIDATE_STATUSES = ["new", "waiting", "problem", "closed"] as const;

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
  /** `calendar_conflict`: çakışan geceler · `booking_gap`: boş geceler — yarı açık [from, to) mülk takvim günleri. */
  nights?: { from: string; to: string };
  /** Yalnız `booking_gap`: bu mülkteki yetim boşluk sayısı (satır EN YAKININI gösterir). */
  gapCount?: number;
  /** Yalnız `calendar_conflict`: iki satırın tarihleri birebir aynı — aynı konaklama olabilir. */
  possibleDuplicate?: boolean;
  /** Yalnız `calendar_conflict`: çakışmada onay bekleyen bir TALEP var (kesin çift rezervasyon değil). */
  heldRequest?: boolean;
  /** Yalnız `calendar_conflict`: bu mülkteki çakışma aralığı sayısı (satır EN ÖNEMLİSİNİ gösterir). */
  conflictCount?: number;
  /**
   * Yalnız `calendar_conflict`: risk altındaki tutar (ARALIK, varsayım, güven) ya da neden bilinmediği.
   * Sıralamaya GİRMEZ (önem kanıta göre kalır; paraya göre sıralama ayrı kurucu kararı). `booking_gap` tutar TAŞIMAZ (kurucu 10-11:
   * gerçek gecelik fiyat Airbnb Direct takviminden gelince — uydurma / tahmini değer yok).
   */
  money?: MoneyImpact;
  /** Yalnız `held_request`: bırakılan isteklerin türleri (en eskiden yeniye, tekil) ve toplam sayısı. */
  requestKinds?: ItemKind[];
  requestCount?: number;
  /** Yalnız `decision_pending`: kart başlığı ("13:00 erken giriş"; misafir metni değil). */
  decisionTitle?: string;
  /** Yalnız `decision_pending`: karar mesajının gönderimi doğrulanamadı (karar verildi; ulaşıp ulaşmadığı kontrol edilmeli). */
  decisionUnverified?: boolean;
  /** Yalnız `commitment_due`: söz türü (kapalı küme; METİN değil). */
  commitmentKind?: CommitmentKind;
  /** Yalnız `commitment_due`: sözün konusu (I1, kapalı küme kod; "klima"); yoksa null. */
  commitmentTopic?: string | null;
  /** Yalnız `commitment_due`: son ana kalan dakika (eksi = gecikti). */
  minutesLeft?: number;
  /** Yalnız `commitment_due`: son an, işletmenin saatiyle ("18:00" ya da "yarın 10:00"). */
  commitmentTime?: string;
  /** Yalnız `commitment_due`: açık saatli söz mü (dilim / gün sözünde kalan süre gösterilmez — pencere sonu ev sahibine söylenmez, O12). */
  commitmentPrecise?: boolean;
  /**
   * Aynı konuşmada aynı ana düşen iki satırı ayıran kararlı kimlik (React anahtarı) — `commitment_due`: söz kimliği (gece-4 S1-15: "klima
   * 18:00" ile "musluk 18:00" aynı anahtarı alıyordu; bir satır yenilemede kaybolabiliyordu). Ekranda gösterilmez.
   */
  rowKey?: string;
  /** Yalnız `commitment_due`: 1 günden uzun açık — TEK hatırlatma metni (söz → görev otomatik açıkken; kurucu 10-17 "Hatırlat, kapatma"). */
  commitmentReminder?: boolean;
  /** Yalnız `connection_unhealthy` (işletme düzeyi satır, mülksüz): son hatalı okumanın türü (bayat okumada yok). */
  connectionErrorKind?: IngestErrorKind;
  /** Yalnız `connection_unhealthy`: son başarılı okumadan bu yana dakika (hiç yoksa yok). */
  minutesSinceOk?: number;
  /** Yalnız `provider_outage` (işletme düzeyi): sağlayıcı arızası yüzünden teslimi doğrulanamayan konuşma sayısı. */
  waitingCount?: number;
  /** Yalnız `channel_reactivation`: "yeniden aç" düğmesinin hedefi (H2). */
  reservationId?: string;
  /** Yalnız `booking_two_properties`: etkin kaydı olan dairelerin adları (en az iki, ada göre sıralı). */
  bookingPropertyNames?: string[];
  /** Yalnız `booking_two_properties`: misafirin varış günü, işletmenin takviminde (YYYY-AA-GG). */
  arrivalDay?: string;
  /** Yalnız `booking_two_properties`, kart tavanındaki SON satırda: satır olmayan öteki çakışan rezervasyon sayısı (> 0). */
  bookingMoreCount?: number;
  /**
   * Yalnız `booking_two_properties`: tutma bu rezervasyonda GERÇEKTEN bir otomatik mesajı durduruyor (kurucu 11-20 sabah B-1; yüklem
   * `lib/booking-conflict-auto-send.ts`). Yoksa (durdurmuyor ya da okunamadı) "Otomatik gönderim durduruldu" yazılmaz.
   */
  autoSendStopped?: boolean;
  /**
   * Yalnız `departing_unanswered`, ÇIKIŞTAN ÖNCE AÇIK KONU birleşik satırı (plan madde 7, `docs/TASARIM-2026-11-25-cikistan-once-acik-konu.md`):
   * çıkışı penceredeki konaklamanın açık konuları (bırakılan istek · açık söz · Sorunlu) — o konaklamanın istek / söz / cevapsız satırları
   * bu satıra toplanır (aynı konu iki satırda görünmez). Yoksa satır bugünkü "çıkışı yaklaşan misafir cevap bekliyor" satırıdır.
   */
  departureOpen?: DepartureOpen;
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
    select: { id: true, name: true, checkOutTime: true },
  });
  if (properties.length === 0) return [];
  const propertyIds = properties.map((p) => p.id);
  const nameById = new Map(properties.map((p) => [p.id, p.name]));
  const checkOutTimeById = new Map(properties.map((p) => [p.id, p.checkOutTime]));

  const windowStart = new Date(now.getTime() - ATTENTION_WINDOW_DAYS * 24 * HOUR);
  const recurringSince = new Date(now.getTime() - RECURRING_FRESH_DAYS * 24 * HOUR);

  // İşletmenin saat dilimi (optimizasyon turu 11-19): yine YALNIZ gerektiğinde okunur (sakin günde ek sorgu yok), ama bir istekte en çok BİR
  // kez — eskiden her tüketici (karar, çıkış günü, söz saati, boşluk, iki daire, yeniden etkinleşme) aynı satırı yeniden okuyordu (ölçüldü:
  // üç-beş okuma). Başarısız okuma saklanmaz: sonraki tüketici bugünkü gibi yeniden dener (bacakların arıza yalıtımı aynı kalır).
  let tzRead: Promise<string | null | undefined> | null = null;
  const storedTimezone = (): Promise<string | null | undefined> =>
    (tzRead ??= prisma.organization
      .findUnique({ where: { id: organizationId }, select: { timezone: true } })
      .then((o) => o?.timezone)
      .catch((err: unknown) => {
        tzRead = null;
        throw err;
      }));

  // Karar kartları yalnız bayrak açıkken (kapalıyken sorgu yok). Org dilimi: "gün geçti" türetmesi için. Öğe özetinden ÖNCE
  // okunur: açık karta bağlı öğe "bırakılan istek" satırında İKİNCİ kez sayılmaz (aynı talep, karar satırı daha özgül).
  const decisionTz = hostDecisionsEnabled() ? orgTimezone(await storedTimezone()) : null;
  const decisions = decisionTz
    ? await openDecisionsForOrg(prisma, { organizationId, timeZone: decisionTz, now }).catch((err): DecisionView[] => {
        void alertOnTransition("attention:decision-pending", "attention decision_pending", err).catch(() => {});
        return [];
      })
    : [];
  const decisionItemIds = decisions.map((d) => d.itemId).filter((v): v is string => v !== null);
  // 🚀 Bütün bacaklar aynı turda (optimizasyon turu 11-19; ölçüm `tests/integration/request-path-queries.test.ts`): bağlantı sağlığı,
  // sağlayıcı arızası, iki dairede kayıt ve yeniden etkinleşme okumaları eskiden bu turdan SONRA tek tek bekleniyordu — hiçbiri bu turun
  // sonucuna bakmıyor. Her bacağın kendi `.catch`i ve alarmı aynen (biri düşerse yalnız o satır türü yok); satırlar aşağıda AYNI SIRAYLA
  // eklenir (eşit önem + eşit anda sıralama ekleme sırasını korur).
  const [brokenFeeds, conversations, patterns, calendarScan, commitments, held, connections, outageCount, twoProperties, reactivated] = await Promise.all([
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
    // Tur 5 (11-05, ölçüldü): tek "en eski önce" okuması, 30 günde 200'den fazla konuşması olan işletmede CEVAPLANMIŞ eski konuşmalarla
    // doluyordu — en yeni (cevapsız, çıkışı yaklaşan, QR devri) konuşmalar adaya hiç girmiyordu (230 eski + 5 bekleyen → 0 satır). İki okuma
    // birleşir: (1) EN YENİ tavan kadar — taze, çıkışı yaklaşan ve QR konuşmaları (QR konuşması "answered" doğar, durumu değişmez);
    // (2) EN ESKİ tavan kadar ama yalnız açık durumlu — "en uzun bekleyen" amacı. Kimliğe göre tekilleşir; satırlar sonra öneme göre sıralanır.
    (async () => {
      const read = (dir: "asc" | "desc", openOnly: boolean) =>
        prisma.conversation.findMany({
          // İç kayıt (alıcısı olmayan eski yerel kayıt — `lib/internal-record.ts`) cevapsız sayılmaz: misafir yok, cevap yazılamaz.
          where: {
            propertyId: { in: propertyIds },
            lastMessageAt: { gte: windowStart },
            ...(openOnly ? { status: { in: [...OPEN_CANDIDATE_STATUSES] } } : {}),
            AND: [hasRecipientWhere(organizationId)],
          },
          orderBy: [{ lastMessageAt: dir }, { id: dir }],
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
            reservation: { select: { id: true, departureDate: true, status: true, sourceReference: true } },
            messages: {
              // Misafirin GÖRMEDİĞİ satırlar (sistem olayı, gövdesiz) mesaj sayılmaz; otomatik şablon mesajı (K7) cevap değildir —
              // misafirin cevapsız sorusunu gizlemesin.
              where: { systemEventType: null, NOT: { body: "" }, ...notAutomationMessageWhere() },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { direction: true, createdAt: true },
            },
          },
        });
      const [oldestOpen, newest] = await Promise.all([read("asc", true), read("desc", false)]);
      const seen = new Set<string>();
      return [...oldestOpen, ...newest].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
    })(),
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
    // Yetim boşluklar (V2 boşluk satırı) yalnız anahtar açıkken ve AYNI yüklemeden (çift sorgu yok); kapalıyken bugünkü yol birebir.
    (attentionGapEnabled()
      ? findUpcomingConflictsAndGaps(organizationId, { propertyIds, now })
      : findUpcomingConflicts(organizationId, { propertyIds, now }).then((conflicts) => ({ conflicts, gaps: [] as UpcomingGap[] }))
    ).catch((err): { conflicts: UpcomingConflict[]; gaps: UpcomingGap[] } => {
      void alertOnTransition("attention:calendar-conflict", "attention calendar_conflict", err).catch(() => {});
      return { conflicts: [], gaps: [] };
    }),
    // Misafire verilen açık sözler (migration 62): son anı yaklaşan ya da geçen. Arıza öteki satırları düşürmez (geçiş tabanlı alarm).
    prisma.guestCommitment
      .findMany({
        where: {
          organizationId,
          status: "open",
          dueAt: {
            gte: new Date(now.getTime() - COMMITMENT_STALE_HOURS * HOUR),
            lte: new Date(now.getTime() + COMMITMENT_HORIZON_HOURS * HOUR),
          },
          conversation: { propertyId: { in: propertyIds } },
          // Saatsiz (yalnız gün) söz gün bitmeden satır olmaz (kurucu 10-17: "hostu sürekli rahatsız etmesin"); filtre sorguda — `take` sınırı
          // görünmeyecek satırlarla dolmasın. `not: "day"` NULL'u dışlar (SQL) → eski satır (NULL = açık saat) ayrı dal.
          OR: [{ duePrecision: null }, { duePrecision: { not: "day" } }, { dueAt: { lt: now } }],
        },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        // Geniş okunur, satırlar ÖNEMİNE göre seçilir (↓): dünden kalan saatsiz sözler (önem 60) bugün geciken saatli sözü (96) üç satırlık
        // tavandan düşürmesin (Haiku 10-17 gece).
        take: COMMITMENT_SCAN_ROWS,
        select: {
          id: true,
          kind: true,
          topic: true,
          dueAt: true,
          duePrecision: true,
          dayPart: true,
          conversationId: true,
          conversation: {
            select: { propertyId: true, channel: true, reservation: { select: { id: true, departureDate: true, status: true, sourceReference: true } } },
          },
        },
      })
      .catch((err) => {
        void alertOnTransition("attention:commitment-due", "attention commitment_due", err).catch(() => {});
        return [];
      }),
    // Konuşma öğeleri: bu bacağın arızası öteki satırları düşürmez (geçiş tabanlı alarm).
    heldRequestsByConversation(prisma, { organizationId, propertyIds, since: windowStart, excludeItemIds: decisionItemIds }).catch(
      (err): HeldRequestSummary[] => {
        void alertOnTransition("attention:held-request", "attention held_request", err).catch(() => {});
        return [];
      },
    ),
    // KANAL BAĞLANTISI SAĞLIĞI (↓ satırları): işletme düzeyi — mülke daraltılmış çağrıda okunmaz.
    options.propertyId
      ? []
      : prisma.channelConnection
          .findMany({
            // Sağlayıcının REDDETTİĞİ bağlantı (`revoked`) da: mesaj akışı durmuştur, ev sahibinin yeniden bağlanması gerekir.
            where: { organizationId, status: { in: ["active", "revoked"] } },
            orderBy: { createdAt: "asc" },
            select: { status: true, lastReadOkAt: true, lastReadErrorAt: true, lastReadErrorKind: true, createdAt: true, updatedAt: true },
          })
          .catch((err) => {
            void alertOnTransition("attention:connection-health", "attention connection_unhealthy", err).catch(() => {});
            return [];
          }),
    // SAĞLAYICI ARIZASI sayımı (↓ satırı): işletme düzeyi — mülke daraltılmış çağrıda okunmaz.
    options.propertyId
      ? 0
      : prisma.conversation
          .findMany({
            where: {
              propertyId: { in: propertyIds },
              skippedReason: PROVIDER_OUTAGE_REASON,
              updatedAt: { gte: new Date(now.getTime() - PROVIDER_OUTAGE_WINDOW_HOURS * HOUR) },
            },
            // En yeni önce: aday tavanı aşılırsa eski arızalar düşer, sayı güncel kalır (3. inceleme).
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            take: CONVERSATION_CANDIDATE_CAP,
            select: {
              messages: {
                where: { systemEventType: null, NOT: { body: "" }, ...notAutomationMessageWhere() },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
                select: { direction: true },
              },
            },
          })
          .then((rows) => rows.filter((r) => r.messages[0]?.direction === "inbound").length)
          .catch((err) => {
            void alertOnTransition("attention:provider-outage", "attention provider_outage", err).catch(() => {});
            return 0;
          }),
    // AYNI REZERVASYON İKİ FARKLI DAİREDE KAYITLI (↓ satırları). Arıza öteki satırları düşürmez.
    activeBookingConflicts(prisma, { organizationId, now }).catch((err): { conflicts: ActiveBookingConflict[]; capped: boolean } => {
      void alertOnTransition("attention:booking-two-properties", "attention booking_two_properties", err).catch(() => {});
      return { conflicts: [], capped: false };
    }),
    // KANAL İPTALLİ REZERVASYONU YENİDEN ETKİN GÖSTERİYOR (↓ satırları). Arıza öteki satırları düşürmez.
    findChannelReactivations(organizationId, propertyIds, now, storedTimezone).catch((err) => {
      void alertOnTransition("attention:channel-reactivation", "attention channel_reactivation", err).catch(() => {});
      return [];
    }),
  ]);
  const { conflicts, gaps } = calendarScan;
  const inScope = new Set(propertyIds);
  const openDecisions = decisions.filter((d) => inScope.has(d.propertyId));
  // Ev sahibine bırakılmış istek / karar bekleyen kart satırı bu konuşmayı zaten gösteriyor (daha özgül; çift satır olmasın).
  const heldConversationIds = new Set([...held.map((h) => h.conversationId), ...openDecisions.map((d) => d.conversationId)]);

  const items: AttentionItem[] = [];

  // ÇIKIŞTAN ÖNCE AÇIK KONU (plan madde 7): çıkışı penceredeki konaklama başına grup. Konu (bırakılan istek · açık söz · Sorunlu) olan grubun
  // satırları sonda TEK satıra toplanır; konusu olmayan grupta hiçbir şey değişmez (yalnız cevapsız mesaj → bugünkü satır aynen).
  // Aynı rezervasyon iki dairede etkin kayıtlıysa grup kurulmaz (daire tahmin edilmez; "iki dairede kayıtlı" satırı ayrı uyarır).
  const twoPropertyRefs = new Set(twoProperties.conflicts.map((c) => c.sourceReference));
  const departureGroups = new Map<string, DepartureGroup>();
  const departingStay = (res: StayRef | null | undefined, propertyId: string, tz: string): DepartureGroup | null => {
    if (!res || (res.status !== "confirmed" && res.status !== "completed")) return null;
    if (res.sourceReference && twoPropertyRefs.has(res.sourceReference)) return null;
    if (!departingWithinSoonWindow(res.departureDate, now, tz)) return null;
    const existing = departureGroups.get(res.id);
    if (existing) return existing;
    const { key, anchor } = calendarDateOf(res.departureDate, tz);
    const storedClock = checkOutTimeById.get(propertyId);
    const time =
      anchor === "instant"
        ? res.departureDate.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: tz, hourCycle: "h23" })
        : isClockText(storedClock)
          ? storedClock
          : null;
    const group: DepartureGroup = {
      reservationId: res.id,
      propertyId,
      day: key === todayKey(now, tz) ? "today" : "tomorrow",
      time: isClockText(time) ? time : null,
      topics: [],
      problem: null,
      absorbed: [],
      hoursWaiting: undefined,
    };
    departureGroups.set(res.id, group);
    return group;
  };
  const addTopic = (g: DepartureGroup, t: DepartureTopic) => {
    const same = (x: DepartureTopic) =>
      x.source === t.source && x.kind === t.kind && (x.source !== "commitment" || t.source !== "commitment" || x.topic === t.topic);
    if (!g.topics.some(same)) g.topics.push(t);
  };
  // Acil / erişim kaybı bırakılan isteği olan konuşma: kendi satırı kalır (yutulmaz) ve Sorunlu işareti birleşik satıra girmez (çift olmasın).
  const urgentHeldConversationIds = new Set(held.filter((h) => h.emergency || h.urgent).map((h) => h.conversationId));
  // Konuşma → rezervasyon (zaten okunan aday konuşmalar ve sözlerden; bırakılan istekte eksik kalanlar ↓ tek okumayla).
  const stayOfConversation = new Map<string, StayRef | null>();
  for (const c of conversations) stayOfConversation.set(c.id, c.reservation);
  for (const c of commitments) if (!stayOfConversation.has(c.conversationId)) stayOfConversation.set(c.conversationId, c.conversation.reservation);

  // KANAL BAĞLANTISI SAĞLIĞI (V0 §2f; sağlayıcıdan bağımsız — bağlantı satırının okuma kaydı). İşletme düzeyi satır: mülke daraltılmış
  // çağrıda gösterilmez. Ölçüm yoksa (yazıcı anahtarı kapalı) satır yok. Kalıcı hata hemen; geçici hata / bayat okuma yalnız bayatsa.
  if (!options.propertyId) {
    for (const c of connections) {
      const measured = connectionHealth(c, now);
      // Reddedilmiş bağlantı = yetki düştü. İSTİSNA kurucu hesabı: kendi bağlantısı reddedilse de sistemin ortak bağlantısıyla senkron
      // sürebilir (bu yolun okumaları bağlantı satırına yazılmaz) → sahte kalıcı "yetki düştü" satırı olmasın (Haiku incelemesi).
      const h =
        c.status === "revoked" && !isFounderOrg(organizationId)
          ? { ...measured, state: "error" as const, errorKind: "auth_revoked" as const }
          : measured;
      if (!connectionNeedsAttention(h)) continue;
      items.push({
        kind: "connection_unhealthy",
        // GÖZLEM: okuma sonucu bizim kaydımız.
        certainty: "observed",
        propertyId: "",
        propertyName: "",
        // Bütün dairelerin mesaj akışı: bozuk takvim beslemesinin hemen altı.
        severity: 98,
        occurredAt: c.lastReadErrorAt ?? c.lastReadOkAt ?? c.updatedAt,
        href: "/settings?tab=baglantilar",
        ...(h.state === "error" && h.errorKind ? { connectionErrorKind: h.errorKind } : {}),
        ...(h.minutesSinceOk !== null ? { minutesSinceOk: h.minutesSinceOk } : {}),
      });
    }
    // SAĞLAYICI ARIZASI — TEK SATIR (G10, kurucu kararı 10-13 "Ekle, tek satır"). Sağlayıcı 5xx döndüğünde gönderim belirsizdir (claim
    // tutulur, kör tekrar yok); eskiden her konuşma ayrı "doğrulanamadı" satırıydı. Burada son PROVIDER_OUTAGE_WINDOW_HOURS saatte bu
    // sebeple bekleyen konuşmalar SAYILIR → işletme düzeyinde tek satır. Okuma arızası öteki satırları düşürmez.
    // Yalnız misafirin HÂLÂ beklediği konuşmalar (son görünür mesaj misafirden): ev sahibi elle cevap verdiyse sebep kolonu kalsa da
    // konuşma sayılmaz (Haiku incelemesi 10-13 — yoksa satır 48 saat "bekliyor" derdi). Sayım yukarıdaki turda.
    if (outageCount > 0) {
      items.push({
        kind: "provider_outage",
        certainty: "observed",
        propertyId: "",
        propertyName: "",
        // Bağlantı satırıyla aynı sınıf (bütün dairelerin giden mesajı): onun hemen altı.
        severity: 97,
        occurredAt: now,
        href: "/inbox",
        waitingCount: outageCount,
      });
    }
  }

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

  // Çıkış günü işletmenin takviminden okunur (tek tarih kuralı) — yalnız çıkışı olan aday varsa org dilimi okunur.
  const departureTz = conversations.some((c) => c.reservation?.departureDate) ? orgTimezone(decisionTz ?? (await storedTimezone())) : null;
  for (const convo of conversations) {
    const last = convo.messages[0];
    // Çıkışı penceredeki konaklama grubu (yalnız açık konu varsa sonda tek satıra döner).
    const group = departureTz !== null ? departingStay(convo.reservation, convo.propertyId, departureTz) : null;
    // "Sorunlu" konuşma (son sözü bizde olsa da) çıkıştan önce açık konudur; acil istek satırı onu zaten gösteriyorsa girmez.
    if (group && convo.status === "problem" && !urgentHeldConversationIds.has(convo.id) && !group.problem) {
      group.problem = { conversationId: convo.id, channel: convo.channel, at: last?.createdAt ?? convo.lastMessageAt };
    }
    // Görünür mesajı olmayan ya da son sözü BİZDE olan konuşma cevapsız değildir.
    if (!last || last.direction !== "inbound") continue;
    // Misafirin son sözü yalnız teşekkür/kapanıştı ve bilerek cevap verilmedi — bekleyen iş değil.
    if (isClosingHandled(convo)) continue;

    const waitedMs = now.getTime() - last.createdAt.getTime();
    if (waitedMs < 0) continue;
    const hoursWaiting = Math.floor(waitedMs / HOUR);
    // Birleşik satır cevapsızlığı da söyler (bırakılan istek satırının yuttuğu konuşmada da): bugünkü çıkış eşiğiyle.
    if (group && hoursWaiting >= DEPARTING_UNANSWERED_HOURS) group.hoursWaiting = Math.max(group.hoursWaiting ?? 0, hoursWaiting);
    // Ev sahibine bırakılmış istek satırı bu konuşmayı zaten gösteriyor (daha özgül; çift satır olmasın).
    if (heldConversationIds.has(convo.id)) continue;

    const departure = convo.reservation?.departureDate ?? null;
    const departingSoon =
      departure !== null &&
      (convo.reservation?.status === "confirmed" || convo.reservation?.status === "completed") &&
      departureTz !== null &&
      departingWithinSoonWindow(departure, now, departureTz);

    if (departingSoon) {
      if (hoursWaiting < DEPARTING_UNANSWERED_HOURS) continue;
      const row: AttentionItem = {
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
      };
      items.push(row);
      group?.absorbed.push(row);
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

  for (const d of openDecisions) {
    items.push({
      kind: "decision_pending",
      // ÇIKARIM: isteğin türü anlama katmanı + kelime ağıyla tespit edildi (saat modelin okuması) → "doğrulayın".
      certainty: "inferred",
      propertyId: d.propertyId,
      propertyName: nameById.get(d.propertyId) ?? "",
      // Kararı bekleyen misafir: bırakılan istekten ÖNCE, acilden SONRA.
      severity: 92,
      occurredAt: d.messageAt,
      href: conversationHref(d.conversationId, d.channel),
      decisionTitle: decisionTitle(d.kind, d.requestedTime),
      ...(d.effective === "send_unverified" ? { decisionUnverified: true } : {}),
    });
  }

  // Söz satırları: saat işletmenin diliminde gösterilir (yalnız söz varsa okunur — sakin günde ek sorgu yok).
  if (commitments.length > 0) {
    const tz = orgTimezone(decisionTz ?? (await storedTimezone()));
    const todayKey = dateKeyInTimeZone(now, tz);
    const tomorrowKey = dateKeyInTimeZone(addZonedDays(now, 1, tz), tz);
    const yesterdayKey = dateKeyInTimeZone(addZonedDays(now, -1, tz), tz);
    const commitmentRows: AttentionItem[] = [];
    for (const c of commitments) {
      if (!isCommitmentKind(c.kind)) continue;
      // Gecikme payı (kurucu 10-17 gece / Opus): açık saatli sözde 30 dk içinde "gecikti" denmez (kalan 0); dilim / gün sözünde son an zaten
      // pencerenin sonu. Gecikme süresi son andan sayılır.
      const rawLeft = Math.floor((c.dueAt.getTime() - now.getTime()) / 60_000);
      // Pay ve 1 gün hatırlatması YALNIZ söz → görev otomatik açıkken (Opus O16: anahtar kapalıyken bugünkü görünüm değişmez).
      const autoOn = hostCommitmentAutoEnabled();
      const minutesLeft = autoOn && now.getTime() < commitmentLateAt(c).getTime() ? Math.max(0, rawLeft) : rawLeft;
      const precise = c.duePrecision == null || c.duePrecision === "time";
      const clock = c.dueAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
      const dayKey = dateKeyInTimeZone(c.dueAt, tz);
      // Bugün → yalnız saat; dün / yarın → sözcük; daha eskisi → tarih (her geçmiş gün "dün" değildir — Haiku incelemesi).
      const dayWord =
        dayKey === todayKey
          ? ""
          : dayKey === tomorrowKey
            ? "yarın "
            : dayKey === yesterdayKey
              ? "dün "
              : `${c.dueAt.toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: tz })} `;
      // Dilim / gün sözünde saat UYDURULMAZ (kurucu 10-17): "yarın akşam", "bugün (saat belirtilmedi)".
      const whenText = precise ? `${dayWord}${clock}` : storedCommitmentWhen(c, now, tz);
      const row: AttentionItem = {
        kind: "commitment_due",
        // GÖZLEM: söz ev sahibinin AÇIK işaretinden doğdu (yorum yok).
        certainty: "observed",
        propertyId: c.conversation.propertyId,
        propertyName: nameById.get(c.conversation.propertyId) ?? "",
        // Geciken söz: misafir bekliyor (çakışmanın hemen altı); yaklaşan söz bırakılan istekten önce; uzaktaki altta.
        // Saatsiz söz (gün geçti) altta kalır — ev sahibi işaretlemiyor olabilir, sürekli öne çıkarılmaz (kurucu 10-17).
        severity: c.duePrecision === "day" ? 60 : minutesLeft < 0 ? 96 : minutesLeft <= COMMITMENT_SOON_HOURS * 60 ? 89 : 60,
        occurredAt: c.dueAt,
        href: conversationHref(c.conversationId, c.conversation.channel),
        rowKey: c.id,
        commitmentKind: c.kind,
        commitmentTopic: c.topic,
        minutesLeft,
        commitmentTime: whenText,
        commitmentPrecise: precise,
        ...(autoOn && minutesLeft <= -COMMITMENT_REMIND_AFTER_MIN ? { commitmentReminder: true } : {}),
      };
      // Çıkışı penceredeki konaklamanın sözü birleşik satıra gider (söz tavanında yer tutmaz — o satırda zaten görünür).
      const group = departingStay(c.conversation.reservation, c.conversation.propertyId, tz);
      if (group) {
        addTopic(group, { source: "commitment", kind: c.kind, topic: c.topic });
        group.absorbed.push(row);
        continue;
      }
      commitmentRows.push(row);
    }
    // En önemli `COMMITMENT_MAX_ROWS` satır (eşitlikte son an sırası korunur), son an sırasıyla eklenir.
    const keep = new Set(
      commitmentRows
        .map((row, i) => ({ row, i }))
        .sort((a, b) => b.row.severity - a.row.severity || a.i - b.i)
        .slice(0, COMMITMENT_MAX_ROWS)
        .map((x) => x.row),
    );
    items.push(...commitmentRows.filter((row) => keep.has(row)));
  }

  // Bırakılan isteği olan ama aday listesinde olmayan konuşmaların rezervasyonu (aday tavanı) — yalnız gerektiğinde TEK okuma.
  const missingHeld = held.filter((h) => !h.emergency && !h.urgent && !stayOfConversation.has(h.conversationId)).map((h) => h.conversationId);
  if (missingHeld.length > 0) {
    const rows = await prisma.conversation
      .findMany({
        where: { id: { in: missingHeld }, propertyId: { in: propertyIds } },
        select: { id: true, reservation: { select: { id: true, departureDate: true, status: true, sourceReference: true } } },
      })
      .catch((err) => {
        void alertOnTransition("attention:departure-open", "attention departure_open", err).catch(() => {});
        return [];
      });
    for (const r of rows) stayOfConversation.set(r.id, r.reservation);
  }
  const heldTz = held.some((h) => stayOfConversation.get(h.conversationId)) ? orgTimezone(decisionTz ?? (await storedTimezone())) : null;
  for (const h of held) {
    const group =
      heldTz !== null && !h.emergency && !h.urgent ? departingStay(stayOfConversation.get(h.conversationId), h.propertyId, heldTz) : null;
    const row: AttentionItem = {
      kind: "held_request",
      // 🚨 ÇIKARIM: istek türü anlama katmanı + kelime ağıyla sınıflandırıldı → "otomatik sınıflandırma, doğrulayın".
      certainty: "inferred",
      propertyId: h.propertyId,
      propertyName: nameById.get(h.propertyId) ?? "",
      // Acil istek her şeyin üstünde (konuşma zaten "Sorunlu"); erişim kaybı (kayıp anahtar / kilitli kalma — kurucu 10-29 gece GD4 "öncelikli
      // olarak hosta gösterilsin") aynı üst sırada; öteki bırakılan istek cevapsız mesajdan önce gelir.
      severity: h.emergency || h.urgent ? 99 : 88,
      occurredAt: h.oldestAt,
      href: conversationHref(h.conversationId, h.channel),
      requestKinds: h.kinds,
      requestCount: h.count,
    };
    items.push(row);
    if (group) {
      for (const kind of h.kinds) addTopic(group, { source: "held", kind });
      group.absorbed.push(row);
    }
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
  // Yetim boşluk: mülk başına TEK satır — en yakın boşluk + toplam sayı (çakışmayla aynı ilke: kartı doldurmasın).
  const nearestGapByProperty = new Map<string, { g: UpcomingGap; count: number }>();
  for (const g of gaps) {
    const cur = nearestGapByProperty.get(g.propertyId);
    if (!cur) nearestGapByProperty.set(g.propertyId, { g, count: 1 });
    else {
      cur.count++;
      if (g.from < cur.g.from) cur.g = g;
    }
  }
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

  // "Yakın" sınırı işletmenin takvim gününden (yalnız boşluk varsa okunur — sakin günde ek sorgu yok).
  let soonLimit = "";
  if (nearestGapByProperty.size > 0) {
    const tz = orgTimezone(decisionTz ?? (await storedTimezone()));
    soonLimit = dateKeyInTimeZone(addZonedDays(now, GAP_SOON_DAYS, tz), tz);
  }
  for (const { g, count } of nearestGapByProperty.values()) {
    const [y, m, d] = g.from.split("-").map(Number);
    items.push({
      kind: "booking_gap",
      // Komşu iki konaklamanın hiçbiri taze kaynaktan / ev sahibi girişinden değilse biri hayalet olabilir → çıkarım.
      certainty: g.confirmed ? "observed" : "inferred",
      propertyId: g.propertyId,
      propertyName: nameById.get(g.propertyId) ?? "",
      // Kanıtsız komşulu boşluk bir basamak aşağıda (hayalet satır olabilir — çakışmada da önem kanıta göre).
      severity: (g.from < soonLimit ? GAP_SEVERITY_SOON : GAP_SEVERITY_LATER) - (g.confirmed ? 0 : GAP_UNCONFIRMED_PENALTY),
      occurredAt: new Date(Date.UTC(y, m - 1, d)),
      href: `/calendar?property=${encodeURIComponent(g.propertyId)}&month=${g.from.slice(0, 7)}`,
      nights: { from: g.from, to: g.to },
      gapCount: count,
      // Tutar YOK (kurucu 10-11: "Airbnb API alınca takvimden çekeriz" — ev sahibi aralığından tahmini değer gösterilmez).
    });
  }

  // AYNI REZERVASYON İKİ FARKLI DAİREDE KAYITLI (kurucu 11-18 akşam: "hosta bir kez eşleştirme uyarısı çıkmalı"). Tutma kuralıyla AYNI
  // yüklem (`booking-property-conflict.ts`): gönderici bu rezervasyonun otomatik mesajını tutuyor; satır ev sahibinin yanlış kaydı kaldırması
  // için. Rezervasyon başına TEK satır, en yakın varış önce, tavanlı (aşım sessiz kalmaz: geçiş tabanlı alarm). Arıza öteki satırları düşürmez.
  // Okuma yukarıdaki turda.
  if (twoProperties.capped) {
    void alertOnTransition(
      `attention:booking-two-properties-cap:${organizationId}`,
      "attention booking_two_properties cap",
      new BookingTwoPropertiesCapExceeded(BOOKING_CONFLICT_ROW_CAP),
    ).catch(() => {});
  }
  // Tek daireye daraltılmış çağrıda yalnız o daireyi içeren çakışma (öteki daire kapsam dışında olsa da çakışma çakışmadır).
  const twoPropertyAll = twoProperties.conflicts.filter((c) => c.properties.some((p) => inScope.has(p.id)));
  const twoPropertyRows = twoPropertyAll.slice(0, BOOKING_TWO_PROPERTIES_PANEL_CAP);
  const twoPropertyMore = twoPropertyAll.length - twoPropertyRows.length;
  if (twoPropertyRows.length > 0) {
    // Varış günü işletmenin takviminden (tek tarih kuralı) — yalnız satır varsa okunur (sakin günde ek sorgu yok).
    const tz = orgTimezone(decisionTz ?? (await storedTimezone()));
    // "Otomatik gönderim durduruldu" yalnız gerçekten durduruluyorsa (kurucu 11-20 sabah B-1) — gösterilen satırlar için TEK okuma. Okunamazsa
    // satır yine görünür, durdurma cümlesi yazılmaz (söz verilmez; geçiş tabanlı alarm).
    const stopped = await autoSendStoppedByConflict({ organizationId, refs: twoPropertyRows.map((c) => c.sourceReference), now }).catch(
      (err): Set<string> => {
        void alertOnTransition("attention:booking-two-properties-stopped", "attention booking_two_properties stopped", err).catch(() => {});
        return new Set();
      },
    );
    for (const [index, c] of twoPropertyRows.entries()) {
      const arrivalDay = calendarDateOf(c.arrivalDate, tz).key;
      const [y, m, d] = arrivalDay.split("-").map(Number);
      const own = c.properties.find((p) => inScope.has(p.id)) ?? c.properties[0];
      items.push({
        kind: "booking_two_properties",
        // GÖZLEM: iki kayıt da bizim kayıtlarımız; yorum yok.
        certainty: "observed",
        propertyId: own.id,
        propertyName: own.name,
        // Sonucu `channel_reactivation` ile aynı (misafir otomatik karşılama / giriş bilgisi almaz) → aynı sıra.
        severity: 85,
        occurredAt: new Date(Date.UTC(y, m - 1, d)),
        // UA-1 (kurucu 11-19): satırlar yan yana — "Kayıtları karşılaştır" sayfası. Anahtar etkin satırların en küçük kimliği; kaynak
        // kimliği adrese taşınmaz.
        href: `/reservations/compare/${encodeURIComponent(c.rowKey)}`,
        rowKey: c.rowKey,
        bookingPropertyNames: c.properties.map((p) => p.name),
        arrivalDay,
        ...(index === twoPropertyRows.length - 1 && twoPropertyMore > 0 ? { bookingMoreCount: twoPropertyMore } : {}),
        ...(stopped.has(c.sourceReference) ? { autoSendStopped: true } : {}),
      });
    }
  }

  // KANAL İPTALLİ REZERVASYONU YENİDEN ETKİN GÖSTERİYOR (G9, kurucu kararı 10-13 "Kanal açmasın, iCal aynı"). Yazma servisi satırı
  // iptal TUTAR ve günde en çok bir olay düşer; burada son REACTIVATION_ATTENTION_DAYS günün olayından, hâlâ iptal olan ve konaklaması
  // bitmemiş rezervasyon başına TEK satır. Kanal etkin göstermeyi bırakınca satır kendiliğinden kalkar. Arıza öteki satırları düşürmez.
  // Okuma yukarıdaki turda.
  for (const r of reactivated) {
    items.push({
      kind: "channel_reactivation",
      // GÖZLEM: kanalın gönderdiği durum bizim olay kaydımız.
      certainty: "observed",
      propertyId: r.propertyId,
      propertyName: nameById.get(r.propertyId) ?? "",
      // Gerçekten yeniden açıldıysa misafir karşılama / giriş bilgisi almaz → cevapsız mesajların üstünde, risk satırlarının altında.
      severity: 85,
      occurredAt: r.lastSeenAt,
      href: r.conversation ? conversationHref(r.conversation.id, r.conversation.channel) : `/calendar?property=${encodeURIComponent(r.propertyId)}`,
      reservationId: r.reservationId,
    });
  }

  // ÇIKIŞTAN ÖNCE AÇIK KONU — birleşik satır (konu ya da Sorunlu işareti olan grup). Yutulan satırlar listeden çıkar.
  for (const g of departureGroups.values()) {
    if (g.topics.length === 0 && !g.problem) continue;
    const absorbed = new Set(g.absorbed);
    for (let i = items.length - 1; i >= 0; i--) if (absorbed.has(items[i])) items.splice(i, 1);
    const lead = [...g.absorbed].sort((a, b) => b.severity - a.severity || a.occurredAt.getTime() - b.occurredAt.getTime())[0];
    const href = lead ? lead.href : conversationHref(g.problem!.conversationId, g.problem!.channel);
    const occurredAt = new Date(Math.min(...g.absorbed.map((r) => r.occurredAt.getTime()), ...(g.problem ? [g.problem.at.getTime()] : [])));
    items.push({
      kind: "departing_unanswered",
      // Bırakılan isteğin türü sınıflandırmadan → o varsa çıkarım (bugünkü istek satırıyla aynı uyarı); söz / Sorunlu / cevapsız gözlem.
      certainty: g.absorbed.some((r) => r.certainty === "inferred") ? "inferred" : "observed",
      propertyId: g.propertyId,
      propertyName: nameById.get(g.propertyId) ?? "",
      // Yutulan satırların en önemlisi; en az bugünkü çıkış satırının tabanı (misafir gidiyor).
      severity: Math.max(90, ...g.absorbed.map((r) => r.severity), g.hoursWaiting !== undefined ? 90 + Math.min(9, g.hoursWaiting) : 0),
      occurredAt,
      href,
      rowKey: `departure:${g.reservationId}`,
      ...(g.hoursWaiting !== undefined ? { hoursWaiting: g.hoursWaiting } : {}),
      departureOpen: {
        day: g.day,
        time: g.time,
        topics: g.topics,
        problem: g.problem !== null,
        ...(g.hoursWaiting !== undefined ? { hoursWaiting: g.hoursWaiting } : {}),
      },
    });
  }

  items.sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    // Eşit önemde ESKİ olan üstte: daha uzun süredir bekliyor.
    return a.occurredAt.getTime() - b.occurredAt.getTime();
  });
  return items.slice(0, ATTENTION_MAX_ITEMS);
}

/** Çıkış penceresi grubu için okunan rezervasyon alanları. */
interface StayRef {
  id: string;
  departureDate: Date;
  status: string;
  sourceReference: string | null;
}

/** Çıkışı penceredeki tek konaklamanın toplanan parçaları (ÇIKIŞTAN ÖNCE AÇIK KONU). */
interface DepartureGroup {
  reservationId: string;
  propertyId: string;
  day: "today" | "tomorrow";
  time: string | null;
  topics: DepartureTopic[];
  problem: { conversationId: string; channel: string; at: Date } | null;
  /** Birleşik satır çıkarsa listeden kalkacak satırlar (cevapsız · bırakılan istek · söz). */
  absorbed: AttentionItem[];
  hoursWaiting: number | undefined;
}

class BookingTwoPropertiesCapExceeded extends Error {
  constructor(cap: number) {
    super(`booking_two_properties rows exceed cap ${cap}`);
    this.name = "BookingTwoPropertiesCapExceeded";
  }
}

/**
 * G9: son günlerde kanalın yeniden etkin gösterdiği, hâlâ iptal ve konaklaması bitmemiş rezervasyonlar (en yeni olayla). "Bitmemiş" =
 * çıkış günü işletmenin takviminde BUGÜN ya da sonrası (tek tarih kuralının sorgu ikizi; rota `stayEndedBefore` ile aynı kararı verir —
 * Haiku incelemesi 10-13: ham `departureDate >= şimdi` çıkış günü sabahı satırı düşürüyordu, oysa çıkış temizliği o gündür).
 */
async function findChannelReactivations(
  organizationId: string,
  propertyIds: readonly string[],
  now: Date,
  /** İşletmenin saklı saat dilimi — çağıranın tek okuması (yalnız olay varsa beklenir). */
  storedTimezone: () => Promise<string | null | undefined>,
): Promise<{ reservationId: string; propertyId: string; lastSeenAt: Date; conversation: { id: string; channel: string } | null }[]> {
  const events = await prisma.ingestEvent.findMany({
    where: {
      organizationId,
      entityType: "reservation",
      kind: "reservation.updated",
      changedFieldsJson: { contains: REACTIVATION_BLOCKED_FIELD },
      occurredAt: { gte: new Date(now.getTime() - REACTIVATION_ATTENTION_DAYS * 24 * HOUR) },
    },
    orderBy: { occurredAt: "desc" },
    take: 100,
    select: { entityId: true, occurredAt: true },
  });
  if (events.length === 0) return [];
  const lastSeen = new Map<string, Date>();
  for (const e of events) if (!lastSeen.has(e.entityId)) lastSeen.set(e.entityId, e.occurredAt);
  const tz = orgTimezone(await storedTimezone());
  const reservations = await prisma.reservation.findMany({
    where: {
      id: { in: [...lastSeen.keys()] },
      propertyId: { in: [...propertyIds] },
      status: "cancelled",
      AND: [reservationDayRangeWhere("departureDate", { from: todayKey(now, tz), to: null }, tz)],
    },
    select: {
      id: true,
      propertyId: true,
      conversations: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1, select: { id: true, channel: true } },
    },
  });
  return reservations.map((r) => ({
    reservationId: r.id,
    propertyId: r.propertyId,
    lastSeenAt: lastSeen.get(r.id) ?? now,
    conversation: r.conversations[0] ?? null,
  }));
}
