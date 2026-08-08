import { prisma } from "@/lib/db";
import { badRequest, jsonOk, readJsonCappedOrNull } from "@/lib/api";
import { OFFER_PAYMENT_METHOD_RX } from "@/lib/validators";
import { withManage } from "@/lib/route-guard";
import { isValidTimeZone } from "@/lib/timezone";
import { isOrgMemberEmail, isValidEmailShape, normalizeEmail } from "@/lib/email-identity";
import { writeAudit, auditActor, auditImpersonation } from "@/lib/audit";

// Organization-level settings the UI can change. Booleans are the auto-reply
// switches; the hour fields define the channel auto-reply active window;
// aiReplyTone / aiSignature shape the AI's voice.
const BOOLEAN_FIELDS = ["autoReplyHospitable", "autoWelcome", "autoCheckin", "autoCheckout", "autoHoldingReplyEnabled", "autoClosingReplyEnabled", "autoTaskFromMessageEnabled", "autoSupplyRequestEnabled", "icalShowGuestName", "qrChatPinRequired"] as const;
const HOUR_FIELDS = ["autoReplyStartHour", "autoReplyEndHour"] as const;
const VALID_TONES = ["formal", "warm", "short", "luxury"] as const;
const SIGNATURE_MAX = 600;

// Strict numeric coercion for the integer fields. Number("") / Number(null) /
// Number("  ") / Number(false) all === 0, so a cleared or omitted-as-"" field would
// silently persist 0 — a 0-hour handoff hold resumes the AI immediately after a
// human-handoff request, and a 0 auto-reply window is a real value too. The client
// already guards the blank box, but a direct API call bypasses that. Accept only a
// real number or a non-empty numeric string; everything else → NaN → range check
// rejects it (400).
function toIntOrNaN(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}
const CLOSING_TEXT_MAX = 300; // a courtesy is one line, not a letter
const OFFER_TEXT_MAX = 400; // late-checkout offer: a short price/terms line (matches the prompt sanitizer cap)

/** Update organization-level settings (auto-reply window/toggle + AI tone/signature). */
export const PATCH = withManage(async (session, req) => {
  const data = await readJsonCappedOrNull(req);
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
      const n = toIntOrNaN(data[field]);
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
          "Teklif metni ödeme yöntemi içeremez (elden/nakit/IBAN/havale vb.). Yalnızca fiyat ve koşulları yazın; tahsilatı siz yönetirsiniz.";
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
      const trimmed = normalizeEmail((raw ?? "").toString());
      if (trimmed && !isValidEmailShape(trimmed)) {
        errors.alertEmail = "Geçerli bir e-posta girin.";
      } else if (trimmed && !(await isOrgMemberEmail(session.organizationId, trimmed))) {
        // 🚨 AÇIK E-POSTA RÖLESİ KAPATILDI (denetim bulgusu, uçtan uca kanıtlandı).
        //
        // Buraya HERHANGİ bir adres yazılabiliyordu — sahiplik doğrulaması yoktu.
        // Uyarı e-postasının KONUSU (misafir adı + daire adı) ve GÖVDESİ (mesajın
        // ilk 600 karakteri) müşteri kontrolündedir; `POST /api/conversations` de
        // hız limitsizdi. Yani bir müşteri, BİZİM doğrulanmış alan adımızdan,
        // üçüncü bir kişiye, kendi yazdığı metinle saatte binlerce e-posta
        // gönderebiliyordu. Zararı kendi hesabına değil GÖNDERİM İTİBARIMIZA —
        // alan adı kara listeye girerse TÜM müşterilerin şifre-sıfırlama ve
        // doğrulama e-postaları teslim edilmez.
        //
        // Çözüm en dar kapsam: uyarılar yalnız BU İŞLETMENİN kendi ekibine gider.
        // Bu zaten özelliğin amacı; farklı bir adres istenirse doğrulama akışı
        // ayrı bir turdur (o zamana kadar röle kapalı kalır).
        errors.alertEmail =
          "Uyarı adresi, bu işletmedeki bir kullanıcının e-postası olmalı. Önce o kişiyi ekibe ekleyin.";
      } else {
        // 🚨 YORUM DÜZELTİLDİ (denetim 08-07 (5)) — burada bir dönem "boş
        // bırakınca env `ALERT_EMAIL`'e düşer" yazıyordu ve bu YANLIŞTI:
        // deponun kendi SERT kuralı 40 satır ötede tam tersini söylüyor
        // (`test-email/route.ts`: "`process.env.ALERT_EMAIL`'E ASLA DÜŞÜLMEZ —
        // GERİ EKLEME", çünkü o adres OPERATÖRÜN kişisel kutusu).
        // GERÇEK davranış: boş → NULL → alıcı org'un KENDİ en eski kullanıcısı
        // (`automation.ts:1564` ve `:3190`, `guest-chat-alerts.ts:154`).
        // Yorumu düzeltmenin sebebi kozmetik değil: yazdığı gibi "restore" etmeye
        // çalışan biri kiracının şikayet/iade uyarılarını kurucunun kutusuna
        // yönlendirirdi.
        update.alertEmail = trimmed.length === 0 ? null : trimmed;
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
    const n = toIntOrNaN(data.handoffHoldHours);
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

  // ── DENETİM İZİ (gözlemlenebilirlik turu, 08-06) ──────────────────────────
  //
  // 🚨 Bu rota GÜVENLİK-İLGİLİ anahtarlar çeviriyor ve hiçbir iz bırakmıyordu:
  // `autoReplyHospitable` (misafire otomatik mesaj gitsin mi), `qrChatPinRequired`
  // (QR sohbeti PIN istesin mi), `icalShowGuestName` (takvim feed'inde misafir adı
  // görünsün mü), `alertEmail` (operasyonel alarmların GİTTİĞİ adres), aktif-saat
  // penceresi. Bir org'da bunlardan biri değişirse "kim, ne zaman, neyi" sorusunun
  // cevabı hiçbir yerde YOKTU — ne destek görüşmesinde ne bir olay incelemesinde.
  // Giriş / şifre / 2FA / impersonation / plan değişimi / token rotasyonu ZATEN
  // audit'li; ayarlar bu listede tek eksikti.
  //
  // ⚠️ Yalnız DEĞİŞEN ALAN ADLARI yazılır, DEĞERLER yazılmaz: `aiSignature`,
  // `closingReplyText`, `lateCheckoutOfferText` serbest metin ve host oraya PII
  // yazabilir; denetim kaydı ikinci bir PII kopyası olmamalı. Boole/saat gibi
  // zararsız alanların değeri de bilinçli dışarıda — tek biçim, istisnasız kural.
  //
  // ⚠️ `writeAudit` fırlatmaz (kendi içinde yutar) — ayar kaydı denetim kaydı
  // yüzünden başarısız olmamalı; kayıt en iyi çaba.
  //
  // `auditImpersonation` yalnız `{impersonated:true}` ekler (operatörün e-postası
  // ASLA — kayıt müşterinin KENDİ veri ihracına ham giriyor). Kaydın var olma
  // sebebi "kim" sorusu ve o soruda en kritik ayrım "müşteri mi yaptı, operatör
  // müşteri adına mı" — `actorUserId` opak bir id, tek başına bunu tek bakışta
  // söylemiyor.
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "settings.update",
    metadata: { fields: Object.keys(update).sort(), ...auditImpersonation(session) },
  });

  return jsonOk(update);
});
