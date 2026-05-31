// ICS (iCalendar) parser for reservation imports.
// Handles VEVENT blocks with DTSTART/DTEND in both date-only and datetime formats.

export interface IcsReservation {
  guestName: string;
  arrivalDate: Date;
  departureDate: Date;
  sourceReference: string | null;
  notes: string | null;
  channel: "ics";
}

/** Unfold RFC 5545 long lines (continuation lines start with space or tab). */
function unfoldLines(text: string): string {
  return text.replace(/\r?\n[ \t]/g, "");
}

/** Parse a DTSTART / DTEND value into a JS Date. */
function parseIcsDate(value: string): Date | null {
  // Remove timezone id if present in the value (TZID is in the key, value is clean datetime)
  const clean = value.trim();

  // Date-only: YYYYMMDD
  if (/^\d{8}$/.test(clean)) {
    const year = parseInt(clean.slice(0, 4), 10);
    const month = parseInt(clean.slice(4, 6), 10) - 1;
    const day = parseInt(clean.slice(6, 8), 10);
    return new Date(year, month, day, 12, 0, 0); // noon to avoid TZ edge cases
  }

  // DateTime: YYYYMMDDTHHmmssZ or YYYYMMDDTHHmmss
  const dtMatch = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (dtMatch) {
    const [, y, mo, d, h, mi, s, z] = dtMatch;
    if (z === "Z") {
      return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
    }
    return new Date(
      parseInt(y, 10),
      parseInt(mo, 10) - 1,
      parseInt(d, 10),
      parseInt(h, 10),
      parseInt(mi, 10),
      parseInt(s, 10),
    );
  }

  // Fallback: try native Date parse
  const fallback = new Date(clean);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/** Decode common iCal escaped characters. */
function decodeIcsText(s: string): string {
  return s
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\n/gi, "\n")
    .replace(/\\\\/g, "\\")
    .trim();
}

/**
 * Parse an ICS string and return an array of reservation objects.
 * Skips VEVENTs that are missing required fields (DTSTART, DTEND).
 */
export function parseIcs(text: string): IcsReservation[] {
  const unfolded = unfoldLines(text);
  const lines = unfolded.split(/\r?\n/);

  const results: IcsReservation[] = [];
  let inEvent = false;
  let current: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      current = {};
      continue;
    }

    if (line === "END:VEVENT") {
      inEvent = false;

      // Extract key:value — the key may have params (e.g. DTSTART;TZID=Europe/Istanbul)
      const get = (baseKey: string): string | undefined => {
        // Find a key that starts with baseKey (possibly with params)
        const fullKey = Object.keys(current).find(
          (k) => k === baseKey || k.startsWith(baseKey + ";"),
        );
        return fullKey ? current[fullKey] : undefined;
      };

      const dtStartRaw = get("DTSTART");
      const dtEndRaw = get("DTEND");

      if (!dtStartRaw || !dtEndRaw) continue;

      const arrivalDate = parseIcsDate(dtStartRaw);
      const departureDate = parseIcsDate(dtEndRaw);

      if (!arrivalDate || !departureDate) continue;

      // Guest name: from SUMMARY
      const summary = decodeIcsText(get("SUMMARY") ?? "");
      const guestName = summary || "Misafir";

      // Notes: from DESCRIPTION
      const descRaw = get("DESCRIPTION");
      const notes = descRaw ? decodeIcsText(descRaw) : null;

      // Source reference: from UID
      const uid = get("UID");
      const sourceReference = uid ? uid.trim() : null;

      results.push({
        guestName,
        arrivalDate,
        departureDate,
        sourceReference,
        notes,
        channel: "ics",
      });

      continue;
    }

    if (!inEvent) continue;

    // Parse property line: KEY;PARAM=val:VALUE
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const keyPart = line.slice(0, colonIdx).toUpperCase();
    const valuePart = line.slice(colonIdx + 1);
    current[keyPart] = valuePart;
  }

  return results;
}
