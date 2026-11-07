import { addZonedDays, dateKeyInTimeZone, zonedWallClockToUtc } from "@/lib/timezone";

// ---------------------------------------------------------------------------
// Misafir sözü — SAF yaprak (açık taahhüt hafızası A; migration 62): kapalı küme, panel etiketleri, son an hesabı, süre metni. DB yok
// (istemci kartı ve Dikkat Gerektirenler paneli de kullanır). Yazma mantığı `lib/guest-commitments.ts`.
// ---------------------------------------------------------------------------

export const COMMITMENT_KINDS = ["towels", "supplies", "cleaning", "maintenance"] as const;
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];

/** Panel etiketi (ev sahibinin gördüğü; misafire GİTMEZ). */
export const COMMITMENT_KIND_LABELS: Record<CommitmentKind, string> = {
  towels: "Havlu / çarşaf",
  supplies: "Eksik eşya",
  cleaning: "Temizlik",
  maintenance: "Arıza / bakım",
};

/**
 * Sözün KONUSU (I1, kurucu 10-17 "A", migration 73): kapalı küme kısa kod. Aynı tür + aynı saatte iki FARKLI konu (klima 18:00 + musluk 18:00)
 * iki ayrı söz + iki görevdir. Kod İngilizce ASCII (İngilizce mesajdan gelen "AC" ile Türkçe "klima" aynı konuya düşsün); ekranda etiket.
 */
export const COMMITMENT_TOPICS = [
  "ac",
  "heating",
  "hot_water",
  "faucet",
  "toilet",
  "shower",
  "fridge",
  "dishwasher",
  "laundry",
  "stove",
  "microwave",
  "tv",
  "wifi",
  "door",
  "light",
  "window",
  "socket",
  "elevator",
  "water",
  "toilet_paper",
  "shampoo",
  "soap",
  "coffee",
  "tea",
  "sugar",
  "battery",
  "bulb",
  "trash_bags",
  "drinking_water",
  "detergent",
] as const;
export type CommitmentTopic = (typeof COMMITMENT_TOPICS)[number];

/** Panel etiketi (ev sahibinin gördüğü; misafire GİTMEZ). */
export const COMMITMENT_TOPIC_LABELS: Record<CommitmentTopic, string> = {
  ac: "klima",
  heating: "ısıtma",
  hot_water: "sıcak su",
  faucet: "musluk",
  toilet: "tuvalet",
  shower: "duş",
  fridge: "buzdolabı",
  dishwasher: "bulaşık makinesi",
  laundry: "çamaşır makinesi",
  stove: "ocak / fırın",
  microwave: "mikrodalga",
  tv: "televizyon",
  wifi: "internet",
  door: "kapı / kilit",
  light: "aydınlatma",
  window: "pencere / perde",
  socket: "priz",
  elevator: "asansör",
  water: "su",
  toilet_paper: "tuvalet kağıdı",
  shampoo: "şampuan",
  soap: "sabun",
  coffee: "kahve",
  tea: "çay",
  sugar: "şeker",
  battery: "pil",
  bulb: "ampul",
  trash_bags: "çöp poşeti",
  drinking_water: "içme suyu",
  detergent: "deterjan",
};

export function isCommitmentTopic(v: unknown): v is CommitmentTopic {
  return typeof v === "string" && (COMMITMENT_TOPICS as readonly string[]).includes(v);
}

/** "Arıza / bakım" ya da "Arıza / bakım · klima". */
/**
 * Sözün ZAMAN KESİNLİĞİ (kurucu 10-17 gece, migration 75): açık saat · gün dilimi · yalnız gün. Saat UYDURULMAZ — "akşam" akşam olarak,
 * "yarın" saat belirtilmeden tutulur. NULL (eski satır) = açık saat.
 */
export const DUE_PRECISIONS = ["time", "part", "day"] as const;
export type DuePrecision = (typeof DUE_PRECISIONS)[number];
export const DAY_PART_CODES = ["morning", "noon", "afternoon", "late_afternoon", "evening", "night", "midnight", "soon"] as const;
export type DayPartCode = (typeof DAY_PART_CODES)[number];
export const DAY_PART_LABELS: Record<DayPartCode, string> = {
  morning: "sabah",
  noon: "öğle",
  afternoon: "öğleden sonra",
  late_afternoon: "akşamüstü",
  evening: "akşam",
  night: "gece",
  midnight: "gece yarısı",
  soon: "kısa süre içinde",
};
export function isDayPartCode(v: unknown): v is DayPartCode {
  return typeof v === "string" && (DAY_PART_CODES as readonly string[]).includes(v);
}

/** Açık saatli sözde "gecikti" demeden önceki pay (Opus 10-17: 10:00 sözüne 10:01'de "gecikti" gürültü). Dilim / gün sözünde son an zaten pencere sonu. */
export const COMMITMENT_LATE_TOLERANCE_MIN = 30;

/**
 * SÖZ → GÖREV OTOMATİK anahtarı (kurucu 10-17 gece, "herkese birden"): yalnız "1". Açıkken ev sahibinin yazdığı söz onaysız söz + görev olur
 * (`guest-commitments-auto.ts`) ve işletme ayarı `autoCommitmentsEnabled` söz önerisini de yönetir; kapalıyken bugünkü davranış (öneri +
 * onay). Saf modülde: öneri yükleyicisi de okur (döngüsel içe aktarma olmasın).
 */
export function hostCommitmentAutoEnabled(): boolean {
  return process.env.HOST_COMMITMENT_AUTO_ENABLED === "1";
}

/**
 * Gecikmiş söz için TEK hatırlatma eşiği (kurucu 10-17 gece: "Hatırlat, kapatma"): son andan 1 gün sonra dikkat satırının metni "Söz 1 gündür
 * açık" olur — e-posta yok, kendiliğinden kapatma yok; ev sahibi görevi tamamlar ya da iptal eder.
 */
export const COMMITMENT_REMIND_AFTER_MIN = 24 * 60;

/** Söz ne zaman "gecikti" sayılır (son an + açık saatte pay). */
export function commitmentLateAt(c: { dueAt: Date; duePrecision?: string | null }): Date {
  const pad = c.duePrecision == null || c.duePrecision === "time" ? COMMITMENT_LATE_TOLERANCE_MIN * 60_000 : 0;
  return new Date(c.dueAt.getTime() + pad);
}

/** Öneri / kayıt metni: "yarın 10:00" · "bugün akşam" · "bugün, kısa süre içinde" · "yarın (saat belirtilmedi)". */
export function commitmentWhenText(
  day: "today" | "tomorrow",
  w: { precision: "time"; time: string } | { precision: "part"; dayPart: DayPartCode } | { precision: "day" },
): string {
  const d = day === "tomorrow" ? "yarın" : "bugün";
  if (w.precision === "time") return `${d} ${w.time}`;
  if (w.precision === "part") return w.dayPart === "soon" ? `${d}, ${DAY_PART_LABELS.soon}` : `${d} ${DAY_PART_LABELS[w.dayPart]}`;
  return `${d} (saat belirtilmedi)`;
}

/**
 * Kayıtlı sözün zamanı (ev sahibine): "bugün 10:00" · "yarın akşam" · "dün (saat belirtilmedi)" · "21 Eki 10:00". Dilim / gün sözünde `dueAt`
 * pencere sonudur — gösterim GÜNÜ gece / gece yarısı penceresinde bir gün geridir (pencere ertesi güne taşar).
 */
export function storedCommitmentWhen(
  c: { dueAt: Date; duePrecision?: string | null; dayPart?: string | null },
  now: Date,
  tz: string,
): string {
  const precision = c.duePrecision === "part" || c.duePrecision === "day" ? c.duePrecision : "time";
  const spill = precision === "part" && (c.dayPart === "night" || c.dayPart === "midnight");
  const anchor = spill ? addZonedDays(c.dueAt, -1, tz) : c.dueAt;
  const key = dateKeyInTimeZone(anchor, tz);
  const word =
    key === dateKeyInTimeZone(now, tz)
      ? "bugün"
      : key === dateKeyInTimeZone(addZonedDays(now, 1, tz), tz)
        ? "yarın"
        : key === dateKeyInTimeZone(addZonedDays(now, -1, tz), tz)
          ? "dün"
          : anchor.toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: tz });
  if (precision === "time") return `${word} ${c.dueAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: tz })}`;
  if (precision === "part" && isDayPartCode(c.dayPart)) return c.dayPart === "soon" ? `${word}, ${DAY_PART_LABELS.soon}` : `${word} ${DAY_PART_LABELS[c.dayPart]}`;
  return `${word} (saat belirtilmedi)`;
}

export function commitmentLabel(kind: CommitmentKind, topic: string | null | undefined): string {
  return isCommitmentTopic(topic) ? `${COMMITMENT_KIND_LABELS[kind]} · ${COMMITMENT_TOPIC_LABELS[topic]}` : COMMITMENT_KIND_LABELS[kind];
}

/** Sözün görev başlığı — TEK kaynak (yeni görev ve konu yazımında otomatik başlık eşleşmesi aynı metni kullanır). */
export function commitmentTaskTitle(kind: CommitmentKind, topic: string | null | undefined, dayPart?: string | null): string {
  // Gün dilimi sözü (kurucu 10-17: "akşam olarak tutsun") görevin SAATİNDE değil başlığında görünür — görev vadesi yalnız-tarih çapasıdır.
  const part = isDayPartCode(dayPart) ? ` · ${DAY_PART_LABELS[dayPart]}` : "";
  return `Misafire söz: ${commitmentLabel(kind, topic)}${part}`;
}

/**
 * Sistemin açtığı ve KİMSENİN DOKUNMADIĞI söz görevi (Opus 10-17 gece O2): yapılacak + otomatik başlık + atanmamış + açıklamasız + güncelleme /
 * not / fotoğraf yok. Konaklama bitince ve "Yanlış, kaldır"da YALNIZ böyle görev silinir — fotoğraflı görev silinip depoda yetim dosya kalmaz.
 */
export function untouchedCommitmentTaskWhere(taskId: string, kind: CommitmentKind, topic: string | null | undefined, dayPart: string | null | undefined) {
  return {
    id: taskId,
    status: "todo",
    title: commitmentTaskTitle(kind, topic, dayPart),
    assignedToId: null,
    description: null,
    updates: { none: {} },
  };
}

/**
 * Sözün görev vadesi: açık saatte o an; gün dilimi / gün sözünde YALNIZ-TARİH çapası (`YYYY-MM-DDT12:00:00.000Z` — görev panosu saat
 * göstermez, `taskDueTimeLabel`). Saat uydurulmaz (kurucu 10-17).
 */
export function commitmentTaskDueAt(dueAt: Date, duePrecision: string | null | undefined, dayKey: string | null): Date {
  if (duePrecision == null || duePrecision === "time" || !dayKey) return dueAt;
  return new Date(`${dayKey}T12:00:00.000Z`);
}

/**
 * Öneri ile mevcut söz AYNI söz mü (I1 birleştirme kuralı — onay `createGuestCommitment` bu yüklemle bağlanır): aynı tür ∧ aynı an ∧ konu
 * UYUMLU. Konu uyumu: ikisi aynı konu · ya da biri konusuz (NULL). İki FARKLI konu → ayrı söz.
 * Konusuz MEVCUT söz (elle form) + konulu öneri: BİRLEŞİR ve mevcut söze konu YAZILIR (kurucu Q1 "a", 10-17 — "sahiplenme"); ardından
 * aynı saatteki başka konulu öneri ayrı söz açar.
 */
type CommitmentSlot = { kind: string; dueAt: Date; topic?: string | null; duePrecision?: string | null; dayPart?: string | null };

/** Zaman kesinliği (NULL = eski satır = açık saat). */
function normPrecision(p: string | null | undefined): DuePrecision {
  return p === "part" || p === "day" ? p : "time";
}

/**
 * Aynı AN + aynı KESİNLİK (Opus 10-17 gece O20): "Havlu getireceğim" (gün) ile "Akşam havlu getireceğim" (akşam) aynı 23:59'da biter ama ayrı
 * sözdür; dilimde dilim de eşit olmalı.
 */
export function commitmentSlotSame(
  a: { dueAt: Date; duePrecision?: string | null; dayPart?: string | null },
  b: { dueAt: Date; duePrecision?: string | null; dayPart?: string | null },
): boolean {
  if (a.dueAt.getTime() !== b.dueAt.getTime()) return false;
  const pa = normPrecision(a.duePrecision);
  if (pa !== normPrecision(b.duePrecision)) return false;
  return pa !== "part" || (a.dayPart ?? null) === (b.dayPart ?? null);
}

export function commitmentSlotMatches(existing: CommitmentSlot, incoming: CommitmentSlot): boolean {
  if (existing.kind !== incoming.kind || !commitmentSlotSame(existing, incoming)) return false;
  return commitmentTopicsCompatible(existing.topic, incoming.topic);
}

/**
 * Mevcut açık söz öneriyi TAMAMEN karşılıyor mu (öneri listesi bu yüklemle gizler — onay bir şey değiştirmeyecekse öneri gösterilmez, "ölü
 * Onayla düğmesi" olmasın): aynı söz (↑) ∧ (öneri konusuz ∨ mevcut söz AYNI konuda). Konusuz söz + konulu öneri KARŞILAMAZ — onay söze konu
 * yazar (Q1 "a"), öneri görünür.
 */
export function commitmentSlotAbsorbs(existing: CommitmentSlot, incoming: CommitmentSlot): boolean {
  return commitmentSlotMatches(existing, incoming) && (incoming.topic == null || existing.topic === incoming.topic);
}

/** Konu uyumu: aynı konu ya da biri konusuz (NULL). İki FARKLI konu → uyumsuz. */
export function commitmentTopicsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  return a == null || b == null || a === b;
}

export const COMMITMENT_STATUSES = ["open", "done", "cancelled"] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export function isCommitmentKind(v: unknown): v is CommitmentKind {
  return typeof v === "string" && (COMMITMENT_KINDS as readonly string[]).includes(v);
}

/**
 * Ev sahibinin seçtiği "bugün / yarın + SS:DD" → mutlak an (işletmenin saat diliminde). Geçersiz saat → null.
 */
export function commitmentDueAt(input: { day: "today" | "tomorrow"; time: string }, timeZone: string, now: Date): Date | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(input.time.trim());
  if (!m) return null;
  const base = input.day === "tomorrow" ? addZonedDays(now, 1, timeZone) : now;
  const [y, mo, d] = dateKeyInTimeZone(base, timeZone).split("-").map(Number);
  return zonedWallClockToUtc(y, mo, d, Number(m[1]), Number(m[2]), 0, timeZone);
}

/** "2 sa 14 dk" / "30 dk" — kalan ya da geçen süre (dakika, mutlak değer). */
export function commitmentDurationLabel(minutes: number): string {
  const m = Math.max(0, Math.floor(Math.abs(minutes)));
  if (m < 60) return `${m} dk`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} sa` : `${h} sa ${rest} dk`;
}
