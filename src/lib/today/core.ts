// ---------------------------------------------------------------------------
// AaaS "Bugün" ekranı — ilk dilim (kurucu 11-13: "olabilir, kontrol ederek görerek yap"; tasarım
// `docs/TASARIM-2026-11-13-bugun-ekrani-ve-aaas-akisi.md` §1). SAF yaprak (istemci + sunucu güvenli; veritabanı yok).
//  · `notReadyArrivals`: Girişler'in KENDİ değerlendirmesinden (`evaluateStay`) yalnız "HAZIR DEĞİL" (engelleyen) satırlar — ikinci bir
//    hazırlık kuralı yazılmaz; "bilinmiyor" ve bilgi satırları Panel'e girmez (her sabah dolup duvar kâğıdına dönerdi, 08-08 kararı).
//  · `automationDigestParts`: "son 24 saatte sizin yerinize" satırının parçaları; 0 olan parça yazılmaz, hepsi 0 ise boş (satır basılmaz).
// ---------------------------------------------------------------------------

/** Girişler satırının bu ekranın okuduğu kısmı (`ArrivalRow`'un alt kümesi). */
export interface TodayArrivalInput {
  reservationId: string;
  propertyName: string;
  checkInTime: string | null;
  readiness: { overall: string; factors: ReadonlyArray<{ state: string; label: string }> };
}

export interface NotReadyArrival {
  reservationId: string;
  propertyName: string;
  checkInTime: string | null;
  /** İlk engelin ev sahibine görünen adı (Girişler'deki satırın aynısı). */
  firstBlocking: string;
  /** İlkinden sonra kalan engel sayısı. */
  moreBlocking: number;
}

export function notReadyArrivals(rows: readonly TodayArrivalInput[]): NotReadyArrival[] {
  const out: NotReadyArrival[] = [];
  for (const r of rows) {
    if (r.readiness.overall !== "not_ready") continue;
    const blocking = r.readiness.factors.filter((f) => f.state === "blocking");
    // "HAZIR DEĞİL" en az bir engel demektir; yine de engelsiz satır sessizce boş başlık üretmesin.
    if (blocking.length === 0) continue;
    out.push({
      reservationId: r.reservationId,
      propertyName: r.propertyName,
      checkInTime: r.checkInTime,
      firstBlocking: blocking[0]!.label,
      moreBlocking: blocking.length - 1,
    });
  }
  return out;
}

/** Hazır olmayan girişin başlığı: "Bugün 15:00 giriş hazır değil" (saat bilinmiyorsa saatsiz). */
export function notReadyHeadline(a: Pick<NotReadyArrival, "checkInTime">): string {
  return a.checkInTime ? `Bugün ${a.checkInTime} giriş hazır değil` : "Bugünkü giriş hazır değil";
}

/** Alt satır: "Deniz Daire · Temizlik açık · Ayşe · 09:40 · 1 eksik daha". */
export function notReadyDetail(a: Pick<NotReadyArrival, "propertyName" | "firstBlocking" | "moreBlocking">): string {
  return `${a.propertyName} · ${a.firstBlocking}${a.moreBlocking > 0 ? ` · ${a.moreBlocking} eksik daha` : ""}`;
}

export interface AutomationDigestCounts {
  aiReplies: number;
  welcomes: number;
  checkins: number;
  checkouts: number;
  systemTasks: number;
}

export const AUTOMATION_DIGEST_LABEL = "Son 24 saatte sizin yerinize";

/** Satırın parçaları — sıra: cevaplar, karşılama, giriş, çıkış, görev. 0 olan parça yok. */
export function automationDigestParts(d: AutomationDigestCounts): string[] {
  const parts: Array<[number, string]> = [
    [d.aiReplies, "misafir mesajı cevaplandı"],
    [d.welcomes, "karşılama mesajı gönderildi"],
    [d.checkins, "giriş mesajı gönderildi"],
    [d.checkouts, "çıkış mesajı gönderildi"],
    [d.systemTasks, "görev açıldı"],
  ];
  return parts.filter(([n]) => Number.isFinite(n) && n > 0).map(([n, text]) => `${n} ${text}`);
}
