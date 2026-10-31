import "server-only";

import { prisma } from "@/lib/db";
import { appBaseUrl } from "@/lib/auth/email-verify";
import { TEXT_DECISION_KINDS, DECISION_LANG_LABELS_TR, decisionMessageText, type DecisionLang } from "@/lib/decisions/core";
import { decideHostDecision, freshDecisionCard, guestWroteAfterRequest } from "@/lib/decisions/decide";
import type { DecisionCardData } from "@/lib/decisions/view-types";
import { decisionButtonId, type DecisionButton } from "./decision-buttons";

// ---------------------------------------------------------------------------
// KARAR KARTI WHATSAPP'TA — DÜĞME (tasarım §3.10, dilim 3; anahtar `HOST_QUESTION_DECISIONS_ENABLED` + karar motoru). Ev sahibi "Karar
// bekliyor" mesajındaki [Onayla] / [Reddet]'e basar:
//  1. SEÇİM → kart sayfayla AYNI kurucudan yeniden kurulur; yalnız metinli tür (erken giriş / geç çıkış), istenen saat belli ve ÜCRETSİZ
//     onay WhatsApp'ta yürür (ücret / saatsiz / uzatma → "panelden devam edin"). Misafire gidecek metin panelin varsayılanıyla AYNI kod metni
//     (`decisionMessageText`, misafirin dilinde; Türkçesi de koddan — model YOK) → ÖNİZLEME [Gönder] [Gönderme] (S1 "önce onay").
//  2. GÖNDER → karar çekirdeği (`decisions/decide.ts`): sürüm CAS, misafir arada yazdı mı, iptal / geçmiş gün, olgu izi (önizlemedeki
//     kartınki), gönderim, denetim kaydı (`source: host_channel`). Metin aynı koddan YENİDEN kurulur (önizlemedeki ile aynı olgulardan).
// Yetki: bağlantının kullanıcısı (yalnız sahip / yönetici bağlanabilir, rol + oturum kuşağı her mesajda yeniden denetlenir — `answer.ts`);
// kart YALNIZ bağlantının işletmesinde aranır. Asla fırlatmaz (çağıran yakalar).
// ---------------------------------------------------------------------------

export const DECISION_TEXTS = {
  previewHeader: "Misafire şu gidecek",
  previewTr: "Türkçesi:",
  send: "Gönder",
  cancel: "Gönderme",
  sent: "Gönderildi ✓",
  queued: "Sıraya alındı; birazdan misafire gidecek ✓",
  cancelled: "Tamam, gönderilmedi. Karar panelde bekliyor.",
  already: "Bu karar zaten verildi.",
  inFlight: "Bu karar şu an gönderiliyor ya da gönderimi doğrulanamadı; konuşmayı kontrol edin:",
  stale: "Bu karar kartı değişti ya da kapandı; misafire bir şey gönderilmedi. Panel:",
  panelOnly: "Bu kararı panelden verin (ücret, saat ya da tür WhatsApp'ta onaylanamıyor):",
  factsChanged: "Bu talebin kontrol listesi siz baktıktan sonra değişti; misafire bir şey gönderilmedi. Güncel hâli:",
  guestWrote: "Misafir bu talepten sonra yeniden yazdı; misafire bir şey gönderilmedi. Mesajı panelden okuyun:",
  hostReplied: "Bu talepten sonra misafire zaten yazdınız; misafire bir şey gönderilmedi. Gerekirse kararı panelden verin:",
  warnings: "Dikkat:",
  cancelledStay: "Rezervasyon iptal edilmiş; misafire bir şey gönderilmedi.",
  expired: "Talep edilen gün geçti; misafire bir şey gönderilmedi.",
  unverified: "Gönderim doğrulanamadı, konuşmayı kontrol edin:",
  failed: "Gönderilemedi. Panelden deneyin:",
} as const;

const panelLink = (conversationId: string) => `${appBaseUrl()}/inbox/${encodeURIComponent(conversationId)}`;

/** WhatsApp etkileşimli mesaj gövdesi sınırı: önizleme KESİLMEZ (ev sahibi gördüğünden fazlasını göndermesin) — sığmazsa panel. */
const DECISION_PREVIEW_MAX = 1_024;

/** Kartın uyarı satırları (panelde kırmızı olanlar) — bilgi satırları değil. */
export function decisionWarnings(card: Pick<DecisionCardData, "lines">): string[] {
  return card.lines.filter((l) => !l.ok).map((l) => l.text);
}

export type DecisionButtonOutcome = "previewed" | "sent" | "queued" | "cancelled" | "already" | "stale" | "panel" | "refused" | "failed";

/** Önizleme metni: uyarılar (hepsi) önce, sonra misafire gidecek metin; Türkçesi sığmazsa düşer, uyarılar asla düşmez. Sığmazsa `null`. */
export function decisionPreviewText(card: DecisionCardData, body: string, tr: string | null): string | null {
  const warnings = decisionWarnings(card);
  const head = `${card.title}${card.dayLabel ? ` · ${card.dayLabel}` : ""}`;
  const warn = warnings.length > 0 ? `\n\n${DECISION_TEXTS.warnings}\n${warnings.map((w) => `• ${w}`).join("\n")}` : "";
  const langLabel = card.lang === "tr" ? "" : ` (${DECISION_LANG_LABELS_TR[card.lang]})`;
  const main = `${head}${warn}\n\n${DECISION_TEXTS.previewHeader}${langLabel}:\n“${body}”`;
  const candidates = tr ? [`${main}\n${DECISION_TEXTS.previewTr} “${tr}”`, main] : [main];
  return candidates.find((c) => c.length <= DECISION_PREVIEW_MAX) ?? null;
}

/** Kartın WhatsApp'ta karar verilebilir olup olmadığı (seçim ve gönderimde aynı kural). */
export function decidableOnChannel(card: Pick<DecisionCardData, "kind" | "requestedTime" | "fee" | "open" | "sending" | "unverified">, action: "approve" | "decline"): boolean {
  if (!TEXT_DECISION_KINDS.has(card.kind) || !card.open || card.sending || card.unverified) return false;
  if (action === "approve") return card.requestedTime !== null && card.fee === null;
  return true;
}

/** Panelin varsayılanıyla AYNI kod metni (onayda istenen saat; retde standart saat). */
export function channelDecisionText(card: DecisionCardData, action: "approve" | "decline", lang: DecisionLang): string | null {
  return decisionMessageText({
    kind: card.kind,
    resolution: action,
    lang,
    dayKey: card.dayKey,
    // Retde saat kullanılmaz (ret metni standart saati söyler — `decisionMessageText`).
    time: card.requestedTime,
    standardTime: card.standardTime,
    fee: null,
    note: action === "approve" ? card.note : null,
  });
}

export async function handleDecisionButton(input: {
  organizationId: string;
  user: { id: string; name: string };
  parsed: DecisionButton;
  /** Önizlemenin bağlanacağı / yanıtların verileceği WhatsApp mesajı. */
  replyTo: string;
  reply: (text: string, replyTo?: string | null) => Promise<void>;
  /** Önizlemeyi gönderir; WhatsApp mesaj kimliğini döner (gönderilemediyse `null`). */
  choices: (text: string, buttons: { id: string; title: string }[], replyTo?: string | null) => Promise<string | null>;
  now: Date;
}): Promise<DecisionButtonOutcome> {
  const { parsed, organizationId, reply, now } = input;
  // Kart YALNIZ bağlantının işletmesinde (başka işletmenin kimliği düğmeye yazılmış olsa bile bulunmaz).
  const decision = await prisma.decisionRequest.findFirst({
    where: { id: parsed.decisionId, organizationId },
    select: { id: true, conversationId: true, messageId: true, createdAt: true, status: true, version: true },
  });
  if (!decision) return "refused";
  const link = panelLink(decision.conversationId);

  // Durum önce: karar verilmiş / gönderiliyor kartta ev sahibine "gönderilmedi" denmez (sert inceleme S-2 — misafir mesajı almış olabilir).
  if (decision.status === "approved" || decision.status === "declined" || decision.status === "resolved_by_policy") {
    await reply(DECISION_TEXTS.already, input.replyTo);
    return "already";
  }
  if (decision.status === "sending" || decision.status === "send_unverified") {
    await reply(`${DECISION_TEXTS.inFlight} ${link}`, input.replyTo);
    return "stale";
  }
  if (parsed.step === "cancel") {
    await reply(DECISION_TEXTS.cancelled, input.replyTo);
    return "cancelled";
  }
  if (decision.status !== "pending" || decision.version !== parsed.version) {
    await reply(`${DECISION_TEXTS.stale} ${link}`, input.replyTo);
    return "stale";
  }
  // Misafir talepten sonra yazdıysa önizleme gösterilmez: [Gönder] zaten gitmezdi (WhatsApp'ta "okudum" yok) — mesajı panelde okusun.
  if (await guestWroteAfterRequest(decision)) {
    await reply(`${DECISION_TEXTS.guestWrote} ${link}`, input.replyTo);
    return "stale";
  }
  const fresh = await freshDecisionCard({ organizationId, conversationId: decision.conversationId, decisionId: decision.id, now });
  if (!fresh?.card || !decidableOnChannel(fresh.card, parsed.action)) {
    // Kayıtta "bekliyor" ama fiilen kapanmış kart (gün geçti / rezervasyon iptal / ev sahibi zaten yazdı) kendi nedeniyle cevaplanır —
    // "ücret, saat ya da tür" denmez (sert inceleme 10-31 F-6).
    const text =
      fresh?.effective === "expired"
        ? DECISION_TEXTS.expired
        : fresh?.effective === "cancelled"
          ? DECISION_TEXTS.cancelledStay
          : fresh?.effective === "host_replied"
            ? `${DECISION_TEXTS.hostReplied} ${link}`
            : `${DECISION_TEXTS.panelOnly} ${link}`;
    await reply(text, input.replyTo);
    return "panel";
  }
  const card = fresh.card;
  const body = channelDecisionText(card, parsed.action, card.lang);
  if (!body) {
    await reply(`${DECISION_TEXTS.panelOnly} ${link}`, input.replyTo);
    return "panel";
  }

  if (parsed.step === "choose") {
    // Panelde kırmızı görünen uyarılar (daire boşalmamış olabilir, çakışan rezervasyon, temizlik bitmedi…) önizlemede [Gönder]'den ÖNCE
    // görünür — ev sahibi WhatsApp'ta panelden daha az bilgiyle onaylamaz (sert inceleme 10-31 F-1).
    const tr = card.lang === "tr" ? null : channelDecisionText(card, parsed.action, "tr");
    const text = decisionPreviewText(card, body, tr);
    if (!text) {
      await reply(`${DECISION_TEXTS.panelOnly} ${link}`, input.replyTo);
      return "panel";
    }
    const base = { decisionId: decision.id, version: decision.version, action: parsed.action, factsHash: card.factsHash };
    const previewId = await input.choices(
      text,
      [
        { id: decisionButtonId({ ...base, step: "send" }), title: DECISION_TEXTS.send },
        { id: decisionButtonId({ ...base, step: "cancel" }), title: DECISION_TEXTS.cancel },
      ],
      input.replyTo,
    );
    // Önizlemenin kimliği karar kaydına yazılır: ev sahibi önizlemeye "Yanıtla" ile yazarsa mesaj bu karara bağlanır (panele yönlendirilir),
    // başka misafirin açık sorusunun taslağına girmez (sert inceleme 10-31 F-5). Kart başına en son önizleme.
    if (previewId) {
      await prisma.hostQuestion
        .updateMany({
          where: { organizationId, kind: "decision", idempotencyKey: `decision:${decision.id}:v${decision.version}` },
          data: { previewMessageId: previewId },
        })
        .catch(() => null);
    }
    return "previewed";
  }

  // GÖNDER — önizlemedeki kartın olgu izi çekirdeğe verilir (kontrol listesi değiştiyse `facts_changed`, eski önizleme gitmez).
  const out = await decideHostDecision({
    organizationId,
    conversationId: decision.conversationId,
    decisionId: decision.id,
    actor: { userId: input.user.id, name: input.user.name, auditActorId: input.user.id, auditExtra: { source: "host_channel" } },
    input: {
      action: parsed.action,
      version: parsed.version,
      time: parsed.action === "approve" ? (card.requestedTime ?? undefined) : undefined,
      body,
      factsHash: parsed.factsHash,
      lang: card.lang,
    },
    now,
  });
  switch (out.kind) {
    case "done":
      await reply(out.queued ? DECISION_TEXTS.queued : DECISION_TEXTS.sent, input.replyTo);
      return out.queued ? "queued" : "sent";
    case "conflict": {
      const text =
        out.code === "guest_wrote_again"
          ? `${DECISION_TEXTS.guestWrote} ${link}`
          : out.code === "facts_changed" || out.code === "text_mismatch"
            ? `${DECISION_TEXTS.factsChanged} ${link}`
            : out.code === "reservation_cancelled"
              ? DECISION_TEXTS.cancelledStay
              : out.code === "expired"
                ? DECISION_TEXTS.expired
                : `${DECISION_TEXTS.stale} ${link}`;
      await reply(text, input.replyTo);
      return "stale";
    }
    case "unverified":
      await reply(`${DECISION_TEXTS.unverified} ${link}`, input.replyTo);
      return "failed";
    case "failed":
    case "bad_request":
    case "not_found":
    case "dismissed":
      await reply(`${DECISION_TEXTS.failed} ${link}`, input.replyTo);
      return "failed";
  }
}
