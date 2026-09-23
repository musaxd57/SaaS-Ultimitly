import { dateKeyInTimeZone } from "@/lib/timezone";
import {
  DEMO_FUTURE_DAYS,
  DEMO_ID_PREFIX,
  DEMO_LOGIN_EMAIL,
  DEMO_MAX_CANCELLED_PER_PROPERTY,
  DEMO_ORG_ID,
  DEMO_PAST_DAYS,
  DEMO_SEED,
  DEMO_TIMEZONE,
} from "./constants";

// ---------------------------------------------------------------------------
// DEMO HESABI — SAF, DETERMİNİSTİK VERİ KÜMESİ (DB yok, ağ yok, `Math.random` yok).
//
// Aynı `now` + aynı tohum → birebir aynı satırlar; `now` üç gün ilerlerse bütün tarihler tam üç gün
// kayar, kimlikler ve metinler aynı kalır (test-pinli). Yenileme = aynı komutun tekrar koşması.
//
// 🚨 DÜRÜSTLÜK SINIRLARI (bilinçli):
//  · Sahte bağlantı YOK: kanal kimlik bilgisi, `ChannelConnection`, takvim beslemesi, sağlayıcı
//    kimliği yazılmaz — 2 dk'lık senkron sahte bir token'la 401 alıp bağlantıyı iptal eder ve
//    alarm üretirdi. Bu yüzden müsaitlik motoru demo mülklerde boş geceye "bilinmiyor" der (kanıtsız
//    "müsait" YOK) — ürünün gerçek davranışı budur.
//  · Rezervasyon kodu (`sourceReference`) ve konuşmanın sağlayıcı kimliği YAZILMAZ: yazılsaydı
//    satırlar "kanaldan mesajlanabilir" sayılır, cevap düğmesi sağlayıcıya gitmeye çalışırdı.
//  · Misafir iletişimi YOK (telefon/e-posta null); adlar "Ad S." biçiminde, gerçek kişi değil.
//  · Şikâyet/iade konuşmaları `problem` doğar, asla `new` değil: `new` + şikâyet otomatik uyarı
//    e-postası tetikler. `new` konuşmalar yalnız zararsız sorular taşır (test-pinli).
//  · Sır YOK: Wi-Fi şifresi, kapı kodu ya da QR/takvim token'ı veri kümesinde bulunmaz.
//  · Bu dilimde müşteri sinyali / hafıza olayı (IngestEvent) üretilmez: yeni bir kaynak türü
//    ("demo_seed") eklemek kapalı kaynak sözleşmesini değiştirir → ayrı karar.
// ---------------------------------------------------------------------------

export interface DemoOrgRow {
  id: string;
  name: string;
  timezone: string;
  language: string;
  aiReplyTone: string;
  aiSignature: string;
  autoReplyHospitable: boolean;
  autoReplyStartHour: number;
  autoReplyEndHour: number;
  autoWelcome: boolean;
  autoCheckin: boolean;
  autoCheckout: boolean;
  lateCheckoutOfferText: string;
}

export interface DemoUserRow {
  id: string;
  name: string;
  email: string;
  role: "manager" | "staff";
}

export interface DemoPropertyRow {
  id: string;
  name: string;
  address: string;
  city: string;
  country: string;
  checkInTime: string;
  checkOutTime: string;
}

export interface DemoReservationRow {
  id: string;
  propertyId: string;
  guestName: string;
  guestExternalId: string | null;
  arrivalDate: Date;
  departureDate: Date;
  channel: "airbnb" | "booking" | "direct";
  status: "confirmed" | "completed" | "pending" | "cancelled";
  totalAmount: number;
  totalAmountDec: string;
  currency: "TRY";
}

export interface DemoConversationRow {
  id: string;
  propertyId: string;
  reservationId: string;
  channel: string;
  guestIdentifier: string;
  status: "new" | "answered" | "problem";
  priority: "urgent" | "standard" | "low";
  lastMessageAt: Date;
  skippedReason: string | null;
}

export interface DemoMessageRow {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  senderName: string;
  body: string;
  language: string;
  aiIntent: string | null;
  aiAssisted: boolean;
  authorType: "guest" | "ai" | "host";
  aiSourcesJson: string | null;
  createdAt: Date;
}

export interface DemoTaskRow {
  id: string;
  propertyId: string;
  reservationId: string | null;
  type: string;
  origin: "system" | "manual";
  title: string;
  description: string;
  dueAt: Date;
  status: "todo" | "in_progress" | "awaiting_review" | "done";
  priority: "urgent" | "standard" | "low";
  assignedToId: string | null;
  sourceMessageId: string | null;
}

export interface DemoKbRow {
  id: string;
  propertyId: string;
  category: string;
  title: string;
  content: string;
  language: string;
}

export interface DemoTemplateRow {
  id: string;
  category: string;
  title: string;
  body: string;
  language: string;
}

export interface DemoDataset {
  now: Date;
  todayKey: string;
  org: DemoOrgRow;
  users: DemoUserRow[];
  properties: DemoPropertyRow[];
  reservations: DemoReservationRow[];
  conversations: DemoConversationRow[];
  messages: DemoMessageRow[];
  tasks: DemoTaskRow[];
  kbItems: DemoKbRow[];
  templates: DemoTemplateRow[];
}

/** Mülberry32 — küçük, deterministik PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOST_SENDER = "Lale Konaklama";
/** Sınıflandırmanın sihirli dizesi (CLAUDE.md DOKUNMA): AI satırı bu adla yazılır, görünür marka ayrı eşlenir. */
const AI_SENDER = "GuestOps AI";

interface PropertySpec {
  slug: string;
  name: string;
  district: string;
  city: string;
  checkIn: string;
  checkOut: string;
  nightly: number;
  parking: string;
}

const PROPERTY_SPECS: readonly PropertySpec[] = [
  { slug: "01", name: "Lale Moda", district: "Moda, Kadıköy", city: "İstanbul", checkIn: "15:00", checkOut: "11:00", nightly: 2600, parking: "Mülke ait otopark yoktur; sokakta ücretli park yeri bulunur." },
  { slug: "02", name: "Lale Cihangir", district: "Cihangir, Beyoğlu", city: "İstanbul", checkIn: "15:00", checkOut: "11:00", nightly: 3100, parking: "Mülke ait otopark yoktur; en yakın kapalı otopark beş dakika yürüme mesafesindedir." },
  { slug: "03", name: "Lale Bebek", district: "Bebek, Beşiktaş", city: "İstanbul", checkIn: "16:00", checkOut: "11:00", nightly: 4200, parking: "Binanın kapalı otoparkında daireye ayrılmış bir yer vardır." },
  { slug: "04", name: "Lale Kaleiçi", district: "Kaleiçi, Muratpaşa", city: "Antalya", checkIn: "14:00", checkOut: "11:00", nightly: 2400, parking: "Kaleiçi'ne araç girişi sınırlıdır; surların dışındaki belediye otoparkı kullanılabilir." },
  { slug: "05", name: "Lale Konyaaltı", district: "Konyaaltı", city: "Antalya", checkIn: "15:00", checkOut: "10:00", nightly: 2200, parking: "Binanın arkasında ücretsiz açık otopark vardır." },
  { slug: "06", name: "Lale Gümbet", district: "Gümbet, Bodrum", city: "Muğla", checkIn: "15:00", checkOut: "11:00", nightly: 2800, parking: "Site içinde ücretsiz açık otopark vardır." },
  { slug: "07", name: "Lale Yalıkavak", district: "Yalıkavak, Bodrum", city: "Muğla", checkIn: "16:00", checkOut: "11:00", nightly: 4500, parking: "Villanın önünde iki araçlık özel park yeri vardır." },
  { slug: "08", name: "Lale Göreme", district: "Göreme, Nevşehir", city: "Nevşehir", checkIn: "14:00", checkOut: "11:00", nightly: 2000, parking: "Evin önündeki sokakta ücretsiz park edilebilir." },
  { slug: "09", name: "Lale Alsancak", district: "Alsancak, Konak", city: "İzmir", checkIn: "15:00", checkOut: "11:00", nightly: 1900, parking: "Mülke ait otopark yoktur; yakındaki katlı otopark ücretlidir." },
  { slug: "10", name: "Lale Alaçatı", district: "Alaçatı, Çeşme", city: "İzmir", checkIn: "15:00", checkOut: "11:00", nightly: 3600, parking: "Taş evin avlusunda bir araçlık park yeri vardır." },
  { slug: "11", name: "Lale Fethiye", district: "Çalış, Fethiye", city: "Muğla", checkIn: "15:00", checkOut: "10:00", nightly: 2300, parking: "Binanın arkasında ücretsiz açık otopark vardır." },
  { slug: "12", name: "Lale Uzungöl", district: "Uzungöl, Çaykara", city: "Trabzon", checkIn: "14:00", checkOut: "11:00", nightly: 1800, parking: "Bungalovun yanında ücretsiz park yeri vardır." },
];

/** Gerçek kişi DEĞİL: yaygın ad + tek harf. */
const GUEST_NAMES: readonly string[] = [
  "Elif K.", "Mert A.", "Lukas M.", "Sofia R.", "Ayşe D.", "James T.", "Zeynep Y.", "Can B.", "Anna S.", "Omar H.",
  "Deniz Ö.", "Marie L.", "Burak T.", "Emma W.", "Selin A.", "Pavel N.", "Ece G.", "Hiroshi K.", "Kerem Ç.", "Laura P.",
  "Yusuf E.", "Nina F.", "Irmak S.", "David C.", "Ceren U.", "Mateo G.", "Duygu B.", "Olga V.", "Emre K.", "Chloé D.",
];

function id(kind: string, ...parts: (string | number)[]): string {
  return `${DEMO_ID_PREFIX}${kind}-${parts.map((p) => (typeof p === "number" ? String(p).padStart(3, "0") : p)).join("-")}`;
}

/** Mülk takvim günü `offset` gün sonrası, 12:00 UTC (iCal tarih-değeri biçimi; her iki tarih kuralıyla aynı gün). */
function dayAt(todayKey: string, offset: number): Date {
  const [y, m, d] = todayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset, 12, 0, 0, 0));
}

interface Stay {
  start: number;
  end: number;
  anchor?: boolean;
}

/**
 * Bugünün sahneleri (panelin dolu görünmesi için sabit): üç giriş, üç çıkış, bir aynı gün devir,
 * iki konaklama sürüyor (biri yarın çıkıyor), üç mülk bugün boş.
 */
function anchorStays(i: number, rnd: () => number): Stay[] {
  const len = () => 2 + Math.floor(rnd() * 4);
  if (i <= 2) return [{ start: 0, end: len(), anchor: true }];
  if (i <= 5) return [{ start: -len(), end: 0, anchor: true }];
  if (i === 6) return [{ start: -3, end: 0, anchor: true }, { start: 0, end: 3, anchor: true }];
  if (i === 7) return [{ start: -2, end: 3, anchor: true }];
  if (i === 8) return [{ start: -3, end: 1, anchor: true }];
  return [{ start: -6, end: -2, anchor: true }, { start: 2, end: 5, anchor: true }];
}

function fillStays(anchors: Stay[], rnd: () => number): Stay[] {
  const stays = [...anchors];
  const len = () => 2 + Math.floor(rnd() * 5); // 2–6 gece
  let cursor = Math.max(...anchors.map((s) => s.end));
  while (cursor < DEMO_FUTURE_DAYS) {
    const gap = cursor < 30 ? [0, 0, 1, 1, 2][Math.floor(rnd() * 5)] : 1 + Math.floor(rnd() * 5);
    const start = cursor + gap;
    if (start >= DEMO_FUTURE_DAYS) break;
    const end = start + len();
    stays.push({ start, end });
    cursor = end;
  }
  cursor = Math.min(...anchors.map((s) => s.start));
  while (cursor > -DEMO_PAST_DAYS) {
    const end = cursor - [0, 1, 1, 2, 3][Math.floor(rnd() * 5)];
    const start = end - len();
    if (end <= -DEMO_PAST_DAYS) break;
    stays.push({ start, end });
    cursor = start;
  }
  return stays.sort((a, b) => a.start - b.start);
}

function channelOf(rnd: () => number): DemoReservationRow["channel"] {
  const r = rnd();
  return r < 0.55 ? "airbnb" : r < 0.85 ? "booking" : "direct";
}

/** KB — mülkün kendi alanlarıyla TUTARLI; sır yok, doldurulmamış yer tutucu yok. */
function kbFor(p: PropertySpec, propertyId: string): DemoKbRow[] {
  const mk = (n: number, category: string, title: string, content: string): DemoKbRow => ({
    id: id("kb", p.slug, n),
    propertyId,
    category,
    title,
    content,
    language: "tr",
  });
  return [
    mk(1, "wifi", "Wi-Fi", "Kablosuz ağın adı ve şifresi modemin altındaki etikette yazılıdır. Modem salondaki televizyon ünitesinin üzerindedir."),
    mk(2, "checkin", "Giriş", `Giriş saat ${p.checkIn}'ten itibarendir. Anahtar, kapının yanındaki şifreli anahtar kutusundadır.`),
    mk(3, "checkout", "Çıkış", `Çıkış saat ${p.checkOut}'e kadardır. Anahtarı kutuya bırakmanız yeterlidir.`),
    mk(4, "rules", "Ev kuralları", "Evde sigara içilmez. Evcil hayvan kabul edilmez. Gece 23:00'ten sonra sessizlik rica olunur. Parti ve etkinlik yapılamaz."),
    mk(5, "parking", "Otopark", p.parking),
    mk(6, "local_tips", "Yakın çevre", "En yakın market yaklaşık beş dakika yürüme mesafesindedir. Eczane ana caddenin köşesindedir."),
    mk(7, "cleaning", "Havlu ve çarşaf", "Yedek havlular ve çarşaflar yatak odasındaki dolabın üst rafındadır."),
  ];
}

interface ScriptedMessage {
  who: "guest" | "ai" | "host";
  /** Şimdiden kaç dakika önce. */
  minutesAgo: number;
  body: string;
  language?: string;
  intent?: string;
  sources?: string[];
}

interface ScriptedThread {
  property: number;
  /** Hangi konaklama: "today" = bugünü kapsayan/bugün başlayan/biten çapa; "next" = ilk gelecek konaklama; "past" = geçmiş. */
  stay: "anchor" | "next" | "past";
  status: DemoConversationRow["status"];
  priority?: DemoConversationRow["priority"];
  skippedReason?: string;
  messages: ScriptedMessage[];
  /** Şikâyetten açılan bakım görevi. */
  maintenance?: { title: string; description: string };
}

const THREADS: readonly ScriptedThread[] = [
  {
    property: 0,
    stay: "anchor",
    status: "answered",
    messages: [
      { who: "guest", minutesAgo: 26 * 60, body: "Merhaba, yarın kaçta giriş yapabiliriz?", intent: "checkin" },
      { who: "ai", minutesAgo: 26 * 60 - 2, body: "Merhaba, giriş saatimiz 15:00'ten itibarendir. Anahtar, kapının yanındaki şifreli anahtar kutusundadır.", sources: ["property:checkInTime", "kb:checkin"] },
      { who: "guest", minutesAgo: 25 * 60, body: "Harika, teşekkürler!", intent: "general" },
      { who: "host", minutesAgo: 25 * 60 - 10, body: "Rica ederiz, görüşmek üzere." },
    ],
  },
  {
    property: 1,
    stay: "anchor",
    status: "answered",
    messages: [
      { who: "guest", minutesAgo: 9 * 60, body: "Yedek havlu ve çarşaf var mı?", intent: "general" },
      { who: "ai", minutesAgo: 9 * 60 - 2, body: "Evet, yedek havlular ve çarşaflar yatak odasındaki dolabın üst rafındadır.", sources: ["kb:cleaning"] },
    ],
  },
  {
    property: 2,
    stay: "anchor",
    status: "answered",
    messages: [
      { who: "guest", minutesAgo: 30 * 60, body: "Hi! Is there a supermarket nearby?", language: "en", intent: "general" },
      { who: "ai", minutesAgo: 30 * 60 - 2, body: "Hi! Yes, the nearest market is about a five-minute walk from the apartment.", language: "en", sources: ["kb:local_tips"] },
    ],
  },
  {
    property: 3,
    stay: "anchor",
    status: "answered",
    messages: [
      { who: "guest", minutesAgo: 3 * 24 * 60, body: "Wi-Fi şifresini nereden bulabilirim?", intent: "wifi" },
      { who: "ai", minutesAgo: 3 * 24 * 60 - 2, body: "Kablosuz ağın adı ve şifresi modemin altındaki etikette yazılıdır. Modem salondaki televizyon ünitesinin üzerindedir.", sources: ["kb:wifi"] },
    ],
  },
  {
    property: 4,
    stay: "anchor",
    status: "answered",
    messages: [
      { who: "guest", minutesAgo: 5 * 60, body: "Thank you for the lovely stay!", language: "en", intent: "general" },
      { who: "host", minutesAgo: 5 * 60 - 20, body: "Thank you for staying with us. Safe travels!", language: "en" },
    ],
  },
  {
    property: 5,
    stay: "anchor",
    status: "answered",
    messages: [
      { who: "guest", minutesAgo: 2 * 24 * 60, body: "Hallo, wo finde ich das WLAN-Passwort?", language: "de", intent: "wifi" },
      { who: "ai", minutesAgo: 2 * 24 * 60 - 2, body: "Hallo! Netzwerkname und Passwort stehen auf dem Etikett unter dem Router. Der Router steht im Wohnzimmer auf dem Fernsehschrank.", language: "de", sources: ["kb:wifi"] },
    ],
  },
  {
    property: 6,
    stay: "next",
    status: "answered",
    messages: [
      { who: "guest", minutesAgo: 20 * 60, body: "Здравствуйте! Где можно припарковаться?", language: "ru", intent: "parking" },
      { who: "ai", minutesAgo: 20 * 60 - 2, body: "Здравствуйте! Перед виллой есть частная парковка на две машины.", language: "ru", sources: ["kb:parking"] },
    ],
  },
  {
    property: 7,
    stay: "anchor",
    status: "problem",
    priority: "urgent",
    skippedReason: "complaint",
    messages: [
      { who: "guest", minutesAgo: 5 * 60, body: "Klima çalışmıyor, oda çok sıcak. Bakabilir misiniz?", intent: "complaint" },
      { who: "host", minutesAgo: 4 * 60, body: "Çok üzgünüz. Teknisyenimiz bugün saat 17:00'de gelecek." },
    ],
    maintenance: { title: "Klima arızası", description: "Misafir klimanın çalışmadığını bildirdi; teknisyen 17:00'de." },
  },
  {
    property: 8,
    stay: "anchor",
    status: "new",
    // 7 saat: günün saatinden bağımsız olarak panele düşer ("çıkışı yaklaşan" ya da "6 saattir cevapsız").
    messages: [{ who: "guest", minutesAgo: 7 * 60, body: "Yarın çıkışı 13:00'e uzatabilir miyiz?", intent: "late_checkout" }],
  },
  {
    property: 9,
    stay: "past",
    status: "problem",
    priority: "urgent",
    skippedReason: "refund",
    messages: [
      { who: "guest", minutesAgo: 6 * 24 * 60, body: "Temizlik ücretinin iadesini istiyorum, ev teslimde temiz değildi.", intent: "refund" },
      { who: "host", minutesAgo: 6 * 24 * 60 - 45, body: "Geri bildiriminiz için teşekkür ederiz; talebinizi inceliyoruz." },
    ],
  },
  {
    property: 10,
    stay: "next",
    status: "new",
    messages: [{ who: "guest", minutesAgo: 8 * 60, body: "Otopark var mı? Arabayla geleceğiz.", intent: "parking" }],
  },
  {
    property: 11,
    stay: "next",
    status: "answered",
    messages: [
      { who: "guest", minutesAgo: 14 * 60, body: "Köpeğimizi getirebilir miyiz?", intent: "general" },
      { who: "ai", minutesAgo: 14 * 60 - 2, body: "Maalesef evimizde evcil hayvan kabul edilmemektedir.", sources: ["kb:rules"] },
    ],
  },
];

export interface BuildDemoOptions {
  now: Date;
  seed?: number;
}

export function buildDemoDataset(opts: BuildDemoOptions): DemoDataset {
  const { now } = opts;
  const rnd = mulberry32(opts.seed ?? DEMO_SEED);
  const todayKey = dateKeyInTimeZone(now, DEMO_TIMEZONE);
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  const org: DemoOrgRow = {
    id: DEMO_ORG_ID,
    name: "Lale Konaklama (Demo)",
    timezone: DEMO_TIMEZONE,
    language: "tr",
    aiReplyTone: "warm",
    aiSignature: "Lale Konaklama",
    // Açık görünür ama HİÇBİR ŞEY GÖNDERMEZ: gönderim yolları kanal kimlik bilgisi ister, demo'da yok.
    autoReplyHospitable: true,
    autoReplyStartHour: 0,
    autoReplyEndHour: 0,
    autoWelcome: true,
    autoCheckin: true,
    autoCheckout: true,
    lateCheckoutOfferText: "Müsaitlik varsa çıkışınızı 13:00'e kadar uzatabiliriz.",
  };

  const users: DemoUserRow[] = [
    { id: id("user", "reviewer"), name: "Demo İnceleme", email: DEMO_LOGIN_EMAIL, role: "manager" },
    { id: id("user", "staff", 1), name: "Temizlik Ekibi A", email: "lxdemo-staff-1@example.com", role: "staff" },
    { id: id("user", "staff", 2), name: "Teknik Ekip", email: "lxdemo-staff-2@example.com", role: "staff" },
  ];
  const cleaner = users[1].id;
  const technician = users[2].id;

  const properties: DemoPropertyRow[] = PROPERTY_SPECS.map((p) => ({
    id: id("prop", p.slug),
    name: p.name,
    address: p.district,
    city: p.city,
    country: "Türkiye",
    checkInTime: p.checkIn,
    checkOutTime: p.checkOut,
  }));

  const reservations: DemoReservationRow[] = [];
  const staysByProperty: { stay: Stay; resId: string }[][] = [];
  let guestCursor = 0;
  PROPERTY_SPECS.forEach((p, i) => {
    const stays = fillStays(anchorStays(i, rnd), rnd);
    const list: { stay: Stay; resId: string }[] = [];
    stays.forEach((s, n) => {
      const resId = id("res", p.slug, n + 1);
      const nights = s.end - s.start;
      const channel = channelOf(rnd);
      const amount = nights * p.nightly;
      reservations.push({
        id: resId,
        propertyId: properties[i].id,
        guestName: GUEST_NAMES[guestCursor++ % GUEST_NAMES.length],
        guestExternalId: null,
        arrivalDate: dayAt(todayKey, s.start),
        departureDate: dayAt(todayKey, s.end),
        channel,
        status: s.end < 0 ? "completed" : "confirmed",
        totalAmount: amount,
        totalAmountDec: amount.toFixed(2),
        currency: "TRY",
      });
      list.push({ stay: s, resId });
    });
    staysByProperty.push(list);
  });

  // İki doğrudan talep (onay bekliyor): son iki mülkün çapa DIŞI ilk gelecek konaklaması.
  for (const i of [10, 11]) {
    const future = staysByProperty[i].find((x) => !x.stay.anchor && x.stay.start > 7);
    const r = future && reservations.find((x) => x.id === future.resId);
    if (r) {
      r.status = "pending";
      r.channel = "direct";
    }
  }

  // Tekrar eden misafir: aynı kişi iki farklı mülkte (geçmiş + gelecek), kararlı dış kimlikle.
  const returningPast = staysByProperty[0].find((x) => x.stay.end < -20);
  const returningNext = staysByProperty[3].find((x) => x.stay.start > 10);
  for (const x of [returningPast, returningNext]) {
    const r = x && reservations.find((y) => y.id === x.resId);
    if (r) {
      r.guestName = "Selin A.";
      r.guestExternalId = id("guest", "returning");
    }
  }

  // İptaller (İptaller sayfası için): mülk başına en fazla DEMO_MAX_CANCELLED_PER_PROPERTY.
  for (const [i, offsets] of [
    [1, [18]],
    [4, [-30, 40]],
    [9, [12]],
  ] as const) {
    offsets.slice(0, DEMO_MAX_CANCELLED_PER_PROPERTY).forEach((start, k) => {
      const nights = 3;
      const amount = nights * PROPERTY_SPECS[i].nightly;
      reservations.push({
        id: id("res", PROPERTY_SPECS[i].slug, `iptal${k + 1}`),
        propertyId: properties[i].id,
        guestName: GUEST_NAMES[guestCursor++ % GUEST_NAMES.length],
        guestExternalId: null,
        arrivalDate: dayAt(todayKey, start),
        departureDate: dayAt(todayKey, start + nights),
        channel: channelOf(rnd),
        status: "cancelled",
        totalAmount: amount,
        totalAmountDec: amount.toFixed(2),
        currency: "TRY",
      });
    });
  }

  // Görevler — `createReservationTasks` ile aynı biçim: gelecek girişe hazırlık, gelecek/bugünkü
  // çıkışa temizlik (panoda "eksik görev" bandı çıkmaz). Son 14 günün çıkış temizlikleri tamamlanmış.
  const tasks: DemoTaskRow[] = [];
  for (const r of reservations) {
    if (r.status === "cancelled") continue;
    const arr = Math.round((r.arrivalDate.getTime() - dayAt(todayKey, 0).getTime()) / 86_400_000);
    const dep = Math.round((r.departureDate.getTime() - dayAt(todayKey, 0).getTime()) / 86_400_000);
    if (arr >= 0) {
      tasks.push({
        id: `${r.id.replace(`${DEMO_ID_PREFIX}res-`, `${DEMO_ID_PREFIX}task-`)}-hazirlik`,
        propertyId: r.propertyId,
        reservationId: r.id,
        type: "checkin_prep",
        origin: "system",
        title: `${r.guestName} girişi için hazırlık`,
        description: "Hoş geldin hazırlığı, anahtar/giriş kontrolü.",
        dueAt: r.arrivalDate,
        status: "todo",
        priority: "standard",
        assignedToId: null,
        sourceMessageId: null,
      });
    }
    if (dep >= -14) {
      tasks.push({
        id: `${r.id.replace(`${DEMO_ID_PREFIX}res-`, `${DEMO_ID_PREFIX}task-`)}-temizlik`,
        propertyId: r.propertyId,
        reservationId: r.id,
        type: "cleaning",
        origin: "system",
        title: `Çıkış temizliği - ${r.guestName}`,
        description: "Çıkış sonrası tam temizlik ve çarşaf/havlu değişimi.",
        dueAt: r.departureDate,
        status: dep < 0 ? "done" : dep === 0 ? "in_progress" : "todo",
        priority: "standard",
        assignedToId: dep <= 1 ? cleaner : null,
        sourceMessageId: null,
      });
    }
  }

  // Konuşmalar.
  const conversations: DemoConversationRow[] = [];
  const messages: DemoMessageRow[] = [];
  const guestName = (resId: string) => reservations.find((r) => r.id === resId)?.guestName ?? "Misafir";
  THREADS.forEach((t, n) => {
    const list = staysByProperty[t.property];
    const pick =
      t.stay === "anchor"
        ? list.find((x) => x.stay.anchor && x.stay.end >= 0) ?? list.find((x) => x.stay.anchor)
        : t.stay === "next"
          ? list.find((x) => x.stay.start > 0)
          : list.filter((x) => x.stay.end < -3).at(-1);
    if (!pick) return;
    const res = reservations.find((r) => r.id === pick.resId)!;
    const convId = id("conv", n + 1);
    const guest = guestName(res.id);
    t.messages.forEach((m, k) => {
      const isGuest = m.who === "guest";
      messages.push({
        id: id("msg", n + 1, k + 1),
        conversationId: convId,
        direction: isGuest ? "inbound" : "outbound",
        senderName: isGuest ? guest : m.who === "ai" ? AI_SENDER : HOST_SENDER,
        body: m.body,
        language: m.language ?? "tr",
        aiIntent: isGuest ? m.intent ?? null : null,
        aiAssisted: m.who === "ai",
        authorType: m.who,
        aiSourcesJson: m.who === "ai" && m.sources ? JSON.stringify(m.sources) : null,
        createdAt: minutesAgo(m.minutesAgo),
      });
    });
    const last = t.messages[t.messages.length - 1];
    conversations.push({
      id: convId,
      propertyId: res.propertyId,
      reservationId: res.id,
      channel: res.channel,
      guestIdentifier: guest,
      status: t.status,
      priority: t.priority ?? "standard",
      lastMessageAt: minutesAgo(last.minutesAgo),
      skippedReason: t.skippedReason ?? null,
    });
    if (t.maintenance) {
      const trigger = messages.find((m) => m.conversationId === convId && m.direction === "inbound");
      tasks.push({
        id: id("task", "bakim", n + 1),
        propertyId: res.propertyId,
        reservationId: res.id,
        type: "maintenance",
        origin: "manual",
        title: t.maintenance.title,
        description: t.maintenance.description,
        dueAt: minutesAgo(-2 * 60),
        status: "in_progress",
        priority: "urgent",
        assignedToId: technician,
        sourceMessageId: trigger?.id ?? null,
      });
    }
  });

  // Operasyonel görevler (rezervasyondan bağımsız).
  tasks.push(
    {
      id: id("task", "eksik", 1),
      propertyId: properties[3].id,
      reservationId: null,
      type: "restock",
      origin: "manual",
      title: "Kahve kapsülü ve çay yenile",
      description: "Mutfak dolabındaki kapsül kutusu bitmek üzere.",
      dueAt: dayAt(todayKey, 1),
      status: "awaiting_review",
      priority: "standard",
      assignedToId: cleaner,
      sourceMessageId: null,
    },
    {
      id: id("task", "camasir", 1),
      propertyId: properties[5].id,
      reservationId: null,
      type: "laundry",
      origin: "manual",
      title: "Nevresim takımlarını çamaşırhaneye götür",
      description: "Dört takım nevresim + sekiz havlu.",
      dueAt: dayAt(todayKey, 0),
      status: "todo",
      priority: "low",
      assignedToId: cleaner,
      sourceMessageId: null,
    },
  );

  const kbItems = PROPERTY_SPECS.flatMap((p, i) => kbFor(p, properties[i].id));

  const templates: DemoTemplateRow[] = [
    {
      id: id("tpl", 1),
      category: "welcome",
      title: "Karşılama",
      body: "Merhaba {{guestName}}, rezervasyonunuz için teşekkür ederiz. Sorularınız için bu sohbetten bize yazabilirsiniz.",
      language: "tr",
    },
    {
      id: id("tpl", 2),
      category: "checkout",
      title: "Çıkış hatırlatması",
      body: "Merhaba {{guestName}}, bizi tercih ettiğiniz için teşekkür ederiz. Çıkışta anahtarı kutuya bırakmanız yeterlidir. İyi yolculuklar!",
      language: "tr",
    },
    {
      id: id("tpl", 3),
      category: "welcome",
      title: "Welcome",
      body: "Hi {{guestName}}, thank you for your booking. Feel free to message us here with any questions.",
      language: "en",
    },
  ];

  return { now, todayKey, org, users, properties, reservations, conversations, messages, tasks, kbItems, templates };
}
