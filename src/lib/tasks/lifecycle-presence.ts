// ---------------------------------------------------------------------------
// YAŞAM DÖNGÜSÜ GÖREVİ "ZATEN VAR MI?" KURALI (kurucu D7, 10-15) — `createReservationTasks` ile görevler sayfasındaki "Eksik görevleri
// oluştur (N)" sayısı AYNI kararı versin diye tek yerde (saf, veritabanısız).
//
// Kurucu (aynen): "Ara temizlik sözü veya manuel temizlik, otomatik çıkış temizliğini engellemesin; mevcut söz görevi korunsun. Ancak
// tamamlanmış sistem görevi yalnız aynı rezervasyonun aynı çıkış temizliğiyse tekrar oluşturmayı engellesin. Çıkış tarihi sonradan
// değişmişse eski tamamlanmış işi otomatik olarak yeni tarihin temizliği sayma."
//
// Kurucu K4 (10-17, "önerildiği gibi"): "aynı rezervasyonun çıkış gününe elle açılmış temizlik görevi varsa sistem ikincisini açmasın (ara
// temizlik yine engellemez)."
//
// Kural: tür T (giriş hazırlığı → giriş günü, çıkış temizliği → çıkış günü) için görev "var" sayılır ⇔ rezervasyonda
//   · SİSTEMİN açtığı (origin "system") ve BİTMEMİŞ bir T görevi var (ev sahibi tarihini elle taşımış olsa bile — o görev budur), ya da
//   · SİSTEMİN açtığı, BİTMİŞ bir T görevi var ve vadesi rezervasyonun ŞİMDİKİ hedef günüyle AYNI takvim günü, ya da
//   · (yalnız çıkış temizliği, K4) EV SAHİBİNİN elle açtığı (origin "manual", söze bağlı DEĞİL) temizlik görevi var ve vadesi rezervasyonun
//     ŞİMDİKİ çıkış günüyle AYNI takvim günü (durumu fark etmez: bitmişse temizlik yapılmıştır). Görev rezervasyona bağlı OLMAYABİLİR (görev
//     formu bağlamaz — Opus 10-17); çağıranlar aynı mülkün rezervasyonsuz elle temizliklerini de listeye katar.
// "Var" SAYMAYANLAR: ara temizlik (vadesi başka gün), söz görevi (misafire verilen söz — D7 "mevcut söz görevi korunsun"; söz kendi işidir,
// çıkış temizliğinin yerini tutmaz), mesajdan açılan görev (ai), vadesiz elle görev, giriş hazırlığında elle görev.
// ---------------------------------------------------------------------------
import { calendarDateOf } from "@/modules/availability/core";

export type LifecycleType = "checkin_prep" | "cleaning";

/** `_count.commitments` > 0 → misafire verilmiş bir sözün görevi (`guest-commitments.ts`, origin "manual"). Eksikse söz görevi sayılmaz. */
export type LifecycleTaskLite = {
  type: string;
  origin: string;
  status: string;
  dueAt: Date | null;
  _count?: { commitments: number };
};

/** Saf: rezervasyonun bu türden yaşam döngüsü görevi zaten var mı (yukarıdaki kural). */
export function lifecycleTaskPresent(
  type: LifecycleType,
  target: Date,
  tasks: readonly LifecycleTaskLite[],
  timeZone: string,
): boolean {
  const targetDay = calendarDateOf(target, timeZone).key;
  const sameDay = (t: LifecycleTaskLite) => t.dueAt !== null && calendarDateOf(t.dueAt, timeZone).key === targetDay;
  return tasks.some((t) => {
    if (t.type !== type) return false;
    if (t.origin === "system") return t.status !== "done" || sameDay(t);
    // K4: ev sahibinin aynı çıkış gününe elle açtığı temizlik (söz görevi değil).
    return type === "cleaning" && t.origin === "manual" && (t._count?.commitments ?? 0) === 0 && sameDay(t);
  });
}

/** Görev okuması için seçim (iki çağıran aynı alanları okur). */
export const LIFECYCLE_TASK_LITE_SELECT = {
  type: true,
  origin: true,
  status: true,
  dueAt: true,
  _count: { select: { commitments: true } },
} as const;
