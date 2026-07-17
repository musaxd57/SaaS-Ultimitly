import { prisma } from "@/lib/db";
import { badRequest, jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { isValidTimeZone } from "@/lib/timezone";

// Organization-level settings the UI can change. Booleans are the auto-reply
// switches; the hour fields define the channel auto-reply active window;
// aiReplyTone / aiSignature shape the AI's voice.
const BOOLEAN_FIELDS = ["autoReplyHospitable", "autoWelcome", "autoCheckin", "autoCheckout", "autoHoldingReplyEnabled", "autoClosingReplyEnabled", "autoTaskFromMessageEnabled", "autoSupplyRequestEnabled", "icalShowGuestName", "qrChatPinRequired"] as const;
const HOUR_FIELDS = ["autoReplyStartHour", "autoReplyEndHour"] as const;
const VALID_TONES = ["formal", "warm", "short", "luxury"] as const;
const SIGNATURE_MAX = 600;
const CLOSING_TEXT_MAX = 300; // a courtesy is one line, not a letter
const OFFER_TEXT_MAX = 400; // late-checkout offer: a short price/terms line (matches the prompt sanitizer cap)
// The offer is relayed to guests as the host's own word, so it must never carry a
// payment METHOD — Airbnb/Booking TOS forbid off-platform/cash arrangements. This
// is the DETERMINISTIC backstop for the prompt's payment-neutral rule (the model
// is told to stay neutral, but a host who writes "500 TL, elden ödeme" would have
// it relayed verbatim + possibly auto-sent). Host writes price/terms, not how to pay.
export const OFFER_PAYMENT_METHOD_RX =
  /elden|nakit|nakden|kapıda|iban|havale|\beft\b|western union|money ?gram|papara|\bcash\b|wire transfer|bank transfer|paypal|venmo|zelle/i;

/** Update organization-level settings (auto-reply window/toggle + AI tone/signature). */
export const PATCH = withManage(async (session, req) => {
  const data = await req.json().catch(() => null);
  if (!data || typeof data !== "object") {
    return badRequest({ _: "Geçerli bir gövde gerekli." });
  }

  const update: Record<string, boolean | number | string | null> = {};
  const errors: Record<string, string> = {};

  for (const field of BOOLEAN_FIELDS) {
    if (field in data) {
      if (typeof data[field] !== "boolean") errors[field] = "true/false olmalı.";
      else update[field] = data[field];
    }
  }
  // Stamp *EnabledAt ONLY on a genuine OFF→ON transition, so the engine acts
  // only on bookings/messages from when automation was actually switched on
  // (never the backlog). Re-saving other settings while a toggle is already on
  // must NOT push the baseline forward — that would silently skip messages for
  // bookings already in the pipeline.
  const enabling = (["autoReplyHospitable", "autoWelcome", "autoCheckin", "autoCheckout"] as const).filter(
    (f) => update[f] === true,
  );
  if (enabling.length > 0) {
    const current = await prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: {
        autoReplyHospitable: true,
        autoWelcome: true,
        autoCheckin: true,
        autoCheckout: true,
      },
    });
    const nowIso = new Date().toISOString();
    const stampOf = {
      autoReplyHospitable: "autoReplyEnabledAt",
      autoWelcome: "autoWelcomeEnabledAt",
      autoCheckin: "autoCheckinEnabledAt",
      autoCheckout: "autoCheckoutEnabledAt",
    } as const;
    for (const f of enabling) {
      if (current?.[f] !== true) update[stampOf[f]] = nowIso;
    }
  }
  for (const field of HOUR_FIELDS) {
    if (field in data) {
      const n = Number(data[field]);
      if (!Number.isInteger(n) || n < 0 || n > 23) errors[field] = "0-23 arası bir saat olmalı.";
      else update[field] = n;
    }
  }

  if ("aiReplyTone" in data) {
    if (!VALID_TONES.includes(data.aiReplyTone)) {
      errors.aiReplyTone = "Geçersiz ton.";
    } else {
      update.aiReplyTone = data.aiReplyTone;
    }
  }

  if ("aiSignature" in data) {
    const raw = data.aiSignature;
    if (raw !== null && typeof raw !== "string") {
      errors.aiSignature = "Metin olmalı.";
    } else {
      const trimmed = (raw ?? "").toString().trim();
      if (trimmed.length > SIGNATURE_MAX) {
        errors.aiSignature = `En fazla ${SIGNATURE_MAX} karakter.`;
      } else {
        // Empty string clears the signature.
        update.aiSignature = trimmed.length === 0 ? null : trimmed;
      }
    }
  }

  // Host-written courtesy line for the opt-in closing reply. Empty clears it →
  // the built-in per-language default goes out; set → sent VERBATIM (any language).
  if ("closingReplyText" in data) {
    const raw = data.closingReplyText;
    if (raw !== null && typeof raw !== "string") {
      errors.closingReplyText = "Metin olmalı.";
    } else {
      const trimmed = (raw ?? "").toString().trim();
      if (trimmed.length > CLOSING_TEXT_MAX) {
        errors.closingReplyText = `En fazla ${CLOSING_TEXT_MAX} karakter.`;
      } else {
        update.closingReplyText = trimmed.length === 0 ? null : trimmed;
      }
    }
  }

  // Host-written late-checkout / stay-extension offer. Empty clears it → the AI
  // reverts to today's behavior (never quotes a price, defers to the host). When
  // set, the AI may surface it on an actual late-checkout request — payment-neutral,
  // confirmation still routed to the host (see prompts.ts offer block).
  if ("lateCheckoutOfferText" in data) {
    const raw = data.lateCheckoutOfferText;
    if (raw !== null && typeof raw !== "string") {
      errors.lateCheckoutOfferText = "Metin olmalı.";
    } else {
      const trimmed = (raw ?? "").toString().trim();
      if (trimmed.length > OFFER_TEXT_MAX) {
        errors.lateCheckoutOfferText = `En fazla ${OFFER_TEXT_MAX} karakter.`;
      } else if (OFFER_PAYMENT_METHOD_RX.test(trimmed)) {
        errors.lateCheckoutOfferText =
          "Teklif metni ödeme yöntemi içeremez (elden/nakit/IBAN/havale vb.). Ödemeler her zaman platform üzerinden alınır; yalnızca fiyat/koşul yazın.";
      } else {
        update.lateCheckoutOfferText = trimmed.length === 0 ? null : trimmed;
      }
    }
  }

  if ("alertEmail" in data) {
    const raw = data.alertEmail;
    if (raw !== null && typeof raw !== "string") {
      errors.alertEmail = "Metin olmalı.";
    } else {
      const trimmed = (raw ?? "").toString().trim();
      if (trimmed && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
        errors.alertEmail = "Geçerli bir e-posta girin.";
      } else {
        // Empty clears it → falls back to the env ALERT_EMAIL.
        update.alertEmail = trimmed.length === 0 ? null : trimmed.toLowerCase();
      }
    }
  }

  // Org timezone: reports, day buckets and automation hour-gates run on this.
  // CLOSED SET — only IANA zones the runtime actually knows (isValidTimeZone);
  // free text would silently break every Intl call downstream.
  if ("timezone" in data) {
    const raw = data.timezone;
    if (typeof raw !== "string" || !isValidTimeZone(raw.trim())) {
      errors.timezone = "Geçerli bir saat dilimi seçin (örn. Europe/Istanbul).";
    } else {
      update.timezone = raw.trim();
    }
  }

  if ("autoReplyDisclosure" in data) {
    if (typeof data.autoReplyDisclosure !== "boolean") errors.autoReplyDisclosure = "true/false olmalı.";
    else update.autoReplyDisclosure = data.autoReplyDisclosure;
  }

  if ("handoffHoldHours" in data) {
    const n = Number(data.handoffHoldHours);
    if (!Number.isInteger(n) || n < 0 || n > 72) errors.handoffHoldHours = "0-72 arası saat olmalı.";
    else update.handoffHoldHours = n;
  }

  if (Object.keys(errors).length > 0) return badRequest(errors);
  if (Object.keys(update).length === 0) {
    return badRequest({ _: "Güncellenecek geçerli bir alan yok." });
  }

  await prisma.organization.update({
    where: { id: session.organizationId },
    data: update,
  });

  return jsonOk(update);
});
