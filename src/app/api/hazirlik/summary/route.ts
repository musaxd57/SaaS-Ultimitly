import { NextResponse } from "next/server";
import { jsonOk } from "@/lib/api";
import { withAuth } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { getPrepPlan } from "@/lib/supply";
import { generateSupplySummary, supplyAiConfigured } from "@/lib/supply-ai";

export const dynamic = "force-dynamic";

/**
 * On-demand AI summary of the prep/shopping plan. Cost-gated per org. Recomputes
 * the plan SERVER-SIDE from the session's org (no client-supplied data, no IDOR)
 * so only aggregate numbers — never guest PII — reach the model.
 */
export const POST = withAuth(async (session, req) => {
  if (!supplyAiConfigured()) {
    return NextResponse.json({ error: "AI özeti bu ortamda etkin değil." }, { status: 503 });
  }
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
  if (plan.linen.length === 0 && plan.consumables.length === 0) {
    return jsonOk({ summary: null, empty: true });
  }

  const summary = await generateSupplySummary(plan);
  if (!summary) {
    return NextResponse.json(
      { error: "Özet oluşturulamadı, lütfen tekrar deneyin." },
      { status: 502 },
    );
  }
  return jsonOk({ summary });
});
