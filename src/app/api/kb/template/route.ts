import { NextResponse } from "next/server";
import { forbidden } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { PAID_FEATURE_INACTIVE_MESSAGE, PAID_FEATURE_TRIAL_MESSAGE, paidPlanFeatureAllowed } from "@/lib/billing/subscription";
import { kbTemplateFilename, kbTemplateText, type KbTemplateLang } from "@/lib/kb-import/template";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// BİLGİ TABANI ŞABLONU İNDİR (kurucu 10-28, §7-A (2): "şablonu indir → doldur → yükle"; deneme sürümünde KAPALI). Şablonda işletme verisi
// yoktur (yalnız başlık + boşluk); kapı yalnız ücretli paket kararıdır. Yönetici / sahip (bilgi tabanını düzenleyebilen) indirir.
// ---------------------------------------------------------------------------
export const GET = withManage(async (session, req) => {
  const gate = await paidPlanFeatureAllowed(session.organizationId);
  if (!gate.ok) return forbidden(gate.reason === "trial" ? PAID_FEATURE_TRIAL_MESSAGE : PAID_FEATURE_INACTIVE_MESSAGE);
  const lang: KbTemplateLang = new URL(req.url).searchParams.get("lang") === "en" ? "en" : "tr";
  // UTF-8 BOM: Windows Not Defteri / Word Türkçe harfleri doğru açsın (içe aktarıcı BOM'u siler).
  return new NextResponse(`\uFEFF${kbTemplateText(lang)}`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${kbTemplateFilename(lang)}"`,
      "cache-control": "no-store",
    },
  });
});
