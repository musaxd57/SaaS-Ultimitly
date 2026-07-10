import { NextResponse } from "next/server";
import { jsonOk, paymentRequired } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { premiumAllowed } from "@/lib/billing/subscription";
import { getPrepPlan } from "@/lib/supply";
import { generateSupplySummary, supplyAiConfigured, planHasBuyables } from "@/lib/supply-ai";

export const dynamic = "force-dynamic";

/**
 * On-demand AI summary of the prep/shopping plan. Cost-gated per org. Recomputes
 * the plan SERVER-SIDE from the session's org (no client-supplied data, no IDOR)
 * so only aggregate numbers — never guest PII — reach the model.
 */
export const POST = withManage(async (session, req) => {
  if (!supplyAiConfigured()) {
    return NextResponse.json({ error: "AI özeti bu ortamda etkin değil." }, { status: 503 });
  }
  // Premium gate — match the other AI routes (ai-suggest/translate/ai-test): a
  // lapsed/free org must not spend on AI summaries when billing is enforced.
  if (!(await premiumAllowed(session.organizationId))) return paymentRequired();
  // Cost gate: an AI call per request → cap per org.
  const limited = rateLimit(`supply-ai:${session.organizationId}`, 20, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Çok fazla istek. Biraz sonra tekrar deneyin." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { days?: number };
  const days = [1, 7, 14].includes(Number(body.days)) ? Number(body.days) : 7;

  const plan = await getPrepPlan(session.organizationId, { days });
  if (!planHasBuyables(plan)) {
    return jsonOk({ summary: null, empty: true });
  }

  const result = await generateSupplySummary(plan);
  if (!result.ok) {
    // Surface a short (redacted) reason so a misconfigured model id / key / URL
    // is diagnosable from the Network tab, not just a blank 502.
    return NextResponse.json(
      { error: "Özet oluşturulamadı, lütfen tekrar deneyin.", detail: result.reason },
      { status: 502 },
    );
  }
  return jsonOk({ summary: result.text });
});
