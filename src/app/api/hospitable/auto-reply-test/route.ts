import { NextResponse } from "next/server";
import { providerErrorMessage } from "@/lib/provider-errors";
import { paymentRequired, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { premiumAllowed } from "@/lib/billing/subscription";
import { rateLimit } from "@/lib/rate-limit";
import { peekDailyAiBudget, dailyBudgetMessage } from "@/lib/ai/daily-budget";
import { previewChannelAutoReplies } from "@/lib/automation";

// ---------------------------------------------------------------------------
// Dry-run preview for the channel (Airbnb / Booking) AI auto-reply.
//
// POST → for every conversation awaiting a reply, compute what the AI WOULD
// auto-send — without sending or saving anything. Lets the user judge quality
// before turning the live night auto-reply on. Ignores the on/off toggle and
// the active-hours window on purpose, so it works any time of day.
// ---------------------------------------------------------------------------

// withManage: owner/manager only (parity with the sibling ai/test route) — a
// preview surfaces guest inbox content + AI drafts, which the staff clamp forbids.
export const POST = withManage(async (session) => {
  if (!(await premiumAllowed(session.organizationId))) return paymentRequired();

  // This preview fans out one model call per awaiting conversation on the shared
  // platform key — throttle per user so it can't be POST-spammed for cost.
  const limited = await rateLimit(`preview-autoreply:${session.userId}`, 6, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  // ⚠️ GÜNLÜK KOTA BU ROTADA DA GEÇERLİ (denetim, 07-31 — GERÇEK BİR AÇIKTI): `previewChannelAutoReplies` istek başına 12'ye kadar
  // GERÇEK model çağrısı yapıyor ve eskiden sayaca hiç dokunmuyordu (dakikada 6 × 12 = 72 çağrı, Başlangıç tavanı günde 150).
  //
  // 🚨 KONUŞMA BAŞINA (kurucu kararı 10-11, "gerçek çağrı kadar düşsün"): 07-31 düzeltmesi önizleme başına TEK birim düşüyordu →
  // Başlangıç planında günde teorik 150 × 12 = 1.800 çağrı. Artık her model çağrısı bir birim, `previewChannelAutoReplies` içinde
  // (`previewBudget`); bütçe biterse önizleme orada durur ve ekran "günlük sınır doldu" der. Burada yalnız BAKILIR: bütçe zaten
  // doluysa hiçbir konuşma yüklenmeden reddedilir.
  const budget = await peekDailyAiBudget(session.organizationId);
  if (!budget.ok) return tooManyRequests(budget.retryAfter, dailyBudgetMessage(budget));

  try {
    const { outcomes, budgetExhausted } = await previewChannelAutoReplies(session.organizationId);
    const previews = outcomes.map((o) => ({
      guestIdentifier: o.guestIdentifier ?? "Misafir",
      propertyName: o.propertyName ?? "",
      // "would send" when a draft passed the safety gate; otherwise it waits for a human.
      wouldSend: Boolean(o.draft),
      reply: o.draft?.reply ?? null,
      confidence: o.draft?.confidence ?? null,
      reason: o.draft ? null : o.skippedReason ?? null,
    }));
    // Bütçe önizleme sırasında bitti: kalan konuşmalar önizlenmedi — ekranda sade not (dolan tavan + ne zaman açılacağı).
    const limitNote = budgetExhausted
      ? `${dailyBudgetMessage(await peekDailyAiBudget(session.organizationId))} Kalan konuşmalar önizlenmedi.`
      : null;
    return NextResponse.json({ ok: true, previews, limitNote });
  } catch (err) {
    const message = providerErrorMessage(err, "Önizleme oluşturulamadı. Lütfen kısa bir süre sonra tekrar deneyin.");
    return NextResponse.json({ ok: false, error: message });
  }
});
