// Episode-based response measurement (Codex #33). The old metric looked at ONE
// pair per conversation — the very FIRST inbound ever vs the first outbound
// after it — so a long-running thread was scored once, years of later guest
// questions were invisible, and (worse) the conversation was only considered
// at all if it was CREATED in the window, excluding old-but-active threads.
//
// An EPISODE is a run of consecutive guest (inbound) messages followed by the
// host/AI's next outbound: the clock starts at the FIRST message of the run
// (that's when the guest began waiting) and stops at that outbound. A trailing
// run with no reply yet is still an episode — an unanswered guest counts
// against the rate, exactly like before, just per-episode now. Episodes are
// attributed to the window by when they START.

export interface EpisodeStats {
  answerable: number;
  answeredWithin24h: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** messages: ONE conversation's messages in chronological order. */
export function computeResponseEpisodes(
  messages: { direction: string; createdAt: Date }[],
  windowStart: Date,
): EpisodeStats {
  let answerable = 0;
  let answeredWithin24h = 0;
  let runStart: Date | null = null; // first inbound of the currently-open run

  const close = (end: Date | null) => {
    if (!runStart) return;
    if (runStart >= windowStart) {
      answerable++;
      if (end && end.getTime() - runStart.getTime() <= DAY_MS) answeredWithin24h++;
    }
    runStart = null;
  };

  for (const m of messages) {
    if (m.direction === "inbound") {
      if (!runStart) runStart = m.createdAt; // consecutive inbounds keep the FIRST anchor
    } else {
      close(m.createdAt); // outbound answers the open run (no-op when none is open)
    }
  }
  close(null); // trailing unanswered run = a miss, not invisible

  return { answerable, answeredWithin24h };
}
