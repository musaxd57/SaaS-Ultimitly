// ---------------------------------------------------------------------------
// ERKEN GİRİŞ KONTROL PANELİ — HOST'A GÖSTERİLEN SATIRLAR (saf; istemci bileşeni de içe aktarır). Müşteri metni
// sade (CLAUDE.md): teknik terim yok, yalnız ne olduğu ve gerekiyorsa ne yapılacağı. Her satır bir kontrolün
// sonucudur; "ok" false olan satır mesajın neden size kaldığını söyler. Saatlere ek yazılmaz ("11:00'de" /
// "10:00'da" ünlü uyumu saate göre değişir; yanlış ek yazmaktansa hiç yazmamak — inceleme 09-24).
// ---------------------------------------------------------------------------

import { formatEarlyCheckinFee } from "./reply";
import type { EarlyCheckinCurrency } from "./core";

export interface EarlyCheckinPanelData {
  status: "approvable" | "needs_host" | "not_early";
  failed: readonly string[];
  mode: string;
  fee: { amount: number; currency: string } | null;
  facts: {
    arrivalToday: boolean;
    requestedTime: string | null;
    previousCheckout: string | null;
    readiness: "ready" | "not_ready" | "unknown";
    readinessNote?: "none" | "open" | "fresh" | "before_checkout" | "no_time";
    otherOverlaps: number;
    previousNightVerifiedVacant: boolean;
  };
}

export interface PanelLine {
  ok: boolean;
  text: string;
}

const READINESS_TEXT: Record<string, string> = {
  open: "Temizlik henüz bitti olarak işaretlenmedi.",
  fresh: "Temizlik az önce bitti olarak işaretlendi; birkaç dakika içinde yeniden kontrol edilir.",
  before_checkout: "Temizlik işareti önceki misafirin çıkışından önce atılmış; bu devir için sayılmaz.",
  no_time: "Temizlik bitti olarak görünüyor ama ne zaman bittiği kayıtlı değil.",
};

export function earlyCheckinPanelLines(d: EarlyCheckinPanelData): PanelLine[] {
  const f = new Set(d.failed);
  const lines: PanelLine[] = [];
  if (f.has("time_conflict")) {
    lines.push({ ok: false, text: "İstenen saat iki kontrolde farklı okundu; misafirin yazdığı saati kontrol edin." });
  } else if (d.facts.requestedTime) {
    lines.push({ ok: true, text: `İstenen saat: ${d.facts.requestedTime}` });
  } else {
    lines.push({ ok: false, text: "İstenen saati mesajdan kontrol edin." });
  }
  lines.push(
    d.facts.arrivalToday
      ? { ok: true, text: "Misafirin varışı bugün." }
      : { ok: false, text: "Varış bugün değil; hazırlık o gün kontrol edilebilir." },
  );
  if (d.facts.previousCheckout) {
    lines.push({
      ok: !f.has("previous_still_in") && !f.has("previous_checkout_unknown"),
      text: f.has("previous_still_in")
        ? `Önceki misafirin çıkışı: ${d.facts.previousCheckout} — istenen saatte daire dolu.`
        : `Önceki misafirin çıkışı: ${d.facts.previousCheckout}`,
    });
  } else {
    lines.push(
      d.facts.previousNightVerifiedVacant
        ? { ok: true, text: "Dün gece daire boştu." }
        : { ok: false, text: "Dün gecenin boş olduğu doğrulanamadı; kanal takviminden kontrol edin." },
    );
  }
  lines.push(
    d.facts.otherOverlaps > 0
      ? { ok: false, text: "Aynı gün çakışan başka bir rezervasyon var." }
      : { ok: true, text: "Çakışan başka rezervasyon yok." },
  );
  if (d.facts.readiness === "ready") lines.push({ ok: true, text: "Temizlik bitti olarak işaretlendi." });
  else if (d.facts.readiness === "not_ready") lines.push({ ok: false, text: READINESS_TEXT[d.facts.readinessNote ?? "open"] ?? READINESS_TEXT.open });
  else lines.push({ ok: false, text: READINESS_TEXT[d.facts.readinessNote ?? ""] ?? "Bu devir için temizlik görevi bulunamadı." });
  if (f.has("before_window")) lines.push({ ok: false, text: "İstenen saat, izin verdiğiniz en erken saatten önce." });
  if (f.has("multi_intent")) lines.push({ ok: false, text: "Mesajda başka bir istek ya da soru da var; hazır cevap yalnız erken girişi yanıtlar." });
  if (d.fee) lines.push({ ok: true, text: `Erken giriş ücreti: ${formatEarlyCheckinFee({ amount: d.fee.amount, currency: d.fee.currency as EarlyCheckinCurrency }, "tr")}` });
  if (d.mode === "off" || f.has("rule_off")) lines.push({ ok: false, text: "Erken giriş kuralı kapalı; mülk sayfasından açabilirsiniz." });
  return lines;
}
