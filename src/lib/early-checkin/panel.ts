// ---------------------------------------------------------------------------
// ERKEN GİRİŞ KONTROL PANELİ — HOST'A GÖSTERİLEN SATIRLAR (saf; istemci bileşeni de içe aktarır). Müşteri metni
// sade (CLAUDE.md): teknik terim yok, yalnız ne olduğu ve gerekiyorsa ne yapılacağı. Her satır bir kontrolün
// sonucudur; "ok" false olan satır mesajın neden size kaldığını söyler.
// ---------------------------------------------------------------------------

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
    otherOverlaps: number;
    previousNightVerifiedVacant: boolean;
  };
}

export interface PanelLine {
  ok: boolean;
  text: string;
}

export function earlyCheckinPanelLines(d: EarlyCheckinPanelData): PanelLine[] {
  const f = new Set(d.failed);
  const lines: PanelLine[] = [];
  lines.push(
    d.facts.requestedTime && !f.has("time_conflict")
      ? { ok: true, text: `İstenen saat: ${d.facts.requestedTime}` }
      : { ok: false, text: "İstenen saat net değil — misafire saati sorun." },
  );
  lines.push(
    d.facts.arrivalToday
      ? { ok: true, text: "Misafirin varışı bugün." }
      : { ok: false, text: "Varış bugün değil — hazırlık o gün kontrol edilebilir." },
  );
  if (d.facts.previousCheckout) {
    lines.push({
      ok: !f.has("previous_still_in") && !f.has("previous_checkout_unknown"),
      text: f.has("previous_still_in")
        ? `Önceki misafir ${d.facts.previousCheckout}'de çıkıyor — istenen saatte daire dolu.`
        : `Önceki misafir ${d.facts.previousCheckout}'de çıkıyor.`,
    });
  } else {
    lines.push(
      d.facts.previousNightVerifiedVacant
        ? { ok: true, text: "Dün gece daire boştu." }
        : { ok: false, text: "Dün gecenin boş olduğu doğrulanamadı — kanal takviminden kontrol edin." },
    );
  }
  lines.push(
    d.facts.otherOverlaps > 0
      ? { ok: false, text: "Aynı gün çakışan başka bir rezervasyon var." }
      : { ok: true, text: "Çakışan başka rezervasyon yok." },
  );
  lines.push(
    d.facts.readiness === "ready"
      ? { ok: true, text: "Temizlik bitti olarak işaretlendi." }
      : d.facts.readiness === "not_ready"
        ? { ok: false, text: "Temizlik henüz bitti olarak işaretlenmedi." }
        : { ok: false, text: "Bu değişim için temizlik görevi bulunamadı." },
  );
  if (f.has("before_window")) lines.push({ ok: false, text: "İstenen saat, izin verdiğiniz en erken saatten önce." });
  if (d.fee) lines.push({ ok: true, text: `Erken giriş ücreti: ${d.fee.amount} ${d.fee.currency}` });
  if (d.mode === "off" || f.has("rule_off")) lines.push({ ok: false, text: "Erken giriş kuralı kapalı — mülk sayfasından açabilirsiniz." });
  return lines;
}
