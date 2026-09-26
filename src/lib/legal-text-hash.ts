import { createHash } from "crypto";
import { SECTIONS as GIZLILIK_SECTIONS } from "@/app/(legal)/gizlilik/content";
import { SECTIONS as MESAFELI_SATIS_SECTIONS } from "@/app/(legal)/mesafeli-satis/content";
import { SECTIONS as ON_BILGILENDIRME_SECTIONS } from "@/app/(legal)/on-bilgilendirme/content";
import { SECTIONS as KOSULLAR_SECTIONS } from "@/app/(legal)/kosullar/content";

// Tamper-evident companion to LEGAL_VERSION (which is a hand-bumped label — a
// forgotten bump on a real text edit would silently understate what was shown).
// This hash is derived from the ACTUAL section content at server start, in a
// fixed order, so it can never drift from what a user actually saw: any edit to
// any of the 4 legal pages changes the hash on the next boot even if nobody
// remembers to touch LEGAL_VERSION. Not a replacement for LEGAL_VERSION (which
// stays the human-readable, deliberately-bumped release label) — a second,
// independent proof alongside it.
function computeLegalTextHash(): string {
  const canonical = JSON.stringify([
    KOSULLAR_SECTIONS,
    GIZLILIK_SECTIONS,
    MESAFELI_SATIS_SECTIONS,
    ON_BILGILENDIRME_SECTIONS,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export const LEGAL_TEXT_HASH = computeLegalTextHash();
