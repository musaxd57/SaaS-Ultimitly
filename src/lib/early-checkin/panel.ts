// ---------------------------------------------------------------------------
// ERKEN GİRİŞ KONTROL PANELİ — HOST'A GÖSTERİLEN SATIRLAR (saf; istemci bileşeni de içe aktarır). Müşteri metni
// sade (CLAUDE.md): teknik terim yok, yalnız ne olduğu ve gerekiyorsa ne yapılacağı. Her satır bir kontrolün
// sonucudur; "ok" false olan satır mesajın neden size kaldığını söyler. Saatlere ek yazılmaz ("11:00'de" /
// "10:00'da" ünlü uyumu saate göre değişir; yanlış ek yazmaktansa hiç yazmamak — inceleme 09-24).
// ---------------------------------------------------------------------------

import { formatEarlyCheckinFee } from "./reply";
import type { EarlyCheckinCurrency } from "./core";

export interface EarlyCheckinPanelData {
  status: "approvable" | "pending" | "needs_host" | "not_early";
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
    /** Temizlik beklenen çıkıştan önce, kanıtlı "başladım → hazır" ile bitti (host rızası) → çıkış doğrulandı. */
    departureConfirmed?: boolean;
    /** Devirde açık sorun / bakım görevi var. */
    openIssue?: boolean;
    /** Önceki misafirin beklenenden ERKEN beyanı (karara girmez; yalnız bilgi). */
    previousDeclaredCheckout?: string | null;
    /** Temizlikçi bugün başladı, henüz "hazır" demedi. */
    cleaningStarted?: boolean;
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
  if (d.facts.departureConfirmed) {
    lines.push({ ok: true, text: "Temizlik önceki misafirin beklenen çıkışından önce bitti; çıkış temizlikçinin kaydıyla doğrulandı." });
  } else if (d.facts.previousCheckout) {
    // Beklenen saat bir BEKLENTİDİR (misafir erken çıkmış olabilir) — "daire dolu" diye olgu gibi yazılmaz (inceleme 09-24).
    lines.push({
      ok: !f.has("previous_still_in") && !f.has("previous_checkout_unknown"),
      text: f.has("previous_still_in")
        ? `Önceki misafirin beklenen çıkışı: ${d.facts.previousCheckout} — istenen saatten sonra; temizlik bitmeden onay verilmez.`
        : `Önceki misafirin beklenen çıkışı: ${d.facts.previousCheckout}`,
    });
    if (d.facts.previousDeclaredCheckout) {
      lines.push({
        ok: true,
        text: `Önceki misafirin yazdığı çıkış: ${d.facts.previousDeclaredCheckout} (misafir beyanı; temizlik kaydı olmadan esas alınmaz).`,
      });
    }
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
  // Temizlik sürüyorsa (görev açık → neden her zaman "open") temizlikçinin başladığı söylenir.
  else if (d.facts.readiness === "not_ready" && d.facts.cleaningStarted) {
    lines.push({ ok: false, text: 'Temizlikçi temizliğe başladı; henüz "Daire hazır" demedi.' });
  } else if (d.facts.readiness === "not_ready") lines.push({ ok: false, text: READINESS_TEXT[d.facts.readinessNote ?? "open"] ?? READINESS_TEXT.open });
  else lines.push({ ok: false, text: READINESS_TEXT[d.facts.readinessNote ?? ""] ?? "Bu devir için temizlik görevi bulunamadı." });
  if (f.has("open_issue")) lines.push({ ok: false, text: "Bu devirde açık bir sorun ya da bakım görevi var; kapanmadan \"daire hazır\" denemez." });
  if (f.has("arrival_passed")) lines.push({ ok: false, text: "Misafirin varış günü geçmiş." });
  if (f.has("time_passed")) lines.push({ ok: false, text: "İstenen saat geçti; misafire uygun saati siz yazın." });
  if (f.has("before_window")) lines.push({ ok: false, text: "İstenen saat, otomatik onay için belirlediğiniz en erken saatten önce; karar sizin." });
  if (f.has("luggage")) lines.push({ ok: false, text: "Misafir bavul bırakmayı ya da almayı soruyor; erken giriş onayı bunu yanıtlamaz." });
  if (f.has("multi_intent")) lines.push({ ok: false, text: "Mesajda başka bir istek ya da soru da var; hazır cevap yalnız erken girişi yanıtlar." });
  if (f.has("day_unverified")) lines.push({ ok: false, text: "Mesajda başka bir güne işaret var (ör. \"yarın\"); günü kontrol edin." });
  if (f.has("not_fully_read")) lines.push({ ok: false, text: "Cevapsız mesajlar çok uzun ya da çok fazla; hepsini okuyup siz karar verin." });
  if (f.has("time_mismatch_text")) lines.push({ ok: false, text: "Mesajdaki saat(ler) istenen saatle birebir eşleşmiyor; saati kontrol edin." });
  if (d.fee) lines.push({ ok: true, text: `Erken giriş ücreti: ${formatEarlyCheckinFee({ amount: d.fee.amount, currency: d.fee.currency as EarlyCheckinCurrency }, "tr")}` });
  if (d.mode === "off" || f.has("rule_off")) lines.push({ ok: false, text: "Erken giriş kuralı kapalı; mülk sayfasından açabilirsiniz." });
  // Bekleyen istek: yalnız otomatik kurallı mülkte varış günü temizlik işaretiyle yeniden kontrol edilir (`recheck.ts`).
  if (d.status === "pending" && d.facts.arrivalToday && d.mode === "auto") {
    lines.push({ ok: false, text: "Temizlikçi \"Daire hazır\" dediğinde istek yeniden kontrol edilir." });
  }
  return lines;
}
