// ---------------------------------------------------------------------------
// GİRİŞ HAZIRLIĞI LİSTESİ — SAF DEĞERLENDİRİCİ (kurucu H1 / H-2, 11-05; tasarım
// `docs/TASARIM-2026-11-05-ortak-mimari-hazirlik-personel-degisiklik-ihtiyac.md` §2). DB yok, saat yok (an dışarıdan gelir).
//
// Kurallar (kurucu):
//  · Eksik veri asla "hazır" sayılmaz — bilinmeyen BİLİNMİYOR'dur, asla yeşil değil.
//  · Her faktör dayanağını (kayıt + zaman) ve eksik kalan şartını söyler.
//  · ATANMIŞ OLMAK hazırlık kanıtı DEĞİLDİR. Temizliğin tek kanıtı bugünkü erken giriş çekirdeğinin hükmüdür (`readinessDetailOf`:
//    devir anından SONRA kimlikli "bitti" kaydı, 5 dk oturmuş) — misafire giden "erken giriş onayı" kararıyla AYNI kanıt yolu.
//  · H-2: erişim satırı gizlenmez; v1'de doğrulama yolu olmadığı için "kontrol edilmedi" — genel durum hiçbir zaman "HAZIR" olmaz,
//    en iyi hâli "TEMİZLİK HAZIR". Kod DEĞERİ okunmaz / gösterilmez (yalnız giriş talimatı kalemi var / yok).
// ---------------------------------------------------------------------------

import { taskDueReading } from "@/lib/tasks/due-at";

export type FactorState = "ok" | "blocking" | "unknown" | "info";
export type FactorKey = "cleaning" | "cleaning_note" | "issue" | "overlap" | "commitment" | "need" | "access" | "timing";
export type Overall = "not_ready" | "unknown" | "cleaning_ready";

/** Bir faktörün dayandığı kayıt (tür + kimlik + zaman). */
export interface Basis {
  kind: "task_done" | "task_update" | "task" | "reservation" | "commitment" | "conversation_item" | "kb_item" | "auto_message";
  id: string | null;
  at: Date | null;
}

export interface Factor {
  key: FactorKey;
  state: FactorState;
  /** Ev sahibine görünen kısa durum cümlesi. */
  label: string;
  /** Eksik kalan şart (yoksa `null`). */
  missing: string | null;
  basis: Basis[];
  /**
   * UX-10 D2 (kurucu 11-13): satırı ÇÖZEN ekrana götüren tek bağlantı (yazmaz; misafire / personele hiçbir şey göndermez). SAF kuraldan
   * çıkar (aynı girdi → aynı bağlantı); etiketi / hükmü DEĞİŞTİRMEZ. Yoksa bilinçli: bekleme (5 dk), iş sürüyor, hiçbir ürün eyleminin
   * değiştiremediği satır, silinmiş misafir. Tasarım: scratchpad/handoff/UX-10-girisler-tasarim.md §1.1–1.2.
   */
  link?: FactorLink;
  /**
   * UX-10 D3 (kurucu 11-13 "ilk 2'si kesinlikle olur"): satırdaki görevi Girişler'den atama. YALNIZ başlanmamış görevde (Yapılacak /
   * Yapılamıyor; "Yapılacak" yalnız dokunulmamışsa — `assignableTask`); başlamış / bitmiş işte yok (temizlikçiyi işin ortasında düşürürdü). `expectAssigneeId` sunucuya ön şart
   * olarak gider: bu arada görev başka birine atandıysa yazma olmaz (409). Atamak HAZIRLIK KANITI DEĞİLDİR — satırın hükmü değişmez.
   */
  assign?: FactorAssign;
  /**
   * UX-10 D5 (kurucu 11-13): "Giriş mesajını gönderin" — yalnız otomatik giriş mesajının BU misafire GİTMEYECEĞİ ve elle gönderilebileceği
   * satırlarda (otomatik giriş kapalı · rezervasyon açılış tabanından önce · taban yok) VE yükleyici gönderilebilir dediğinde (metin yazılmış,
   * doldurulmamış alan yok, onaylı, kanaldan mesajlaşabilir, bağlantı var, acil durdurma kapalı). Gönderildi / hazır / kontrol bekliyor /
   * doldurulamıyor / yazılmamış / silinmiş satırlarda YOK (gönderici zaten gönderir ya da önce metin düzeltilir). Sunucu her şartı yeniden okur.
   */
  sendCheckin?: true;
}

export interface FactorAssign {
  taskId: string;
  /** Satırın gördüğü atanan (yoksa `null` = "atanmamış bekliyorum"). */
  expectAssigneeId: string | null;
  /** assign = "Birini atayın" · reassign = "Başkasına atayın" (Yapılamıyor) · change = "Değiştirin" (atanmış, başlanmamış). */
  mode: "assign" | "reassign" | "change";
  /**
   * Önerilen kişi = dairenin YEDEK temizlikçisi (kurucu 11-13: "Yapamıyorum kalksın, sistem yedeği önersin"). YALNIZ temizlik satırında, kişi
   * DEĞİŞECEKKEN (reassign / change) ve yedek şu anki atanandan farklıysa. Yalnız ön seçimdir: atama yine "Atayın" ile, sunucu aynı ön şartla.
   */
  suggestUserId?: string;
}

/** Girişler'den atanabilecek görev durumları — sunucu da AYNI kümeyi ister (`api/tasks/[id]` `expectAssignedToId`). */
export const ASSIGNABLE_TASK_STATUSES: readonly string[] = ["todo", "blocked"];
export function assignableStatus(status: string | null | undefined): boolean {
  return status != null && ASSIGNABLE_TASK_STATUSES.includes(status);
}

/**
 * Girişler'den atanabilir mi — TEK saf kural (ekran ve sunucu kilitli satırda aynısını uygular). Eski veride kalmış "Yapılamıyor" her zaman
 * başkasına atanabilir (yeni "Yapılamıyor" yazılamaz — kurucu 11-13). "Yapılacak" YALNIZ iş başlamamışsa: kontrol listesinde işaretli madde,
 * kişinin notu / "Başladım"ı ya da fotoğrafı yoksa — ev sahibinin yeniden ataması iz DEĞİLDİR (temizlikçi değişimindeki aktarımın tanımıyla
 * aynı — `WORK_TRACE_TASK_UPDATE_WHERE` + `checklistTouched`; Opus 11-13 P2-8: işaret
 * `TaskUpdate` yazmaz ve durumu "Yapılacak"ta bırakır, eski kural maddelerin yarısını işaretlemiş kişiyi işin ortasında düşürüyordu).
 * Dokunulmuşluk bilinmiyorsa (`touched` verilmedi) atanmaz — şüphede başkasına verilmez.
 */
export function assignableTask(t: { status?: string | null; touched?: boolean | null }): boolean {
  if (t.status === "blocked") return true;
  return t.status === "todo" && t.touched === false;
}

export type FactorLink =
  | { to: "task"; taskId: string | null; note?: boolean }
  | { to: "tasks" }
  | { to: "auto_message"; reason: "fix" | "check" | "write" }
  | { to: "conversation"; need?: boolean }
  | { to: "property_times" }
  | { to: "connection" }
  | { to: "calendar" }
  | { to: "refresh" };

export interface CleaningInput {
  /** Hüküm OKUNAMADI (yükleyici hata verdi) — bilinmiyor; satır sayfayı düşürmez. */
  unavailable?: boolean;
  /** Bugünkü çekirdeğin hükmü (`loadEarlyCheckinFacts` → `facts.readiness` / `readinessNote`). */
  status: "ready" | "not_ready" | "unknown";
  note: "none" | "open" | "fresh" | "before_checkout" | "no_time" | null;
  /** Devrin (önceki çıkışın) rezervasyonu bulunabildi mi. */
  previousKnown: boolean;
  /** Önceki çıkış saati (mülk diliminde "HH:MM"), bilinmiyorsa `null`. */
  previousCheckout: string | null;
  /** Önceki çıkışın GÜNÜ (mülk takvimi). Varış gününden farklıysa etiketlerde gün de yazılır (Opus 11-05 N6). */
  previousCheckoutDay?: string | null;
  /** Hazır hükmünü veren "bitti" kaydı (çekirdeğin `readyMark`ı). `beforeCheckout`: çıkıştan ÖNCE atılmış, erken temizlik kuralıyla sayılmış. */
  readyMark: { id: string | null; at: Date; by: string | null; beforeCheckout?: boolean } | null;
  /** Bu devrin temizlik görev(ler)i — yalnız GÖSTERİM (atanan, başladı, son bitti işareti); hüküm çekirdektedir. */
  tasks: {
    id: string;
    assignee: string | null;
    /** Atanan kişinin kimliği ve görevin durumu (UX-10 D3 atama düğmesi için; yoksa — eski çağıran — düğme çizilmez). */
    assigneeId?: string | null;
    status?: string | null;
    /** Kişi izi var mı (işaretli madde / kişinin kaydı / fotoğraf) — `assignableTask`. */
    touched?: boolean;
    startedAt: Date | null;
    startedBy: string | null;
    lastDoneAt: Date | null;
    /** Eski veride kalmış "Yapılamıyor" (en son durum kaydı) — kim · ne zaman · neden. */
    blocked?: { at: Date; by: string | null; reason: string | null } | null;
  }[];
  /** Dairenin yedek temizlikçisi (kişi bu işletmede doğrulanmış) — atama kutusunun ön seçimi; hükme ETKİSİ YOK. */
  backupUserId?: string | null;
}

export interface StayReadinessInput {
  timeZone: string;
  now: Date;
  /** Varış günü (mülk takvimi) — önceki çıkış başka gündeyse etikete gün eklenir. */
  arrivalDayKey?: string;
  cleaning: CleaningInput;
  /** Temizlikçi bugün bu devrin temizliğine not yazdı (çekirdeğin `cleaningNote`ı; içerik okunmaz). */
  cleaningNote?: boolean;
  /** Notun dayanağı: en son kimlikli not kaydı (yazan + an; İÇERİK OKUNMAZ). Yoksa genel cümle. */
  cleaningNoteBy?: { updateId: string; by: string | null; at: Date } | null;
  /** Devirde açık sorun / bakım / kontrol görevi (çekirdeğin `openIssue`ı). */
  openIssue: boolean;
  /** Mülkte bağsız / gecikmiş açık bakım (çekirdeğin `maintenanceOpen`ı). */
  maintenanceOpen: boolean;
  /** `openIssue` / `maintenanceOpen` hükmünün dayandığı görevler (yalnız GÖSTERİM — kurucu: "her durumun dayanağı"; Opus 11-05 F7). */
  issueTasks?: {
    id: string;
    title: string;
    kindLabel: string;
    assignee: string | null;
    assigneeId?: string | null;
    status?: string | null;
    touched?: boolean;
    dueAt: Date | null;
    /** Vade hassasiyeti (migration 98); verilmezse eski kural (`taskDueReading`). */
    dueAtPrecision?: string | null;
    /**
     * Görevin bu girişle ilişkisi (kurucu / Codex 11-05 gece: eski konaklamadan kalan bakım bütün girişleri kırmızı yapmasın; açıklamasız
     * kesin hüküm yok): `turnover` = bu devre bağlı (önceki / gelen konaklama ya da devir günü) · `unlinked` = konaklamaya bağsız ·
     * `other_stay` = BAŞKA (eski) bir konaklamaya bağlı. Yoksa (eski çağıran) `turnover` sayılır.
     */
    relation?: "turnover" | "unlinked" | "other_stay";
    /** urgent | standard | low (görevin önceliği). */
    priority?: string;
    /** `other_stay` ise o konaklamanın günleri. */
    stay?: { arrivalKey: string; departureKey: string; when?: "past" | "later" | "overlap" } | null;
  }[];
  /** Gösterilenden fazla açık bakım görevi var (sessiz kesme yok). */
  issueTasksMore?: boolean;
  /** Varış gecesini işgal eden başka konaklama sayısı (çekirdeğin `otherOverlaps`ı). */
  overlaps: number;
  /** Çakışmanın tarafı olan konaklamalar (yalnız GÖSTERİM; gün anahtarları işletme diliminde). */
  overlapStays?: { id: string; guestName: string | null; arrivalKey: string; departureKey: string }[];
  /** Açık söz (vadesi varış gününün sonuna kadar). */
  commitments: {
    id: string;
    label: string;
    dueAt: Date;
    assignee: string | null;
    taskId?: string | null;
    /** Sözün görevinin atananı ve durumu (UX-10 D3). */
    taskAssigneeId?: string | null;
    taskStatus?: string | null;
    taskTouched?: boolean;
  }[];
  /** Açık ihtiyaçlar (konuşma öğesi açık / ev sahibinde). */
  needs: { id: string; label: string; status: "open" | "pending_host"; at: Date }[];
  /** Mülkte etkin "giriş talimatı" bilgi tabanı kalemi var mı (değeri OKUNMAZ). `autoCheckin` verilmişse yalnız "bilgi tabanı daha yeni" notu için. */
  accessInstructions: { id: string; at: Date } | null;
  /**
   * Misafire GİDECEK otomatik giriş mesajının durumu (Codex 11-05: bilgi tabanında giriş kaydı olması gönderilecek mesajın hazır olduğunu
   * kanıtlamaz — otomatik mesajlar `AutoMessageTemplate`te, bilgi tabanından AYRI). Yoksa (eski çağıran) bilgi tabanı satırı yazılır.
   */
  autoCheckin?:
    | { state: "sent"; at: Date }
    | { state: "not_sending"; reason: "kill_switch" | "no_connection" | "no_baseline" | "no_channel" | "before_baseline" | "erased" | "two_properties" | "queue_failed" }
    | { state: "disabled" }
    | { state: "missing" }
    | { state: "skipped"; reason: string }
    | { state: "review"; id: string; at: Date }
    // Kuyrukta gönderimi zaman aşımına uğrayıp kanalda doğrulanamayan giriş mesajı (`review` satırı): misafire GİTMİŞ OLABİLİR (G1 tur 5 T5-B2).
    | { state: "unverified" }
    | { state: "ready"; id: string; at: Date };
  /** UX-10 D5: giriş mesajı bu misafire ELLE gönderilebilir mi (yükleyicinin kararı; yoksa düğme yok). */
  checkinManualSendable?: boolean;
  /** Giriş saati (mülk standardı ya da onaylı erken giriş), "HH:MM". */
  checkInTime: string | null;
}

export interface StayReadiness {
  overall: Overall;
  factors: Factor[];
}

function hhmm(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(d);
}

function dayKeyOf(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(d);
}

/** Bugünse yalnız saat, başka günse "6 Kas 11:20" (Opus 11-05 F8: dünkü kayıt bugünün saati gibi okunmasın). */
function whenLabel(d: Date, now: Date, timeZone: string): string {
  if (dayKeyOf(d, timeZone) === dayKeyOf(now, timeZone)) return hhmm(d, timeZone);
  const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone }).format(d);
  return `${day} ${hhmm(d, timeZone)}`;
}

/** Gün anahtarı ("2026-11-07") → "7 Kas" (anahtar zaten işletme diliminde; burada dilim kaydırılmaz). */
function dayKeyLabel(key: string): string {
  const at = new Date(`${key}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return key;
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" }).format(at);
}

/**
 * Bakım / kontrol görevinin bu girişe etkisi (kurucu / Codex 11-05 gece; tasarım docs/TASARIM-2026-11-06-… §5): acil → ENGEL · düşük
 * öncelik → BİLGİ · bu devre bağlı ya da tarihli (varışa kadar vadeli) bağsız → ENGEL · eski konaklamaya bağlı ya da tarihsiz → BİLİNMİYOR
 * ("bu girişi etkiliyor mu?"). Misafire giden otomatik erken giriş onayı kararı DEĞİŞMEDİ (her açık bakımda bekler — soru K-4).
 */
function issueStateOf(t: { relation?: "turnover" | "unlinked" | "other_stay"; priority?: string; dueAt: Date | null }): FactorState {
  if (t.priority === "urgent") return "blocking";
  if (t.priority === "low") return "info";
  const relation = t.relation ?? "turnover";
  if (relation === "turnover") return "blocking";
  if (relation === "unlinked" && t.dueAt) return "blocking";
  return "unknown";
}

/** Önceki çıkış: varışla aynı gün "11:00", başka gün "3 Kas 11:00"; saat yoksa yalnız gün (başka günse) ya da null (Opus 11-05 N6). */
function checkoutWhen(c: CleaningInput, arrivalDayKey: string | undefined): string | null {
  const otherDay = c.previousCheckoutDay && arrivalDayKey && c.previousCheckoutDay !== arrivalDayKey ? dayKeyLabel(c.previousCheckoutDay) : null;
  if (c.previousCheckout) return otherDay ? `${otherDay} ${c.previousCheckout}` : c.previousCheckout;
  return otherDay;
}

/**
 * Vade (Opus 11-05 N2): yalnız-tarih çapası (00:00Z / 12:00Z — `calendarDateOf`, görev panosuyla aynı kural) SAAT UYDURMAZ: "bugün" /
 * "6 Kas", gecikme GÜN bazında (bugün vadeli iş gün bitmeden "gecikti" değildir). Gerçek an → saat + an kıyası.
 */
function dueText(dueAt: Date, precision: string | null | undefined, now: Date, tz: string): string {
  // Saatsiz mi kararı TEK kaynaktan (`taskDueReading`, migration 98): sütun doluysa sütun, boşsa eski kural.
  const { key, timed } = taskDueReading(dueAt, precision, tz);
  const today = dayKeyOf(now, tz);
  if (!timed) return `${key === today ? "bugün" : dayKeyLabel(key)}${key < today ? " (gecikti)" : ""}`;
  return `${whenLabel(dueAt, now, tz)}${dueAt.getTime() < now.getTime() ? " (gecikti)" : ""}`;
}

/**
 * UX-10 D3: görev atanabilir durumdaysa satıra atama eylemi (yoksa boş nesne — alan hiç yazılmaz). "Başladı mı" burada SORULMAZ: başlamış
 * açık temizliği çağıran taraf zaten eler (iş sürüyor → eylem yok), "Yapılamıyor" görevde başlama kaydı olamaz (son durum kaydı "Yapılamıyor"),
 * bakım / söz satırları başlama bilgisi taşımaz (mutasyon 11-13: içerideki kontrol ölü koddu, kaldırıldı).
 */
function assignFor(
  task: { id: string; assigneeId?: string | null; status?: string | null; touched?: boolean } | null,
  mode: FactorAssign["mode"],
  backupUserId?: string | null,
): { assign?: FactorAssign } {
  if (!task || !assignableTask(task)) return {};
  const expectAssigneeId = task.assigneeId ?? null;
  // Yedek yalnız kişi DEĞİŞİRKEN önerilir; "Birini atayın"da (kimse yok) öneri yok — orada doğru aday dairenin temizlikçisidir, yedek değil.
  const suggest = mode !== "assign" && backupUserId && backupUserId !== expectAssigneeId ? { suggestUserId: backupUserId } : {};
  return { assign: { taskId: task.id, expectAssigneeId, mode, ...suggest } };
}

/**
 * Bakım / söz görevi: sahipsizse "Birini atayın"; "Yapılamıyor" ise atanmış olsa da "Başkasına atayın" (Opus 11-13 P3-9 — kişi işi bıraktı;
 * eskiden atanmış her görevde düğme gizleniyordu, "Yapılamıyor" bakım hiç yeniden atanamıyordu). Atanmış + çalışılabilir görevde yalnız bağlantı.
 */
function issueAssign(t: { id: string; assigneeId?: string | null; status?: string | null; touched?: boolean }): { assign?: FactorAssign } {
  if (t.status === "blocked") return assignFor(t, "reassign");
  return t.assigneeId ? {} : assignFor(t, "assign");
}

function cleaningFactor(c: CleaningInput, tz: string, now: Date, arrivalDayKey: string | undefined): Factor {
  if (c.unavailable) {
    return { key: "cleaning", state: "unknown", label: "Temizlik durumu şu an okunamadı", missing: "sayfayı yenileyin", basis: [], link: { to: "refresh" } };
  }
  const task = c.tasks[0] ?? null;
  const taskBasis: Basis[] = c.tasks.map((t) => ({ kind: "task" as const, id: t.id, at: null }));
  const taskLink: FactorLink = { to: "task", taskId: task?.id ?? null };
  const checkout = checkoutWhen(c, arrivalDayKey);
  const after = checkout ? `çıkıştan (${checkout}) sonra` : "çıkıştan sonra";
  if (c.status === "ready" && c.readyMark) {
    const by = c.readyMark.by ? ` · ${c.readyMark.by}` : "";
    return {
      key: "cleaning",
      state: "ok",
      // Başka günün kaydı tarihiyle (Opus 11-05 N6 — "13:10" bugünün saati gibi okunmasın).
      // 🚨 KANITIN TÜRÜ DOĞRU YAZILIR (Codex 11-10 Q3): 08:45'te biten ve erken temizlik kuralıyla kabul edilen iş, çıkış 11:00 iken
      // "çıkıştan (11:00) sonra" diye gösteriliyordu — hüküm doğru, açıklaması yanlıştı.
      label: `Temizlik bitti ${whenLabel(c.readyMark.at, now, tz)}${by} · ${c.readyMark.beforeCheckout ? `${checkout ? `çıkıştan (${checkout}) önce` : "çıkıştan önce"}, erken temizlik kuralıyla` : after}`,
      missing: null,
      basis: [{ kind: "task_done", id: c.readyMark.id, at: c.readyMark.at }],
    };
  }
  if (c.status === "not_ready") {
    if (c.note === "fresh") {
      const at = task?.lastDoneAt ? ` ${whenLabel(task.lastDoneAt, now, tz)}` : "";
      return { key: "cleaning", state: "blocking", label: `Temizlik bitti${at} — birkaç dakika içinde kesinleşir`, missing: "5 dakikalık bekleme", basis: taskBasis };
    }
    if (c.note === "before_checkout") {
      const at = task?.lastDoneAt ? ` (${whenLabel(task.lastDoneAt, now, tz)})` : "";
      return { key: "cleaning", state: "blocking", label: `"Bitti" işareti çıkıştan önce${at}`, missing: `${after} atılmış "bitti" kaydı`, basis: taskBasis, link: taskLink };
    }
    // "Yapamıyorum" (kurucu 11-05 gece): görev açık ve sahipsiz kaldı — ev sahibinin işi başka birine atamak.
    const blocked = c.tasks.find((t) => t.blocked)?.blocked ?? null;
    if (blocked) {
      const reason = blocked.reason?.trim() ? ` — "${blocked.reason.trim().slice(0, 80)}"` : "";
      return {
        key: "cleaning",
        state: "blocking",
        label: `Temizlik yapılamıyor · ${blocked.by ?? "atanan kişi"} · ${whenLabel(blocked.at, now, tz)}${reason}`,
        missing: "başka birine atama",
        basis: taskBasis,
        link: { to: "task", taskId: c.tasks.find((t) => t.blocked)?.id ?? task?.id ?? null },
        ...assignFor(c.tasks.find((t) => t.blocked) ?? null, "reassign", c.backupUserId),
      };
    }
    // Açık görev: atanmış olmak kanıt DEĞİL — kim, başladı mı söylenir, şart aynı kalır.
    // İsme ek GETİRİLMEZ (ünlü uyumu: "Ayşe'ye", "Hasan'a", "Mehmet'e" — kodla doğru çekilemez): "atanan: Ayşe".
    const who = task?.assignee ? `atanan: ${task.assignee}` : "kimseye atanmadı";
    const started = task?.startedAt ? `başladı ${whenLabel(task.startedAt, now, tz)}${task.startedBy ? ` (${task.startedBy})` : ""}` : "başlanmadı";
    // İş sürüyorsa (başladı) bağlantı yok: yapılacak bir şey yok, beklenir.
    return {
      key: "cleaning",
      state: "blocking",
      label: `Temizlik açık · ${who} · ${started}`,
      missing: `${after} "bitti" kaydı`,
      basis: taskBasis,
      ...(task?.startedAt ? {} : { link: taskLink, ...assignFor(task, task?.assigneeId ? "change" : "assign", c.backupUserId) }),
    };
  }
  // Bilinmiyor.
  if (!c.previousKnown) {
    return { key: "cleaning", state: "unknown", label: "Önceki çıkış kayıtlı değil", missing: "önceki konaklamanın çıkışı", basis: [] };
  }
  if (c.tasks.length > 0 && (c.note === "none" || c.note === null)) {
    // Görev VAR ama çekirdek çıkış anını kuramadı (ör. mülkün çıkış saati okunamadı) — "görev yok" demek yanlış olurdu (Opus 11-05 F8).
    return { key: "cleaning", state: "unknown", label: "Önceki çıkış saati okunamadı", missing: "dairenin çıkış saati", basis: taskBasis, link: { to: "property_times" } };
  }
  if (c.note === "no_time") {
    return { key: "cleaning", state: "unknown", label: "Temizlik bitti görünüyor ama kimin ne zaman bitirdiği kayıtlı değil", missing: 'kişi adına "bitti" kaydı', basis: taskBasis, link: taskLink };
  }
  // Görevi Girişler'den açmak D4 (kurucu sorusu); bugün Görevler sayfasındaki "Eksik görevleri oluştur".
  return { key: "cleaning", state: "unknown", label: "Devir temizliği görevi yok", missing: "devir temizliği görevi", basis: [], link: { to: "tasks" } };
}

/** Otomatik giriş mesajı bu rezervasyona GİTMEYECEK — neden (ev sahibi dili; teknik ayrıntı yok). */
const NOT_SENDING_TEXT: Record<"kill_switch" | "no_connection" | "no_baseline" | "no_channel" | "before_baseline" | "erased" | "two_properties" | "queue_failed", string> = {
  kill_switch: "Otomatik mesajlar şu an kapalı",
  no_connection: "Kanal bağlantısı yok, otomatik giriş mesajı gitmez",
  no_baseline: "Otomatik giriş mesajı gitmez",
  no_channel: "Bu rezervasyona otomatik mesaj gönderilemiyor (takvimden ya da elle eklendi)",
  before_baseline: "Rezervasyon otomatik giriş mesajı açılmadan önce yapılmış, mesaj gitmez",
  erased: "Misafirin verileri silindiği için otomatik mesaj gitmez",
  // Kurucu 11-18 akşam: sistem daire tahmin etmez (`booking-property-conflict.ts`). Metin kurucu onayına sunuldu.
  two_properties: "Bu rezervasyon iki dairede kayıtlı, otomatik mesaj gitmez",
  // G1 tur 4 T4-B2 (11-20): kuyruktaki giriş mesajı kanal tarafından kesin reddedilip son durumda ("başarısız") kaldı — gönderici o
  // rezervasyonu bir daha kuyruğa almaz. Ekran "hazır" diyordu; metin kurucunun seçimi (11-20 sabah G-1) + elle gönderim.
  queue_failed: "Otomatik giriş mesajı gönderilemedi",
};

/** Gitmeyen otomatik giriş mesajının sebebine göre bağlantı. Silinmiş misafire (erased) ve konuşması olmayana (no_channel) BİLİNÇLİ YOK. */
const NOT_SENDING_LINK: Record<keyof typeof NOT_SENDING_TEXT, FactorLink | null> = {
  kill_switch: { to: "conversation" },
  no_connection: { to: "connection" },
  no_baseline: { to: "conversation" },
  before_baseline: { to: "conversation" },
  no_channel: null,
  erased: null,
  two_properties: null,
  queue_failed: { to: "conversation" },
};

/**
 * UX-10 D5: elle gönderim düğmesinin çıktığı "gitmez" sebepleri. Acil durdurma (kill_switch) BİLEREK yok (temkinli; kurucu sorusu S-1b),
 * bağlantı yok / kanalsız / silinmiş misafir zaten gönderilemez.
 */
// İki dairede kayıtlı rezervasyonda (two_properties) ev sahibi DOĞRU dairenin satırından elle gönderebilir: daireyi o seçmiş olur.
// Kuyrukta başarısız kalan giriş mesajı (queue_failed) misafire ulaşmadı: elle gönderim doğrudan yoldan gider (`sendCheckinNow` aynı küme).
const MANUAL_SEND_REASONS: ReadonlySet<string> = new Set(["no_baseline", "before_baseline", "two_properties", "queue_failed"]);

const SKIP_REASON_TEXT: Record<string, string> = {
  unfilled: "doldurulmamış alan var",
  apartment_unresolved: "daire numarası çözülemedi",
};

/**
 * Erişim satırı. Otomatik giriş mesajının durumu verildiyse ONA bakar (misafire gidecek olan odur — Codex 11-05); kapıya / kutuya
 * yerleştiği v1'de doğrulanamaz (H-2) → hazır mesajda da "kontrol edilmedi". Mesajın DEĞERİ okunmaz / gösterilmez.
 */
function accessFactor(input: StayReadinessInput): Factor {
  const a = input.autoCheckin;
  const kbNewer = (at: Date) => (input.accessInstructions && input.accessInstructions.at.getTime() > at.getTime() ? " · bilgi tabanındaki giriş bilgisi daha yeni — kontrol edin" : "");
  if (a?.state === "sent") {
    return {
      key: "access",
      state: "info",
      label: `Otomatik giriş mesajı gönderildi ${whenLabel(a.at, input.now, input.timeZone)}${kbNewer(a.at)} · kapıya / kutuya yerleştiği kontrol edilmedi`,
      missing: "erişim kontrolü",
      basis: [],
    };
  }
  if (a?.state === "not_sending") {
    return {
      key: "access",
      state: "info",
      label: `${NOT_SENDING_TEXT[a.reason]} · giriş bilgisini siz gönderin`,
      missing: "giriş bilgisi ve erişim kontrolü",
      basis: [],
      ...(NOT_SENDING_LINK[a.reason] ? { link: NOT_SENDING_LINK[a.reason]! } : {}),
      ...(input.checkinManualSendable && MANUAL_SEND_REASONS.has(a.reason) ? { sendCheckin: true as const } : {}),
    };
  }
  if (a?.state === "ready") {
    return {
      key: "access",
      state: "info",
      label: `Otomatik giriş mesajı hazır${kbNewer(a.at)} · kapıya / kutuya yerleştiği kontrol edilmedi`,
      missing: "erişim kontrolü",
      basis: [{ kind: "auto_message", id: a.id, at: a.at }],
    };
  }
  if (a?.state === "skipped") {
    return {
      key: "access",
      state: "blocking",
      label: `Otomatik giriş mesajı gönderilemiyor: ${SKIP_REASON_TEXT[a.reason] ?? "metin doldurulamadı"}`,
      missing: "giriş mesajının düzeltilmesi (Daire → Otomatik mesajlar)",
      basis: [],
      link: { to: "auto_message", reason: "fix" },
    };
  }
  if (a?.state === "unverified") {
    // G1 tur 5 T5-B2 (11-20): kuyrukta gönderim zaman aşımına uğradı, kanalda da görülemedi (`review`) — mesaj misafire gitmiş OLABİLİR.
    // "Hazır" (= gidecek) demek yanlıştı; elle gönderim düğmesi BİLEREK yok (gitmişse ikinci kapı kodu mesajı olur). Ürünün belirsiz gönderim
    // dili ("Gönderim doğrulanamadı, konuşmayı kontrol edin" — gelen kutusu / karar cevabı) + konuşmaya bağlantı.
    return {
      key: "access",
      state: "unknown",
      label: "Otomatik giriş mesajının gönderimi doğrulanamadı · konuşmayı kontrol edin",
      missing: "giriş mesajının misafire ulaştığının kontrolü",
      basis: [],
      link: { to: "conversation" },
    };
  }
  if (a?.state === "review") {
    return {
      key: "access",
      state: "unknown",
      label: "Otomatik giriş mesajı kontrol bekliyor (iki farklı kaynaktan geldi)",
      missing: "mesajı kontrol edip kaydetme",
      basis: [{ kind: "auto_message", id: a.id, at: a.at }],
      link: { to: "auto_message", reason: "check" },
    };
  }
  if (a?.state === "disabled") {
    return {
      key: "access",
      state: "info",
      label: "Otomatik giriş mesajı kapalı · giriş bilgisini siz gönderin",
      missing: "erişim kontrolü",
      basis: [],
      link: { to: "conversation" },
      ...(input.checkinManualSendable ? { sendCheckin: true as const } : {}),
    };
  }
  if (a?.state === "missing") {
    // Doğru eylem metni YAZMAK (yazılınca gönderici kendisi, damgalı ve çiftsiz gönderir); elle göndermek değil (tasarım §1.3).
    return { key: "access", state: "info", label: "Otomatik giriş mesajı yazılmamış · giriş bilgisini siz gönderin", missing: "giriş mesajı ve erişim kontrolü", basis: [], link: { to: "auto_message", reason: "write" } };
  }
  // Eski çağıran (otomatik mesaj durumu yok): bilgi tabanı satırı.
  return input.accessInstructions
    ? {
        key: "access",
        state: "info",
        label: "Giriş talimatı bilgi tabanında var · kapıya / kutuya yerleştiği kontrol edilmedi",
        missing: "erişim kontrolü",
        basis: [{ kind: "kb_item", id: input.accessInstructions.id, at: input.accessInstructions.at }],
      }
    : { key: "access", state: "info", label: "Giriş talimatı bilgi tabanında yok · erişim kontrol edilmedi", missing: "giriş talimatı ve erişim kontrolü", basis: [] };
}

/** Saf: bir konaklamanın faktörleri + genel durumu. Sıra: engeller → bilinmeyenler → bilgi. */
export function evaluateStay(input: StayReadinessInput): StayReadiness {
  const tz = input.timeZone;
  const factors: Factor[] = [cleaningFactor(input.cleaning, tz, input.now, input.arrivalDayKey)];
  if (input.cleaningNote) {
    // Sorun bildiriminin bugünkü tek yolu temizlik görevine yazılan not (çekirdek: otomatik erken giriş onayını durdurur) — burada
    // BİLGİ: bakın. Ağırlığı (bilgi mi, "bilinmiyor" mu) kurucu sorusu J-10. Notu yazan + an gösterilir, İÇERİK gösterilmez.
    const n = input.cleaningNoteBy ?? null;
    factors.push(
      n
        ? {
            key: "cleaning_note",
            state: "info",
            label: `Temizlik görevine not yazıldı · ${n.by ? `${n.by} · ` : ""}${whenLabel(n.at, input.now, tz)} — görevde okuyun`,
            missing: null,
            basis: [{ kind: "task_update", id: n.updateId, at: n.at }],
            link: { to: "task", taskId: input.cleaning.tasks[0]?.id ?? null, note: true },
          }
        : // Notu yazan her zaman temizlikçi değildir (ev sahibi / yönetici de yazabilir) — cümle kişiyi varsaymaz.
          {
            key: "cleaning_note",
            state: "info",
            label: "Temizlik görevine bugün not yazıldı — görevde okuyun",
            missing: null,
            basis: [],
            link: { to: "task", taskId: input.cleaning.tasks[0]?.id ?? null, note: true },
          },
    );
  }
  if (input.openIssue || input.maintenanceOpen) {
    const all = input.issueTasks ?? [];
    // Sözden doğan görev "Söz açık" satırında zaten yazılı → ikinci kez (çelişen vadeyle) yazılmaz; söz satırı yine ENGEL (Opus 11-05 N2).
    const promised = new Set(input.commitments.map((c) => c.taskId).filter((x): x is string => !!x));
    const shown = all.filter((t) => !promised.has(t.id));
    if (all.length === 0) {
      factors.push({
        key: "issue",
        state: "blocking",
        label: input.openIssue ? "Devirde açık sorun / bakım görevi var" : "Dairede açık bakım görevi var",
        missing: "bakım görevinin kapanması",
        basis: [],
        link: { to: "tasks" },
      });
    }
    for (const t of shown) {
      // Listenin kendi kalıbı ("Söz açık: …", "Temizlik açık · …"); tür adı Görevler sayfasındakiyle AYNEN (harf oynatılmaz).
      const who = t.assignee ? `atanan: ${t.assignee}` : "kimseye atanmadı";
      const due = t.dueAt ? ` · vade ${dueText(t.dueAt, t.dueAtPrecision, input.now, tz)}` : "";
      const state = issueStateOf(t);
      if (state === "unknown") {
        // Eski konaklamadan kalan / tarihsiz bakım: kesin hüküm YOK, açıklama var (kurucu / Codex 11-05 gece).
        const which = t.stay?.when === "later" ? "sonraki" : t.stay?.when === "overlap" ? "başka bir" : "eski";
        const where = t.relation === "other_stay" && t.stay ? ` · ${which} konaklamadan (${dayKeyLabel(t.stay.arrivalKey)} – ${dayKeyLabel(t.stay.departureKey)})` : t.dueAt ? due : " · tarihsiz";
        factors.push({
          key: "issue",
          state: "unknown",
          label: `${t.kindLabel} açık: ${t.title}${where} · ${who} — bu girişi etkiliyor mu?`,
          missing: "görevin kapanması ya da bu güne tarihlenmesi",
          basis: [{ kind: "task", id: t.id, at: t.dueAt }],
          link: { to: "task", taskId: t.id },
          ...issueAssign(t),
        });
        continue;
      }
      factors.push({
        key: "issue",
        state,
        label: `${t.kindLabel} açık${t.priority === "low" ? " (düşük öncelik)" : ""}: ${t.title} · ${who}${due}`,
        missing: state === "blocking" ? "görevin kapanması" : null,
        basis: [{ kind: "task", id: t.id, at: t.dueAt }],
        // Düşük öncelikli bilgi satırı "Ayrıntılar"da kalır, bağlantısız.
        ...(state === "blocking" ? { link: { to: "task", taskId: t.id } as FactorLink, ...issueAssign(t) } : {}),
      });
    }
    // Ölçülü (muhafazakâr) yan: gösterilmeyen bakım görevi zaten bir sorun satırıysa bu cümle fazladan söylenmiş olur — eksik söylemekten iyi.
    if (all.length > 0 && input.issueTasksMore) {
      // Görünmeyen görevlerin niteliği bilinmiyor → kesin engel değil, "bakın".
      factors.push({ key: "issue", state: "unknown", label: "Bu dairede başka açık bakım görevleri de var", missing: "Görevler'de kontrol", basis: [], link: { to: "tasks" } });
    }
  }
  if (input.overlaps > 0) {
    const stays = input.overlapStays ?? [];
    if (stays.length === 0) {
      factors.push({ key: "overlap", state: "blocking", label: "Aynı gece başka bir konaklama var", missing: "çakışmanın giderilmesi", basis: [], link: { to: "calendar" } });
    }
    for (const s of stays) {
      factors.push({
        key: "overlap",
        state: "blocking",
        // "Çakışan" (aynı gece değil): aynı gün iki ayrılış da çakışmadır — ikisi de listelenir.
        label: `Çakışan konaklama: ${s.guestName?.trim() || "adı kayıtlı değil"} · ${dayKeyLabel(s.arrivalKey)} – ${dayKeyLabel(s.departureKey)}`,
        missing: "çakışmanın giderilmesi",
        basis: [{ kind: "reservation", id: s.id, at: null }],
        // Çifte rezervasyonu ürün çözemez (iptal kanalda yapılır) — takvimde görmek.
        link: { to: "calendar" },
      });
    }
  }
  for (const c of input.commitments) {
    const who = c.assignee ? ` · atanan: ${c.assignee}` : "";
    factors.push({
      key: "commitment",
      state: "blocking",
      label: `Söz açık: ${c.label}${who}`,
      missing: "sözün yerine getirilmesi",
      basis: [{ kind: "commitment", id: c.id, at: c.dueAt }],
      link: { to: "task", taskId: c.taskId ?? null },
      // Sözün görevi atanmamışsa "Birini atayın" (atanmışsa yalnız görev bağlantısı).
      ...(c.taskId ? issueAssign({ id: c.taskId, assigneeId: c.taskAssigneeId ?? null, status: c.taskStatus, touched: c.taskTouched }) : {}),
    });
  }
  for (const n of input.needs) {
    factors.push({
      key: "need",
      state: "info",
      label: `Açık ihtiyaç: ${n.label}${n.status === "pending_host" ? " (sizde)" : ""}`,
      missing: null,
      basis: [{ kind: "conversation_item", id: n.id, at: n.at }],
      // "Tamamlandı" buradan YOK (okunmadan kapatılırdı) — konuşmada görmek.
      link: { to: "conversation", need: true },
    });
  }
  factors.push(accessFactor(input));
  const prevCheckout = checkoutWhen(input.cleaning, input.arrivalDayKey);
  if (prevCheckout || input.checkInTime) {
    // Aynı gün çıkış yoksa da önceki çıkış biliniyor (hazırlık ona göre ölçüldü) → günüyle yazılır (Opus 11-05 N6).
    const out = prevCheckout ? `Önceki çıkış ${prevCheckout}` : "Önceki çıkış bilinmiyor";
    const inn = input.checkInTime ? `giriş ${input.checkInTime}` : "giriş saati bilinmiyor";
    factors.push({ key: "timing", state: "info", label: `${out} → ${inn}`, missing: null, basis: [] });
  }
  const overall: Overall = factors.some((f) => f.state === "blocking")
    ? "not_ready"
    : factors.some((f) => f.state === "unknown")
      ? "unknown"
      : "cleaning_ready";
  return { overall, factors };
}

/** Genel durumun ev sahibine görünen adı (v1'de "HAZIR" YOK — H-2). */
export const OVERALL_LABEL: Record<Overall, string> = {
  not_ready: "HAZIR DEĞİL",
  unknown: "BİLİNMİYOR",
  cleaning_ready: "TEMİZLİK HAZIR",
};
