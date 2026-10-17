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
export function commitmentLabel(kind: CommitmentKind, topic: string | null | undefined): string {
  return isCommitmentTopic(topic) ? `${COMMITMENT_KIND_LABELS[kind]} · ${COMMITMENT_TOPIC_LABELS[topic]}` : COMMITMENT_KIND_LABELS[kind];
}

/**
 * Öneri ile mevcut söz AYNI söz mü (I1 birleştirme kuralı — öneri listesi ve onay BİREBİR bu yüklemi kullanır; "görünür ama ölü öneri" olmasın):
 * aynı tür ∧ aynı an ∧ konu UYUMLU. Konu uyumu: ikisi aynı konu · ya da biri konusuz (NULL). İki FARKLI konu → ayrı söz.
 * ⚠️ Konusuz MEVCUT söz (elle form) + konulu öneri: bugünkü gibi BİRLEŞİR ve mevcut söze konu YAZILMAZ — "sahiplenme" (ikinci farklı konulu öneri
 * ayrı söz açsın) kurucu sorusu Q1'i bekliyor (`docs/arastirma-2026-10-15/KURUCU-SORULARI.md` §Q).
 */
export function commitmentSlotMatches(
  existing: { kind: string; dueAt: Date; topic?: string | null },
  incoming: { kind: string; dueAt: Date; topic?: string | null },
): boolean {
  if (existing.kind !== incoming.kind || existing.dueAt.getTime() !== incoming.dueAt.getTime()) return false;
  return commitmentTopicsCompatible(existing.topic, incoming.topic);
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
