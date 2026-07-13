// Episode-based response measurement (Codex #33). The old metric looked at ONE
// pair per conversation — the very FIRST inbound ever vs the first outbound
// after it — so a long-running thread was scored once, years of later guest
// questions were invisible, and (worse) the conversation was only considered
// at all if it was CREATED in the window, excluding old-but-active threads.
//
// An EPISODE is a run of consecutive guest (inbound) messages followed by the
// host/AI's next outbound: the clock starts at the FIRST message of the run
// (that's when the guest began waiting) and stops at that outbound. Episodes
// are attributed to the window by when they START.
//
// SLA CONTRACT (Codex follow-up — a guest who wrote 5 minutes ago has NOT
// missed anything yet):
//   * answered, delta <= 24h        → answerable + within
//   * answered, delta  > 24h        → answerable, NOT within (late stays late)
//   * unanswered, age  > 24h (@now) → answerable, NOT within (SLA expired)
//   * unanswered, age <= 24h (@now) → PENDING — excluded from the denominator
// Both boundaries are 24h-INCLUSIVE and consistent: at exactly 24h an answer
// still counts as within, so the unanswered run is still pending.

export interface EpisodeStats {
  answerable: number;
  answeredWithin24h: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** messages: ONE conversation's messages in chronological order. */
export function computeResponseEpisodes(
  messages: { direction: string; createdAt: Date }[],
  windowStart: Date,
  now: Date,
): EpisodeStats {
  let answerable = 0;
  let answeredWithin24h = 0;
  let runStart: Date | null = null; // first inbound of the currently-open run

  const closeAnswered = (end: Date) => {
    if (!runStart) return;
    if (runStart >= windowStart) {
      answerable++;
      if (end.getTime() - runStart.getTime() <= DAY_MS) answeredWithin24h++;
    }
    runStart = null;
  };

  for (const m of messages) {
    if (m.direction === "inbound") {
      if (!runStart) runStart = m.createdAt; // consecutive inbounds keep the FIRST anchor
    } else {
      closeAnswered(m.createdAt); // outbound answers the open run (no-op when none is open)
    }
  }
  // Trailing unanswered run: a miss ONLY once its 24h SLA has expired; a still-
  // fresh question is PENDING and stays out of the denominator entirely.
  if (runStart && runStart >= windowStart && now.getTime() - runStart.getTime() > DAY_MS) {
    answerable++;
  }

  return { answerable, answeredWithin24h };
}
