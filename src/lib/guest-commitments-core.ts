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
