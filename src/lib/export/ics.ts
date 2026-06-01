// ICS (iCalendar / RFC 5545) feed generator for reservation exports.
// Produces a VCALENDAR with one VEVENT per reservation so that external
// channels (Airbnb, Booking.com, Google Calendar) can subscribe and block
// the corresponding dates.

export interface IcsEvent {
  uid: string;
  summary: string;
  start: Date;
  end: Date;
  description?: string | null;
  /** When true, the event is emitted as an all-day (date-only) block. */
  allDay?: boolean;
}

/** Escape text per RFC 5545 (commas, semicolons, backslashes, newlines). */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold long lines to 75 octets as RFC 5545 recommends. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    // Continuation lines are prefixed with a single space.
    chunks.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return chunks.join("\r\n");
}

/** Format a Date as a UTC datetime stamp: YYYYMMDDTHHmmssZ. */
function formatUtcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Format a Date as a date-only value in local terms: YYYYMMDD. */
function formatDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Build a complete VCALENDAR document from a set of events.
 * `calendarName` becomes X-WR-CALNAME so subscribers show a friendly title.
 */
export function buildIcsCalendar(calendarName: string, events: IcsEvent[]): string {
  const now = formatUtcStamp(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GuestOps AI//Reservation Feed//TR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];

  for (const ev of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeIcsText(ev.uid)}`);
    lines.push(`DTSTAMP:${now}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(ev.start)}`);
      lines.push(`DTEND;VALUE=DATE:${formatDateOnly(ev.end)}`);
    } else {
      lines.push(`DTSTART:${formatUtcStamp(ev.start)}`);
      lines.push(`DTEND:${formatUtcStamp(ev.end)}`);
    }
    lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
    if (ev.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Generate a hard-to-guess token for a public calendar feed URL. */
export function generateCalendarToken(): string {
  // Two UUIDs (without dashes) give a 64-char, 256-bit-ish secret.
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}
