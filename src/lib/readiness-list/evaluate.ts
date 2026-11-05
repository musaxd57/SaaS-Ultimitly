// ---------------------------------------------------------------------------
// GİRİŞ HAZIRLIĞI LİSTESİ — SAF DEĞERLENDİRİCİ (kurucu H1 / H-2, 11-05; tasarım
// `docs/TASARIM-2026-11-05-ortak-mimari-hazirlik-personel-degisiklik-ihtiyac.md` §2). DB yok, saat yok (an dışarıdan gelir).
//
// Kurallar (kurucu):
//  · Eksik veri asla "hazır" sayılmaz — bilinmeyen BİLİNMİYOR'dur, asla yeşil değil.
//  · Her faktör dayanağını (kayıt + zaman) ve eksik kalan şartını söyler.
//  · ATANMIŞ OLMAK hazırlık kanıtı DEĞİLDİR. Temizliğin tek kanıtı bugünkü erken giriş çekirdeğinin hükmüdür (`readinessDetailOf`:
//    devir anından SONRA kimlikli "bitti" kaydı, 5 dk oturmuş) — misafire giden "Daireniz hazır" kararıyla AYNI kanıt yolu.
//  · H-2: erişim satırı gizlenmez; v1'de doğrulama yolu olmadığı için "kontrol edilmedi" — genel durum hiçbir zaman "HAZIR" olmaz,
//    en iyi hâli "TEMİZLİK HAZIR". Kod DEĞERİ okunmaz / gösterilmez (yalnız giriş talimatı kalemi var / yok).
// ---------------------------------------------------------------------------

export type FactorState = "ok" | "blocking" | "unknown" | "info";
export type FactorKey = "cleaning" | "cleaning_note" | "issue" | "overlap" | "commitment" | "need" | "access" | "timing";
export type Overall = "not_ready" | "unknown" | "cleaning_ready";

/** Bir faktörün dayandığı kayıt (tür + kimlik + zaman). */
export interface Basis {
  kind: "task_done" | "task_update" | "task" | "reservation" | "commitment" | "conversation_item" | "kb_item";
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
}

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
  /** Hazır hükmünü veren "bitti" kaydı (çekirdeğin `readyMark`ı). */
  readyMark: { id: string | null; at: Date; by: string | null } | null;
  /** Bu devrin temizlik görev(ler)i — yalnız GÖSTERİM (atanan, başladı, son bitti işareti); hüküm çekirdektedir. */
  tasks: { id: string; assignee: string | null; startedAt: Date | null; startedBy: string | null; lastDoneAt: Date | null }[];
}

export interface StayReadinessInput {
  timeZone: string;
  now: Date;
  cleaning: CleaningInput;
  /** Temizlikçi bugün bu devrin temizliğine not yazdı (çekirdeğin `cleaningNote`ı; içerik okunmaz). */
  cleaningNote?: boolean;
  /** Devirde açık sorun / bakım / kontrol görevi (çekirdeğin `openIssue`ı). */
  openIssue: boolean;
  /** Mülkte bağsız / gecikmiş açık bakım (çekirdeğin `maintenanceOpen`ı). */
  maintenanceOpen: boolean;
  /** Varış gecesini işgal eden başka konaklama sayısı (çekirdeğin `otherOverlaps`ı). */
  overlaps: number;
  /** Açık söz (vadesi varış gününün sonuna kadar). */
  commitments: { id: string; label: string; dueAt: Date; assignee: string | null }[];
  /** Açık ihtiyaçlar (konuşma öğesi açık / ev sahibinde). */
  needs: { id: string; label: string; status: "open" | "pending_host"; at: Date }[];
  /** Mülkte etkin "giriş talimatı" bilgi tabanı kalemi var mı (değeri OKUNMAZ). */
  accessInstructions: { id: string; at: Date } | null;
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

function cleaningFactor(c: CleaningInput, tz: string): Factor {
  if (c.unavailable) {
    return { key: "cleaning", state: "unknown", label: "Temizlik durumu şu an okunamadı", missing: "sayfayı yenileyin", basis: [] };
  }
  const task = c.tasks[0] ?? null;
  const taskBasis: Basis[] = c.tasks.map((t) => ({ kind: "task" as const, id: t.id, at: null }));
  const after = c.previousCheckout ? `çıkıştan (${c.previousCheckout}) sonra` : "çıkıştan sonra";
  if (c.status === "ready" && c.readyMark) {
    const by = c.readyMark.by ? ` · ${c.readyMark.by}` : "";
    return {
      key: "cleaning",
      state: "ok",
      label: `Temizlik bitti ${hhmm(c.readyMark.at, tz)}${by} · ${after}`,
      missing: null,
      basis: [{ kind: "task_done", id: c.readyMark.id, at: c.readyMark.at }],
    };
  }
  if (c.status === "not_ready") {
    if (c.note === "fresh") {
      const at = task?.lastDoneAt ? ` ${hhmm(task.lastDoneAt, tz)}` : "";
      return { key: "cleaning", state: "blocking", label: `Temizlik bitti${at} — birkaç dakika içinde kesinleşir`, missing: "5 dakikalık bekleme", basis: taskBasis };
    }
    if (c.note === "before_checkout") {
      const at = task?.lastDoneAt ? ` (${hhmm(task.lastDoneAt, tz)})` : "";
      return { key: "cleaning", state: "blocking", label: `"Bitti" işareti çıkıştan önce${at}`, missing: `${after} atılmış "bitti" kaydı`, basis: taskBasis };
    }
    // Açık görev: atanmış olmak kanıt DEĞİL — kim, başladı mı söylenir, şart aynı kalır.
    // İsme ek GETİRİLMEZ (ünlü uyumu: "Ayşe'ye", "Hasan'a", "Mehmet'e" — kodla doğru çekilemez): "atanan: Ayşe".
    const who = task?.assignee ? `atanan: ${task.assignee}` : "kimseye atanmadı";
    const started = task?.startedAt ? `başladı ${hhmm(task.startedAt, tz)}${task.startedBy ? ` (${task.startedBy})` : ""}` : "başlanmadı";
    return { key: "cleaning", state: "blocking", label: `Temizlik açık · ${who} · ${started}`, missing: `${after} "bitti" kaydı`, basis: taskBasis };
  }
  // Bilinmiyor.
  if (!c.previousKnown) {
    return { key: "cleaning", state: "unknown", label: "Önceki çıkış kayıtlı değil", missing: "önceki konaklamanın çıkışı", basis: [] };
  }
  if (c.note === "no_time") {
    return { key: "cleaning", state: "unknown", label: "Temizlik bitti görünüyor ama kimin ne zaman bitirdiği kayıtlı değil", missing: 'kişi adına "bitti" kaydı', basis: taskBasis };
  }
  return { key: "cleaning", state: "unknown", label: "Devir temizliği görevi yok", missing: "devir temizliği görevi", basis: [] };
}

/** Saf: bir konaklamanın faktörleri + genel durumu. Sıra: engeller → bilinmeyenler → bilgi. */
export function evaluateStay(input: StayReadinessInput): StayReadiness {
  const tz = input.timeZone;
  const factors: Factor[] = [cleaningFactor(input.cleaning, tz)];
  if (input.cleaningNote) {
    // Sorun bildiriminin bugünkü tek yolu temizlikçinin notu (çekirdek: otomatik "Daireniz hazır"ı durdurur) — burada BİLGİ: bakın.
    factors.push({ key: "cleaning_note", state: "info", label: "Temizlikçi bugün bu temizliğe not yazdı — görevde bakın", missing: null, basis: [] });
  }
  if (input.openIssue || input.maintenanceOpen) {
    factors.push({
      key: "issue",
      state: "blocking",
      label: input.openIssue ? "Devirde açık sorun / bakım görevi var" : "Mülkte açık bakım görevi var",
      missing: "bakım görevinin kapanması",
      basis: [],
    });
  }
  if (input.overlaps > 0) {
    factors.push({ key: "overlap", state: "blocking", label: "Aynı gece başka bir konaklama var", missing: "çakışmanın giderilmesi", basis: [] });
  }
  for (const c of input.commitments) {
    const who = c.assignee ? ` · atanan: ${c.assignee}` : "";
    factors.push({
      key: "commitment",
      state: "blocking",
      label: `Söz açık: ${c.label}${who}`,
      missing: "sözün yerine getirilmesi",
      basis: [{ kind: "commitment", id: c.id, at: c.dueAt }],
    });
  }
  for (const n of input.needs) {
    factors.push({
      key: "need",
      state: "info",
      label: `Açık ihtiyaç: ${n.label}${n.status === "pending_host" ? " (sizde)" : ""}`,
      missing: null,
      basis: [{ kind: "conversation_item", id: n.id, at: n.at }],
    });
  }
  factors.push(
    input.accessInstructions
      ? {
          key: "access",
          state: "info",
          label: "Giriş talimatı bilgi tabanında var · kapıya / kutuya yerleştiği kontrol edilmedi",
          missing: "erişim kontrolü",
          basis: [{ kind: "kb_item", id: input.accessInstructions.id, at: input.accessInstructions.at }],
        }
      : { key: "access", state: "info", label: "Giriş talimatı bilgi tabanında yok · erişim kontrol edilmedi", missing: "giriş talimatı ve erişim kontrolü", basis: [] },
  );
  if (input.cleaning.previousCheckout || input.checkInTime) {
    const out = input.cleaning.previousCheckout ? `önceki çıkış ${input.cleaning.previousCheckout}` : "önceki çıkış bilinmiyor";
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
