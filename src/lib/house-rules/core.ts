// ---------------------------------------------------------------------------
// MÜLKE ÖZGÜ EV KURALLARI — SAF ÇEKİRDEK (#188, kurucu kararları 09-26; tasarım docs/TASARIM-2026-09-26-ev-kurallari-politikasi.md).
//
// Bugün "kural ihlali" iki GLOBAL kelime listesinden, düz alt dizeyle üretilir (`fallback.ts`): mülkün kuralına,
// olumsuzlamaya, niyete bakmaz ("Our party of 4 will arrive…" tutulur). Hedef: hüküm mülkün ONAYLI kuralından ve
// misafirin tutumundan (anlama katmanı) KODDA verilir.
//
// Bu dilim YALNIZ saf karar + koddan kurulan metin: DB yok, ağ yok, ÇAĞIRANI YOK. Sözleşme:
//  · Yalnız ev sahibinin ONAYLADIĞI kural karar verir. Öneri (`suggested`) ve reddedilen kural "bana sor"dur.
//  · Aynı konuda çelişen iki onaylı kural = "bana sor" (belirsizlik güvenli değildir).
//  · Anlama katmanı sonuç vermediyse `fallback`: çağıran bugünkü kelime listesiyle tutar.
//  · Metin KODDAN kurulur (6 dil), model yazmaz. Yasak kural NAZİK ve açık söylenir (kurucu 09-26: "güzel bir dille yasak
//    olduğunu da belirtsin, kızar gibi değil"): azarlama / yaptırım / uyarı cümlesi yok.
//  · İzin metni yalnız EVET/HAYIR olarak söylenebilen konularda: parti (platformların genel yasağı), ek misafir (sayı /
//    ücret) ve sessiz saatler (saat bilgisi) için "izinli" kural otomatik izin cümlesine DÖNÜŞMEZ → ev sahibinde.
// ---------------------------------------------------------------------------

export const HOUSE_RULE_TOPICS = ["party_event", "smoking", "pets", "extra_guests", "quiet_hours", "visitors"] as const;
export type HouseRuleTopic = (typeof HOUSE_RULE_TOPICS)[number];

export const HOUSE_RULE_POLICIES = ["allowed", "forbidden", "ask_host"] as const;
export type HouseRulePolicy = (typeof HOUSE_RULE_POLICIES)[number];

export const HOUSE_RULE_STATUSES = ["suggested", "confirmed", "rejected"] as const;
export type HouseRuleStatus = (typeof HOUSE_RULE_STATUSES)[number];

/** Misafirin konuya göre tutumu (anlama katmanı). */
export const RULE_STANCES = ["asks_permission", "announces", "asks_info", "not_about_guest"] as const;
export type RuleStance = (typeof RULE_STANCES)[number];

export interface HouseRule {
  topic: HouseRuleTopic;
  policy: HouseRulePolicy;
  status: HouseRuleStatus;
}

export interface RuleUnderstanding {
  topic: HouseRuleTopic;
  stance: RuleStance;
}

export type HouseRuleOutcome =
  /** Anlama katmanı sonuç vermedi: çağıran bugünkü kelime listesiyle karar verir (tutar). */
  | { kind: "fallback" }
  /** Konu misafirin kendi eylemi değil ("party of 4", olumsuzlama, başkası): kural devreye girmez. */
  | { kind: "not_applicable" }
  /** Kural koddan söylenir ve gider; `notifyHost` = ev sahibine ayrıca açık iş + e-posta (yasak kuralı yapacağını söyleyen misafir). */
  | { kind: "state_rule"; policy: "allowed" | "forbidden"; notifyHost: boolean }
  /** Kural kararı yok: istek ev sahibinde açık iş olarak kalır (bugünkü gibi tutulur). */
  | { kind: "hold" }
  /** Kural cevabı değiştirmez: normal akış (bilgi tabanından cevap ya da bugünkü kapılar). */
  | { kind: "normal" };

/**
 * Konunun ETKİN politikası: yalnız onaylı kurallar; hiç yoksa ya da onaylılar çelişiyorsa "bana sor". Kapalı küme dışı
 * değer (bozuk kayıt) yok sayılır.
 */
export function effectivePolicy(rules: readonly HouseRule[], topic: HouseRuleTopic): HouseRulePolicy {
  const policies = new Set<HouseRulePolicy>();
  for (const r of rules) {
    if (r.topic !== topic || r.status !== "confirmed") continue;
    if (!(HOUSE_RULE_POLICIES as readonly string[]).includes(r.policy)) continue;
    policies.add(r.policy);
  }
  return policies.size === 1 ? [...policies][0] : "ask_host";
}

function known<T extends string>(set: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (set as readonly string[]).includes(v);
}

/** Karar tablosu (tasarım §2.C). Saf; kapalı küme dışı girdi → `fallback`. */
export function decideHouseRule(understanding: RuleUnderstanding | null, rules: readonly HouseRule[]): HouseRuleOutcome {
  if (!understanding || !known(HOUSE_RULE_TOPICS, understanding.topic) || !known(RULE_STANCES, understanding.stance)) {
    return { kind: "fallback" };
  }
  const { topic, stance } = understanding;
  if (stance === "not_about_guest") return { kind: "not_applicable" };
  let policy = effectivePolicy(rules, topic);
  // İzin cümlesi olmayan konuda "izinli" otomatik izne dönüşmez.
  if (policy === "allowed" && !ALLOWED_TOPICS.has(topic)) policy = "ask_host";

  if (policy === "forbidden") return { kind: "state_rule", policy, notifyHost: stance === "announces" };
  if (policy === "allowed") return stance === "announces" ? { kind: "normal" } : { kind: "state_rule", policy, notifyHost: false };
  return stance === "asks_info" ? { kind: "normal" } : { kind: "hold" };
}

export const HOUSE_RULE_LANGS = ["tr", "en", "de", "fr", "ar", "ru"] as const;
export type HouseRuleLang = (typeof HOUSE_RULE_LANGS)[number];

/** Tespit edilen dil → metin dili; tanınmayan → en (erken giriş onayıyla aynı kural). */
export function houseRuleLang(detected: string | null | undefined): HouseRuleLang {
  const code = (detected ?? "").trim().toLowerCase().slice(0, 2);
  return (HOUSE_RULE_LANGS as readonly string[]).includes(code) ? (code as HouseRuleLang) : "en";
}

// Selamsız (konuşmanın ortasında tekrar selam yok); cinsiyet varsaymaz; "biz" ya da edilgen — kimseyi suçlamaz.
const FORBIDDEN: Record<HouseRuleTopic, Record<HouseRuleLang, string>> = {
  party_event: {
    tr: "Evde parti ve etkinlik yapılmasına izin verilmiyor, anlayışınız için teşekkür ederiz.",
    en: "Parties and events aren't permitted in the home — thank you for your understanding.",
    de: "Partys und Veranstaltungen sind in der Unterkunft leider nicht gestattet – vielen Dank für Ihr Verständnis.",
    fr: "Les fêtes et événements ne sont pas autorisés dans le logement, merci de votre compréhension.",
    ar: "لا يُسمح بإقامة الحفلات أو المناسبات في المسكن، شكرًا لتفهمكم.",
    ru: "Вечеринки и мероприятия в квартире не допускаются — спасибо за понимание.",
  },
  smoking: {
    tr: "Evin içinde sigara içilmesine izin verilmiyor, anlayışınız için teşekkür ederiz.",
    en: "Smoking isn't permitted inside the home — thank you for your understanding.",
    de: "Rauchen ist in der Unterkunft leider nicht gestattet – vielen Dank für Ihr Verständnis.",
    fr: "Il n'est pas permis de fumer à l'intérieur du logement, merci de votre compréhension.",
    ar: "لا يُسمح بالتدخين داخل المسكن، شكرًا لتفهمكم.",
    ru: "Курение в квартире не допускается — спасибо за понимание.",
  },
  pets: {
    tr: "Evcil hayvan kabul edemiyoruz, anlayışınız için teşekkür ederiz.",
    en: "Unfortunately we can't accommodate pets — thank you for your understanding.",
    de: "Haustiere sind in der Unterkunft leider nicht erlaubt – vielen Dank für Ihr Verständnis.",
    fr: "Les animaux de compagnie ne sont malheureusement pas acceptés, merci de votre compréhension.",
    ar: "للأسف لا نستطيع استقبال الحيوانات الأليفة، شكرًا لتفهمكم.",
    ru: "К сожалению, размещение с домашними животными невозможно — спасибо за понимание.",
  },
  extra_guests: {
    tr: "Rezervasyondaki kişi sayısından fazla misafir kabul edemiyoruz, anlayışınız için teşekkür ederiz.",
    en: "We can't accommodate more guests than the number on the reservation — thank you for your understanding.",
    de: "Mehr Gäste als in der Buchung angegeben können wir leider nicht aufnehmen – vielen Dank für Ihr Verständnis.",
    fr: "Nous ne pouvons pas accueillir plus de personnes que le nombre indiqué dans la réservation, merci de votre compréhension.",
    ar: "لا نستطيع استقبال عدد ضيوف أكبر من العدد المذكور في الحجز، شكرًا لتفهمكم.",
    ru: "Мы не можем разместить больше гостей, чем указано в бронировании, — спасибо за понимание.",
  },
  quiet_hours: {
    tr: "Gece saatlerinde yüksek ses yapılmamasını rica ediyoruz, anlayışınız için teşekkür ederiz.",
    en: "We kindly ask that noise be kept down at night — thank you for your understanding.",
    de: "Wir bitten darum, nachts auf Lärm zu verzichten – vielen Dank für Ihr Verständnis.",
    fr: "Nous vous demandons de limiter le bruit la nuit, merci de votre compréhension.",
    ar: "نرجو تجنّب الضوضاء في ساعات الليل، شكرًا لتفهمكم.",
    ru: "Просим соблюдать тишину в ночное время — спасибо за понимание.",
  },
  visitors: {
    tr: "Rezervasyonda kayıtlı olmayan ziyaretçi kabul edemiyoruz, anlayışınız için teşekkür ederiz.",
    en: "Visitors who aren't on the reservation aren't permitted — thank you for your understanding.",
    de: "Besucher, die nicht in der Buchung stehen, sind leider nicht gestattet – vielen Dank für Ihr Verständnis.",
    fr: "Les visiteurs qui ne figurent pas sur la réservation ne sont pas autorisés, merci de votre compréhension.",
    ar: "لا يُسمح بدخول زوار غير مسجلين في الحجز، شكرًا لتفهمكم.",
    ru: "Посетители, не указанные в бронировании, не допускаются — спасибо за понимание.",
  },
};

// Yalnız evet/hayır olarak söylenebilen konular (↑ dosya başı).
const ALLOWED: Partial<Record<HouseRuleTopic, Record<HouseRuleLang, string>>> = {
  smoking: {
    tr: "Evde sigara içilmesine izin veriliyor.",
    en: "Smoking is permitted in the home.",
    de: "Rauchen ist in der Unterkunft erlaubt.",
    fr: "Il est permis de fumer dans le logement.",
    ar: "يُسمح بالتدخين في المسكن.",
    ru: "Курение в квартире разрешено.",
  },
  pets: {
    tr: "Evcil hayvan kabul ediyoruz.",
    en: "Pets are welcome.",
    de: "Haustiere sind willkommen.",
    fr: "Les animaux de compagnie sont acceptés.",
    ar: "الحيوانات الأليفة مرحّب بها.",
    ru: "Можно с домашними животными.",
  },
  visitors: {
    tr: "Ziyaretçi kabul edebilirsiniz.",
    en: "Visitors are welcome.",
    de: "Besuch ist erlaubt.",
    fr: "Les visites sont autorisées.",
    ar: "يُسمح باستقبال الزوار.",
    ru: "Гостей принимать можно.",
  },
};

const ALLOWED_TOPICS: ReadonlySet<HouseRuleTopic> = new Set(Object.keys(ALLOWED) as HouseRuleTopic[]);

/** Kuralın misafire söylenen cümlesi — YALNIZ `state_rule` sonucu için; başka her durumda `null`. */
export function houseRuleText(topic: HouseRuleTopic, outcome: HouseRuleOutcome, lang: HouseRuleLang): string | null {
  if (outcome.kind !== "state_rule") return null;
  const table = outcome.policy === "forbidden" ? FORBIDDEN[topic] : ALLOWED[topic];
  return table?.[lang] ?? null;
}
