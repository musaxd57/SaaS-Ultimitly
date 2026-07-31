import { NextResponse } from "next/server";
import { paymentRequired, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { premiumAllowed } from "@/lib/billing/subscription";
import { rateLimit } from "@/lib/rate-limit";
import { consumeDailyAiBudget, dailyBudgetMessage } from "@/lib/ai/daily-budget";
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

  // ⚠️ GÜNLÜK KOTA BU ROTADA DA GEÇERLİ (denetim, 07-31 — GERÇEK BİR AÇIKTI).
  //
  // `applyChannelAutoReply` kotayı `dryRun` dışında tutuyor ve gerekçesi
  // "önizleme kendi rotasında zaten sayılıyor" idi. Bu `/api/ai/test` için
  // doğruydu, BU rota için değildi: `previewChannelAutoReplies` istek başına
  // 12'ye kadar GERÇEK model çağrısı yapıyor ve sayaca hiç dokunmuyordu.
  // Dakikada 6 istek × 12 = 72 çağrı/dakika, ~103.000/gün — Başlangıç planının
  // tavanı 150. Yani kotanın var oluş sebebi (tek hesabın bütçeyi yakması) tam
  // olarak bu düğmede açıktı. `ignoreToggle`+`ignoreSchedule` yüzünden org
  // anahtarı kapalıyken ve saat penceresi dışında bile çalışıyordu.
  //
  // Önizleme başına TEK birim tüketiliyor (fan-out sayısı kadar değil): amaç
  // meşru kullanıcıyı iki denemede kilitlemek değil, sınırsız döngüyü kesmek.
  const budget = await consumeDailyAiBudget(session.organizationId);
  if (!budget.ok) return tooManyRequests(budget.retryAfter, dailyBudgetMessage(budget));

  try {
    const outcomes = await previewChannelAutoReplies(session.organizationId);
    const previews = outcomes.map((o) => ({
      guestIdentifier: o.guestIdentifier ?? "Misafir",
      propertyName: o.propertyName ?? "",
      // "would send" when a draft passed the safety gate; otherwise it waits for a human.
      wouldSend: Boolean(o.draft),
      reply: o.draft?.reply ?? null,
      confidence: o.draft?.confidence ?? null,
      reason: o.draft ? null : o.skippedReason ?? null,
    }));
    return NextResponse.json({ ok: true, previews });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Önizleme başarısız oldu.";
    return NextResponse.json({ ok: false, error: message });
  }
});
