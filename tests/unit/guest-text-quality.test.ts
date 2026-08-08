import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPLY_SYSTEM_PROMPT, buildReplyUserPrompt } from "@/lib/ai/prompts";
import { DEFAULT_TEMPLATES } from "@/lib/templates";
import { suggestReplyFallback, detectGuestLanguage } from "@/lib/ai/fallback";
import { REPLY_TONE, type ReplyTone } from "@/lib/constants";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// GUEST-FACING TEXT QUALITY — pins for the defects found in the 2026-08-08
// copy audit. Every pin here targets the PROPERTY that matters, not the exact
// sentence: the sentences are host-facing copy and will be reworded, but
// "no shipped default admits fault", "no placeholder carries a case suffix"
// and "the tone block never orders what Section 10.6 bans" must survive.
//
// 🚨 Why these have to be tests at all: three of the defects were the prompt
// contradicting ITSELF (a tone bullet ordering the closing that Section 10.6
// forbids) and few-shot examples modelling the banned behaviour. Nothing in
// the type system or the golden set can see that class — it is text-vs-text.
// ---------------------------------------------------------------------------

const TONES = REPLY_TONE.values as ReplyTone[];

const promptInput = (tone: ReplyTone): SuggestReplyInput => ({
  guestMessage: "Merhaba, wifi şifresi nedir?",
  property: { name: "Galata Loft", checkInTime: "15:00", checkOutTime: "11:00", address: "Galata", city: "İstanbul" },
  reservation: {
    guestName: "Ada Yılmaz",
    arrivalDate: new Date("2026-06-01"),
    departureDate: new Date("2026-06-04"),
    status: "confirmed",
  },
  knowledgeBase: [{ category: "wifi", title: "Wi-Fi", content: "Ağ: Loft / Şifre: 12345678" }],
  tone,
  language: "tr",
});

/** Stay-stage wish closings — Section 10.6 "KONAKLAMA AŞAMASI VARSAYMA" bans these. */
const STAGE_WISH =
  /iyi tatiller|keyifli konaklama|keyifli bir konaklama|enjoy your stay|angenehmen aufenthalt|wünschen ihnen einen/i;

/** A bullet may NAME a banned phrase in order to forbid it; it may not ORDER one. */
const BAN_MARKER = /YASAK|YAZMA|yazma|KULLANMA|kullanma|DEĞİL/;

/**
 * The tone guidance the model actually receives, sliced out of the USER prompt
 * between its two fixed markers — not read off a module-local constant, and not
 * an open-ended `slice(indexOf(...))` that would let unrelated prompt text
 * satisfy the ban-marker check.
 */
function toneBullets(tone: ReplyTone): string[] {
  const prompt = buildReplyUserPrompt(promptInput(tone));
  const start = prompt.indexOf("İSTENEN TON:");
  const end = prompt.indexOf("DİL ZORUNLULUĞU");
  expect(start, "tone block start marker").toBeGreaterThan(-1);
  expect(end, "tone block end marker").toBeGreaterThan(start);
  const section = prompt.slice(start, end);
  expect(section, "tone block must actually carry the guidance").toMatch(/TON:/);
  return section.split(/\n\s*-\s/).slice(1);
}

/** Every example reply in the system prompt (few-shot block), unescaped. */
function exampleReplies(): string[] {
  const out: string[] = [];
  const re = /"reply":"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(REPLY_SYSTEM_PROMPT)) !== null) out.push(m[1].replace(/\\+"/g, '"'));
  return out;
}

// ===========================================================================
// A — the prompt must not contradict itself
// ===========================================================================
describe("tone guidance vs Section 10.6 (the tone block is injected AFTER the ban)", () => {
  it("no tone orders a stay-stage wish closing", () => {
    // The tone block reaches the model through the USER prompt and lands AFTER
    // the ban, so a tone bullet that orders "İyi tatiller!" simply wins.
    for (const tone of TONES) {
      for (const bullet of toneBullets(tone)) {
        if (STAGE_WISH.test(bullet)) {
          expect(bullet, `tone ${tone}`).toMatch(BAN_MARKER);
        }
      }
    }
  });

  it("the ban itself is still in the system prompt (the pin above cannot be satisfied by deleting it)", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain("KONAKLAMA AŞAMASI VARSAYMA");
    expect(REPLY_SYSTEM_PROMPT).toMatch(/iyi tatiller/i);
    // And the precedence is written down, because the tone block comes later.
    expect(REPLY_SYSTEM_PROMPT).toMatch(/TON REHBERİ BU YASAĞI EZMEZ/);
  });

  it("no tone orders repeating the guest's name at the close (Section 10.5: name once, at the start)", () => {
    for (const tone of TONES) {
      for (const bullet of toneBullets(tone)) {
        // NOTE: \w is ASCII-only in JS, so "adını" would never match \w* —
        // \S* is required for Turkish suffixes. (This bit me: the first version
        // of this pin stayed green under mutation.)
        if (/(ad|ism|isim)\S*\s+tekrar/i.test(bullet)) {
          expect(bullet, `tone ${tone}`).toMatch(BAN_MARKER);
        }
      }
    }
    // Counterpart rule still present, so the pin can't be met by dropping it.
    expect(REPLY_SYSTEM_PROMPT).toMatch(/İsimle hitabı yalnızca konuşmanın başında bir kez/);
  });
});

// ===========================================================================
// B — few-shot examples override rules, so they must obey them
// ===========================================================================
describe("few-shot example replies obey the rules they are meant to teach", () => {
  const replies = exampleReplies();

  it("finds the example block at all (guards against a vacuous suite)", () => {
    expect(replies.length).toBeGreaterThan(15);
  });

  it("no example closes with a stay-stage wish", () => {
    for (const reply of replies) expect(reply).not.toMatch(STAGE_WISH);
  });

  it("no example claims a third party / the authorities were notified", () => {
    // The product notifies the HOST. It notifies nobody else — a guest who
    // believes the gas company is already on the way may not call 112.
    for (const reply of replies) {
      expect(reply).not.toMatch(/ilgili birimler|yetkililer[ei]|resmi makam|authorities|emergency services have been/i);
    }
  });

  it("no example guarantees an outcome", () => {
    for (const reply of replies) {
      expect(reply).not.toMatch(
        /make sure it'?s sorted|kesinlikle çözül|halledeceğ|guarantee|garanti ediyor|sorunu çözeceğimi/i,
      );
    }
  });

  it("no example scripts an emergency procedure for the guest (KURAL-1: invented, unsourced instructions)", () => {
    for (const reply of replies) {
      expect(reply).not.toMatch(/pencereleri aç|havalandır|vanayı kapat|elektriği kes|gazı kapat/i);
    }
    // The safe direction is kept: the emergency example still points the guest
    // at real emergency services instead of inventing steps.
    expect(REPLY_SYSTEM_PROMPT).toMatch(/yerel acil servisleri ara/i);
  });

  it("no example uses corporate register for the escalation target (single-host product)", () => {
    for (const reply of replies) expect(reply).not.toMatch(/yöneticimiz|operatörümüz|our manager/i);
  });
});

// ===========================================================================
// C — shipped default templates are one click away in the composer
// ===========================================================================
describe("DEFAULT_TEMPLATES — nothing the product cannot keep", () => {
  const bodies = DEFAULT_TEMPLATES.map((t) => `${t.title}\n${t.body}`);

  it("no default admits fault or accepts liability", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(
        /kabul edilemez|bizim hatamız|kusurumuz|hatamızdan|ihmalimiz|unacceptable|our (fault|mistake|negligence)/i,
      );
    }
  });

  it("no default asserts a booking status the product cannot verify", () => {
    // "Rezervasyonunuz onaylanmıştır." was sendable while the request was still
    // pending — the composer does not gate templates on reservation.status.
    for (const body of bodies) {
      expect(body).not.toMatch(/rezervasyonunuz onayland|onaylanmıştır|booking is confirmed|reservation is confirmed/i);
    }
  });

  it("no default asserts a physical arrangement of an apartment it knows nothing about", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/kapı yanındaki|kutuya bırak|box by the door|in the agreed place/i);
    }
  });

  it("no default solicits a review with an expectation attached", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/değerlendirmenizi (merakla )?bekl|yorumunuzu bekl|looking forward to your review/i);
    }
  });

  it("no placeholder carries a Turkish case suffix", () => {
    // "{{propertyName}}'e" / "{{checkInTime}}'de" are wrong for back-vowel and
    // voiceless-final names and for clock times ("Villa Mavi'e", "Kaş'de",
    // "15:00'de"; TDK wants 'ye, 'ta, 15.00'te). Suffix logic is NOT the fix —
    // the sentence has to be written so no suffix lands on a placeholder.
    for (const t of DEFAULT_TEMPLATES) {
      // }} followed (optionally through an apostrophe) by a letter = a suffix
      // glued to a value the template cannot see.
      expect(t.body, `template ${t.id}`).not.toMatch(/\}\}['’]?[a-zA-ZçğıöşüÇĞİÖŞÜ]/);
    }
  });

  it("quiet hours agree with the knowledge-base preset (two shipped defaults, one house rule)", () => {
    // The KB preset is what the AI actually answers from; a template that
    // contradicts it makes the host's own two messages disagree.
    const kb = readFileSync(join(process.cwd(), "src/components/knowledge/kb-manager.tsx"), "utf8");
    const kbHour = kb.match(/Saat (\d{1,2}):00['’]?[dt]en sonra/)?.[1];
    expect(kbHour, "KB rules preset must state a quiet hour").toBeTruthy();

    const rules = DEFAULT_TEMPLATES.filter((t) => t.category === "rules");
    expect(rules.length).toBeGreaterThan(0);
    for (const t of rules) {
      const hours = [...t.body.matchAll(/(\d{1,2}):00/g)].map((m) => m[1]);
      expect(hours.length, `template ${t.id} must state a quiet hour`).toBeGreaterThan(0);
      for (const h of hours) expect(h).toBe(kbHour);
    }
  });
});

// ===========================================================================
// D — deterministic fallback replies (used whenever OpenAI is unavailable)
// ===========================================================================
describe("suggestReplyFallback — guest-facing copy", () => {
  const base = (guestMessage: string, tone: ReplyTone = "warm"): SuggestReplyInput => ({
    guestMessage,
    property: { name: "Galata Loft", checkInTime: "15:00", checkOutTime: "11:00", address: "Galata", city: "İstanbul" },
    reservation: {
      guestName: "Ada Yılmaz",
      arrivalDate: new Date(),
      departureDate: new Date(),
      status: "confirmed",
    },
    knowledgeBase: [],
    tone,
    language: "tr",
  });

  const TR_MESSAGES = [
    "Wifi şifresi nedir?",
    "Otopark var mı?",
    "Giriş saati kaçta?",
    "Çıkışta anahtarı ne yapacağım?",
    "Erken giriş yapabilir miyim?",
    "Geç çıkış mümkün mü?",
    "Klima çalışmıyor, içerisi çok sıcak!",
    "Paramı geri istiyorum lütfen.",
    "Yarın ayrılmak zorundayız, rezervasyonu kısaltabilir miyiz?",
    "Ev sahibiyle konuşmak istiyorum.",
    "Havlu değişimi mümkün mü?",
    "Ne zaman çıkış yapmalıyız?",
    "Merhaba, nasılsınız?",
  ];
  const EN_MESSAGES = [
    "What is the wifi password?",
    "Is there parking?",
    "What time is arrival?",
    "What should I do with the key when I leave?",
    "Can I arrive early?",
    "Is a late departure possible?",
    "The air conditioning is not working at all!",
    "I want a refund please.",
    "We have to leave tomorrow, can we shorten the booking?",
    "I would like to speak to the host.",
  ];
  const ALL = [...TR_MESSAGES, ...EN_MESSAGES];

  it("the corpus really exercises BOTH language branches (anti-vacuity guard)", () => {
    // The reply text is chosen by detectGuestLanguage, NOT by input.language.
    // A "Turkish" probe that the detector reads as English silently tests the
    // English string instead — which is exactly how the first version of the
    // corporate-register pin below stayed green under mutation.
    for (const msg of TR_MESSAGES) expect(detectGuestLanguage(msg), msg).toBe("tr");
    for (const msg of EN_MESSAGES) expect(detectGuestLanguage(msg), msg).not.toBe("tr");
  });

  it("never ends on a dangling sign-off", () => {
    // "Kind regards," with no name after it: Organization.aiSignature is
    // optional and defaults to NULL, so most orgs shipped the comma alone.
    for (const tone of TONES) {
      for (const msg of ALL) {
        const reply = suggestReplyFallback(base(msg, tone)).reply.trim();
        expect(reply, msg).not.toMatch(/[,:;]$/);
        expect(reply, msg).not.toMatch(/Kind regards|Best regards|Sincerely,?$/i);
      }
    }
  });

  it("never appends a courtesy closing to an apology or an escalation", () => {
    const highStakes = [
      "Klima çalışmıyor, içerisi çok sıcak!",
      "Paramı geri istiyorum lütfen.",
      "Yarın ayrılmak zorundayız, rezervasyonu kısaltabilir miyiz?",
      "Ev sahibiyle konuşmak istiyorum.",
      "The air conditioning is not working at all!",
      "I want a refund please.",
      "I would like to speak to the host.",
    ];
    for (const msg of highStakes) {
      const reply = suggestReplyFallback(base(msg)).reply;
      expect(reply, msg).not.toMatch(/İyi günler dileriz|Thank you\.$/);
    }
  });

  it("still closes ordinary informational replies (the fix is suppression, not deletion)", () => {
    // Two-directional: proves the closing was not simply removed everywhere.
    expect(suggestReplyFallback(base("Otopark var mı?")).reply).toContain("İyi günler dileriz.");
    expect(suggestReplyFallback(base("Is there parking?")).reply).toMatch(/Thank you\.$/);
  });

  it("never uses corporate register for the escalation target", () => {
    for (const msg of ALL) {
      expect(suggestReplyFallback(base(msg)).reply, msg).not.toMatch(/yöneticimiz|operatörümüz|our manager/i);
    }
  });

  it("keeps Turkish replies free of English scheduling jargon", () => {
    // The product's own UI calls these Giriş/Çıkış; "Check-in saatimiz" in an
    // otherwise Turkish sentence is the assistant slipping out of the host's voice.
    for (const msg of TR_MESSAGES) {
      expect(suggestReplyFallback(base(msg)).reply, msg).not.toMatch(/check-?in|check-?out/i);
    }
    // Counterpart: English replies DO keep the English terms.
    expect(suggestReplyFallback(base("What time is check-in?")).reply).toMatch(/check-in/i);
  });

  it("never states where the keys go when nobody told it", () => {
    // These two land on the `checkout` branch — "Çıkışta anahtarı..." does NOT
    // (the word "anahtar" routes it to `checkin`), which would make the pin vacuous.
    for (const msg of ["Ne zaman çıkış yapmalıyız?", "What time is check-out?"]) {
      const reply = suggestReplyFallback(base(msg)).reply;
      expect(reply, msg).not.toMatch(/belirtilen yer|kapı yanındaki|agreed place|box by the door/i);
    }
  });
});

// ---------------------------------------------------------------------------
// OTOMATİK GÖNDERİLEN İKİ METİN (08-08, denetimden bana devredildi).
// Bunlar `automation.ts`'te ve ikisi de MİSAFİRE OTOMATİK gidiyor — yani
// host'un gözden geçirdiği bir taslak değil, doğrudan yayın.
// ---------------------------------------------------------------------------
describe("otomatik gönderilen misafir metinleri", () => {
  const automationSrc = readFileSync(join(process.cwd(), "src/lib/automation.ts"), "utf8");
  /** Yorum satırlarını at: pin KENDİ açıklamamla tatmin olmasın. */
  const codeOnly = automationSrc
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");

  it("oto-yanıt dipnotu TUTULAMAYACAK bir düzeltme sözü VERMEZ", async () => {
    // Kapıdan geçen bir oto-yanıtı sonradan kimse okumuyor; "hata olursa
    // ekibimiz hemen düzeltir" demek altı dilde birden yalan söylemekti.
    const { automatedReplyNote } = await import("@/lib/automation");
    const broken = [
      /ekibimiz hemen düzeltir/i,
      /our team will fix it/i,
      /hilft unser Team sofort/i,
      /notre équipe corrige/i,
      /فريقنا فورًا/,
      /команда сразу поправит/i,
    ];
    for (const lang of ["tr", "en", "de", "fr", "ar", "ru", "zz"]) {
      const note = automatedReplyNote(lang, true);
      expect(note, `dil: ${lang}`).toBeTruthy();
      for (const re of broken) expect(note!, `dil: ${lang}`).not.toMatch(re);
    }
    // TERS YÖN: açıklama yükümlülüğü DURUYOR — metin hâlâ "otomatik" diyor.
    // Bu olmadan pin, dipnotu komple silen bir değişikliği de yeşil geçerdi.
    expect(automatedReplyNote("tr", true)).toMatch(/otomatik/i);
    expect(automatedReplyNote("en", true)).toMatch(/automated/i);
    // Ve kapatma anahtarları hâlâ çalışıyor.
    expect(automatedReplyNote("tr", false)).toBeNull();
  });

  it("bekletme mesajı ev sahibinin ya da yazanın CİNSİYETİNİ varsaymaz", () => {
    // Ev sahibi bizim MÜŞTERİMİZ; cinsiyetini bilmiyoruz. Almanca "er meldet
    // sich" ve Rusça "Я передал" (eril geçmiş zaman) bunu varsayıyordu.
    expect(codeOnly).not.toMatch(/er meldet sich/);
    expect(codeOnly).not.toMatch(/Я передал\b/);
    expect(codeOnly).not.toMatch(/он свяжется/);
    // TERS YÖN: metinler HÂLÂ VAR (silinerek "düzeltilmiş" olmasın).
    expect(codeOnly).toMatch(/Entschuldigen Sie die Unannehmlichkeit/);
    expect(codeOnly).toMatch(/Приносим извинения за неудобство/);
  });

  it("Türkçe bekletme mesajındaki koşul cümlesinin ÖZNESİ var", () => {
    // "…paylaşırsanız çözümü hızlandırır" → yüklemin öznesi yok. Doğru kuruluş
    // isim-fiildir: "…paylaşmanız çözümü hızlandırır".
    expect(codeOnly).not.toMatch(/paylaşırsanız çözümü hızlandırır/);
    expect(codeOnly).toMatch(/paylaşmanız çözümü hızlandırır/);
  });
});
