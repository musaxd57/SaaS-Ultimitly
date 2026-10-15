// ---------------------------------------------------------------------------
// İPTAL EDİLMİŞ KONAKLAMADA KALAN SİSTEM GÖREVLERİ (10-15, ChatGPT: "önceki sürümden kalmış iptal kayıtlarının onarımını ayrıca
// değerlendir"). YAPRAK modül (yalnız tip importu): iptal temizliği (`removeAutoTasksForCancelledReservation`) ile salt-okuma teşhis
// betiği (`scripts/diagnose-cancelled-leftover-tasks.ts`) AYNI kümeyi tanımlasın — biri genişlerse öteki sessizce ayrışmasın.
//
// Eski kodda iki yoldan artık kalabiliyordu: (1) iptal temizliği kilitsizdi — iptalden önce başlamış görev açma işlemi görevleri iptalden
// SONRA yazabiliyordu; (2) temizlik düşerse hata yutuluyordu ve satır bir daha denenmiyordu. Bugünkü kod ikisini de kapatır; bu modül
// GEÇMİŞTE kalanları SAYMAK içindir (silme kararı kurucuda).
// ---------------------------------------------------------------------------
import type { Prisma } from "@prisma/client";

/** İptal temizliğinin sildiği küme: yaşam döngüsünün açtığı (origin "system"), bitmemiş giriş hazırlığı / temizlik görevleri.
 *  Ev sahibinin kendi görevi (manual) ve mesajdan açılan görev (ai) iptalde KORUNUR; bitmiş görev iş kaydıdır, silinmez. */
export const OPEN_AUTO_LIFECYCLE_TASK_WHERE = {
  status: { not: "done" },
  type: { in: ["checkin_prep", "cleaning"] },
  origin: "system",
} satisfies Prisma.TaskWhereInput;

/** ONARIM kümesi (kurucu D5, 10-15: "Yalnız … sistemin oluşturduğu, başlanmamış temizlik/giriş hazırlığı görevleri aday olsun. Manuel
 *  görevleri, mesajdan açılanları, tamamlanmış veya personelin işlem yaptığı görevleri koru."): iptal ANINDAKİ temizlik değil, sonradan
 *  yapılan onarım (senkronun onarım taraması, "zaten iptal" satırı, dosyanın yeniden yüklenmesi) yalnız bunu siler — başlanmış ("devam
 *  ediyor" / "onay bekliyor") ya da bir kişinin güncellemesi / fotoğrafı olan görev KORUNUR ve teşhis betiğinde ayrı sayılır. */
export const UNTOUCHED_AUTO_LIFECYCLE_TASK_WHERE = {
  status: "todo",
  type: { in: ["checkin_prep", "cleaning"] },
  origin: "system",
  updates: { none: { OR: [{ userId: { not: null } }, { photoUrl: { not: null } }] } },
} satisfies Prisma.TaskWhereInput;

/** Depoya yüklenmiş fotoğrafın adres öneki — `lib/storage/keys.ts` `STORAGE_PHOTO_URL_PREFIX` ile AYNI (o modül sunucuya özel, betik
 *  import edemez; eşitlik birim testte pinli). Temizlik yalnız bunları depodan silme kuyruğuna alır; dış bağlantılar ayrı sayılır. */
export const STORAGE_PHOTO_PREFIX = "/api/storage/photo/";

export type LeftoverRow = {
  type: string;
  status: string;
  assigned: boolean;
  /** Bir kişinin yazdığı güncelleme (`userId` dolu) — sistem notları (erken giriş notu vb.) sayılmaz (Opus O6). */
  staffUpdates: number;
  storagePhotos: number;
  otherPhotos: number;
  reservation: { id: string; organizationId: string; channel: string; calendarSourceId: string | null; departureDate: Date };
};

export type LeftoverSummary = {
  reservations: number;
  tasks: number;
  /** Etkilenen işletme sayısı + işletme başına görev sayıları (büyükten küçüğe; kimlik YOK). */
  organizations: number;
  tasksPerOrganization: number[];
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  assigned: number;
  withStaffUpdates: number;
  withStoragePhotos: number;
  withOtherPhotos: number;
  /** Rezervasyon kaynağına göre (görev sayısı): takvim bağlantısı · dosyadan içe aktarma · diğer (sağlayıcı senkronu / elle / kaynağı
   *  silinmiş takvim satırı — kaynak silinince satır "manual" olur). */
  bySource: { calendar_feed: number; file: number; other: number };
  /** Konaklamanın çıkışı geçmişte mi (görev sayısı). */
  pastStay: number;
  futureStay: number;
  /** Kurucu D5 (10-15) aday tanımı: BAŞLANMAMIŞ ("yapılacak") ve bir kişinin dokunmadığı (güncelleme / fotoğraf yok) görev. Başlanmış ya da
   *  dokunulmuş olanlar KORUNUR ve ayrı sayılır; atanmış adaylar ayrıca gösterilir (atamayı ev sahibi yapar, karar ona sorulur). */
  candidates: number;
  candidatesAssigned: number;
  protectedStarted: number;
  protectedTouched: number;
};

/** Saf: satırları sayılara indirger (kimlik, ad, başlık ÇIKMAZ). */
export function summarizeLeftovers(rows: readonly LeftoverRow[], now: Date): LeftoverSummary {
  const inc = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);
  const perOrg: Record<string, number> = {};
  const s: LeftoverSummary = {
    reservations: new Set(rows.map((r) => r.reservation.id)).size,
    tasks: rows.length,
    organizations: 0,
    tasksPerOrganization: [],
    byType: {},
    byStatus: {},
    assigned: 0,
    withStaffUpdates: 0,
    withStoragePhotos: 0,
    withOtherPhotos: 0,
    bySource: { calendar_feed: 0, file: 0, other: 0 },
    pastStay: 0,
    futureStay: 0,
    candidates: 0,
    candidatesAssigned: 0,
    protectedStarted: 0,
    protectedTouched: 0,
  };
  for (const r of rows) {
    const touched = r.staffUpdates > 0 || r.storagePhotos > 0 || r.otherPhotos > 0;
    if (r.status !== "todo") s.protectedStarted++;
    else if (touched) s.protectedTouched++;
    else {
      s.candidates++;
      if (r.assigned) s.candidatesAssigned++;
    }
    inc(perOrg, r.reservation.organizationId);
    inc(s.byType, r.type);
    inc(s.byStatus, r.status);
    if (r.assigned) s.assigned++;
    if (r.staffUpdates > 0) s.withStaffUpdates++;
    if (r.storagePhotos > 0) s.withStoragePhotos++;
    if (r.otherPhotos > 0) s.withOtherPhotos++;
    if (r.reservation.calendarSourceId !== null) s.bySource.calendar_feed++;
    else if (r.reservation.channel === "ics") s.bySource.file++;
    else s.bySource.other++;
    if (r.reservation.departureDate.getTime() < now.getTime()) s.pastStay++;
    else s.futureStay++;
  }
  s.tasksPerOrganization = Object.values(perOrg).sort((a, b) => b - a);
  s.organizations = s.tasksPerOrganization.length;
  return s;
}
