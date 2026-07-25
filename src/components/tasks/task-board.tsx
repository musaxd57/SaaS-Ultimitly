"use client";

import { useRef, useState, useTransition } from "react";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, User, Clock, CheckSquare, Camera, FileText, ChevronDown, ChevronRight, Share2, Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { TASK_STATUS, TASK_TYPE, PRIORITY } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface TaskCardData {
  id: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  propertyName: string;
  assigneeName: string | null;
  dueLabel: string | null;
  dueDays?: number | null; // whole days from today to the due date (for the time filter)
  checklist: { items: { label: string; done: boolean }[] } | null;
  latestPhotoUrl?: string | null;
  latestNote?: string | null;
}

// The three Kanban columns. A card lands in exactly one: explicit todo / done,
// and anything in-between (in_progress, the legacy awaiting_review, or any
// unknown value) falls into the middle "Devam ediyor" column so nothing is ever
// hidden. The on-card Select (todo / in_progress / done) is how you move a card.
const COLUMNS: { key: string; label: string; dot: string }[] = [
  { key: "todo", label: "Yapılacak", dot: "bg-muted-foreground/40" },
  { key: "in_progress", label: "Devam ediyor", dot: "bg-primary" },
  { key: "done", label: "Tamamlandı", dot: "bg-emerald-500" },
];
function columnOf(status: string): string {
  if (status === "todo") return "todo";
  if (status === "done") return "done";
  return "in_progress";
}
// Status options offered on each card — the model keeps a 4th "Onay bekliyor"
// state, but cleaning/check-in work only needs these three (matches the columns).
const SELECT_STATUSES = TASK_STATUS.options.filter(
  (o) => o.value === "todo" || o.value === "in_progress" || o.value === "done",
);

/**
 * Kartın tarih satırındaki ACİLİYET eki. Geciken görev, gelecekteki bir görevle
 * bire bir aynı görünüyordu (aynı gri saat ikonu + aynı gri tarih): aciliyeti
 * öğrenmenin tek yolu "Geciken" filtresine tıklamaktı, yani hostun geciktiğini
 * ZATEN bilmesi gerekiyordu. Panonun ev sahibi için tek asıl sorusu budur.
 *
 * Gecikme METİNLE yazılır, yalnız renkle değil (WCAG 1.4.1).
 *
 * "done" ASLA geciken sayılmaz — aşağıdaki `inWindow` ile BİREBİR aynı tanım.
 * İki ayrı "geciken" tanımı olsaydı kart rozeti, "Geciken (N)" sayacının
 * saymadığı bir şeyi geciken diye gösterirdi.
 *
 * Gelecekteki görevlere ek YOK: 50 kartın hepsinde rozet, rozeti gürültüye
 * çevirir ve tam da ayırt etmesi gereken şeyi ayırt edilemez yapar.
 */
function dueEmphasis(t: TaskCardData): { text: string; className: string } | null {
  if (t.dueDays == null || t.status === "done") return null;
  if (t.dueDays < 0) {
    const late = -t.dueDays;
    return { text: `${late} gün gecikti`, className: "font-medium text-destructive" };
  }
  if (t.dueDays === 0) return { text: "Bugün", className: "font-medium text-foreground" };
  return null;
}

export function TaskBoard({ tasks, canManage = true }: { tasks: TaskCardData[]; canManage?: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [noteMap, setNoteMap] = useState<Record<string, string>>({});
  /** noteMap'in REF aynası. Gerekçesi: bir istek beklerken kullanıcı metni
   *  değiştirebilir; `await`ten sonra GÜNCEL değeri senkron okuyabilmek şart
   *  (state okuması o anki render'ın kapanışıdır, bayattır). */
  const noteMapRef = useRef<Record<string, string>>({});
  function setNoteValue(id: string, value: string) {
    noteMapRef.current = { ...noteMapRef.current, [id]: value };
    setNoteMap(noteMapRef.current);
  }
  const [noteError, setNoteError] = useState<Record<string, string>>({});
  /** Not kaydının GÖRÜNÜR durumu (id → "saving" | "saved"). Zamanlayıcı yok:
   *  "saved" kullanıcı yeniden yazmaya başlayınca temizlenir. */
  const [noteStatus, setNoteStatus] = useState<Record<string, "saving" | "saved" | undefined>>({});
  /** Çift-gönderim kilidi REF'te, state'te DEĞİL: "Notu kaydet" düğmesine
   *  tıklamak textarea'yı BLUR eder, yani tıklama + blur art arda saveNote
   *  çağırır. State güncellemesi asenkron olduğu için ikinci çağrı henüz
   *  "saving" görmez ve İKİ istek giderdi. Ref senkron okunur, pencere kapanır. */
  const savingNotes = useRef<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Cards are compact by default (note input + photo hidden) so 50+ tasks don't
  // become an endless scroll; tap "Not / fotoğraf" to reveal the editors.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Time window — default "this week" so far-future tasks don't all dump in. The
  // status axis is the Kanban columns now (no separate status filter pill).
  const [timeRange, setTimeRange] = useState<"overdue" | "today" | "week" | "month" | "all">("week");
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setStatus(id: string, status: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        // The Select is controlled by the server prop, so it snaps back on its own;
        // tell the user why the change didn't stick.
        toast.error(res.status === 403 ? "Bu işlem için yetkiniz yok." : "Görev durumu güncellenemedi.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusyId(null);
    }
  }

  // Toggle one checklist item (e.g. "Çarşaf takımı × 2") done/undone and persist.
  // Allowed for staff too — they do the cleaning and tick items off.
  async function toggleChecklistItem(id: string, items: { label: string; done: boolean }[], index: number) {
    if (busyId === id) return;
    const next = items.map((it, i) => (i === index ? { ...it, done: !it.done } : it));
    setBusyId(id);
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checklist: next }),
      });
      if (!res.ok) {
        toast.error(res.status === 403 ? "Bu işlem için yetkiniz yok." : "Güncellenemedi.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    const ok = await confirmDialog({
      title: "Bu görevi silmek istiyor musunuz?",
      body: "Görev ve notları kalıcı olarak silinir.",
      confirmLabel: "Sil",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(res.status === 403 ? "Görev silme yetkiniz yok (yalnızca yönetici)." : "Görev silinemedi.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusyId(null);
    }
  }

  async function handlePhotoChange(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingId(id);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // Task binding: used ONLY by the object-storage upload path (flag ON) to
      // prove ownership before storing; the legacy local path ignores it.
      fd.append("taskId", id);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: fd });
      if (!uploadRes.ok) {
        toast.error("Fotoğraf yüklenemedi.");
        return;
      }
      const { url } = await uploadRes.json();
      const patchRes = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoUrl: url }),
      });
      if (!patchRes.ok) {
        // The image uploaded but didn't attach — say so instead of failing silently.
        toast.error("Fotoğraf kaydedilemedi, tekrar deneyin.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setUploadingId(null);
      if (fileInputRefs.current[id]) fileInputRefs.current[id]!.value = "";
    }
  }

  /**
   * Notu kaydet. Eskiden YALNIZ blur'da ve GÖRÜNÜR bir durum olmadan koşuyordu
   * (Codex): kullanıcı sayfadan ayrılırken notun gidip gitmediğini anlayamıyordu.
   * Artık açık bir "Kaydet" düğmesi var, blur güvenlik ağı olarak KALIYOR ve
   * durum ekranda: "Kaydediliyor…" → "Kaydedildi".
   *
   * "Kaydedildi" bir ZAMANLAYICIYLA silinmez — kullanıcı yeniden yazmaya
   * başlayınca kalkar (formların geri kalanındaki kuralın aynısı).
   */
  async function saveNote(id: string) {
    const note = noteMap[id];
    if (!note?.trim()) return;
    if (savingNotes.current.has(id)) return; // blur + düğme çift göndermesin
    savingNotes.current.add(id);
    setNoteError((prev) => ({ ...prev, [id]: "" }));
    setNoteStatus((prev) => ({ ...prev, [id]: "saving" }));
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        // Keep the typed note so it isn't lost; tell the user it didn't save.
        setNoteError((prev) => ({ ...prev, [id]: "Not kaydedilemedi, tekrar deneyin." }));
        setNoteStatus((prev) => ({ ...prev, [id]: undefined }));
        return;
      }
      // Sonuç GÖNDERİLEN metne bağlanır (Codex): A uçarken kullanıcı B yazdıysa
      // A'nın yanıtı B'yi ne SİLMELİ ne de "Kaydedildi" diye onaylamalı — ikisi de
      // yalan olurdu (biri veri kaybı, diğeri sahte onay). Alan yalnız hâlâ
      // gönderilen metni taşıyorsa temizlenir; değiştiyse B durur, durum sıfırlanır
      // ve düğme yeniden aktifleşir → B kaydedilebilir.
      const unchanged = noteMapRef.current[id] === note;
      if (unchanged) setNoteValue(id, "");
      setNoteStatus((prev) => ({ ...prev, [id]: unchanged ? "saved" : undefined }));
      startTransition(() => router.refresh());
    } catch {
      setNoteError((prev) => ({ ...prev, [id]: "Bağlantı hatası, not kaydedilemedi." }));
      setNoteStatus((prev) => ({ ...prev, [id]: undefined }));
    } finally {
      savingNotes.current.delete(id);
    }
  }

  const timeFilters: { value: "overdue" | "today" | "week" | "month" | "all"; label: string }[] = [
    { value: "overdue", label: "Geciken" },
    { value: "today", label: "Bugün" },
    { value: "week", label: "Bu hafta" },
    { value: "month", label: "Bu ay" },
    { value: "all", label: "Tümü" },
  ];
  const rangeMatch = (d: number | null | undefined, range: typeof timeRange) => {
    if (d == null) return range !== "overdue"; // no due date → show everywhere except Geciken
    if (range === "overdue") return d < 0; // past due (Geciken)
    if (range === "today") return d === 0; // today ONLY — matches the dashboard's "Bugünkü Görevler"
    if (range === "week") return d <= 7; // overdue stays visible here too (default view)
    if (range === "month") return d <= 31;
    return true;
  };
  // A finished task is never "geciken" (overdue) — keep the Tamamlandı column out
  // of the Geciken window. In every other window it shows by its due date, so each
  // window is a self-contained board (this week's plan + this week's done work).
  const inWindow = (t: TaskCardData, range: typeof timeRange) =>
    !(t.status === "done" && range === "overdue") && rangeMatch(t.dueDays, range);
  const visible = tasks.filter((t) => inWindow(t, timeRange));

  // Shareable cleaning list (the cleaner doesn't log in — the host sends this over
  // WhatsApp / copies it). Built from the OPEN cleaning tasks in the current view
  // (a done cleaning isn't something you ask the cleaner to do).
  const cleaningTasks = visible.filter((t) => t.type === "cleaning" && t.status !== "done");
  const shareText =
    "🧹 Temizlik Listesi\n\n" +
    (cleaningTasks.length === 0
      ? "(seçili aralıkta temizlik yok)"
      : cleaningTasks
          .map((t) => "• " + [t.dueLabel, t.propertyName, t.title].filter(Boolean).join(" — "))
          .join("\n"));
  const waLink = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  async function copyList() {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Kopyalanamadı. Listeyi elle seçip kopyalayabilirsiniz.");
    }
  }

  function renderCard(t: TaskCardData) {
    const due = dueEmphasis(t);
    return (
      <div
        key={t.id}
        className={cn(
          "rounded-lg border border-border bg-card p-3 shadow-sm transition-opacity",
          t.status === "done" && "opacity-70",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 break-words text-sm font-medium leading-snug">{t.title}</p>
          {canManage ? (
            <button
              type="button"
              onClick={() => remove(t.id)}
              disabled={busyId === t.id}
              className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              aria-label="Sil"
            >
              {busyId === t.id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={TASK_TYPE.tone(t.type)}>{TASK_TYPE.label(t.type)}</Badge>
          {/* Only flag priority when it's urgent — 'Standart' is just noise on 50+ cards */}
          {t.priority === "urgent" ? (
            <Badge tone={PRIORITY.tone(t.priority)}>{PRIORITY.label(t.priority)}</Badge>
          ) : null}
        </div>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p className="break-words">{t.propertyName}</p>
          {t.assigneeName ? (
            <p className="flex items-center gap-1">
              <User className="size-3" /> {t.assigneeName}
            </p>
          ) : null}
          {t.dueLabel ? (
            <p className={cn("flex items-center gap-1", due?.className)}>
              <Clock className="size-3 shrink-0" /> {t.dueLabel}
              {due ? <span>· {due.text}</span> : null}
            </p>
          ) : null}
          {t.checklist ? (
            <p className="flex items-center gap-1">
              <CheckSquare className="size-3" /> {t.checklist.items.filter((c) => c.done).length}/
              {t.checklist.items.length}
            </p>
          ) : null}
        </div>

        {/* Latest note */}
        {t.latestNote ? (
          <p className="mt-2 flex items-start gap-1 rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
            <FileText className="mt-0.5 size-3 shrink-0" />
            <span className="line-clamp-2">{t.latestNote}</span>
          </p>
        ) : null}

        {/* Status — always visible; this is how you move a card between columns */}
        <Select
          value={columnOf(t.status)}
          disabled={busyId === t.id}
          onChange={(e) => setStatus(t.id, e.target.value)}
          className="mt-2 h-9 text-xs"
          // Görsel bir etiketi yok (kart zaten dar) — ekran okuyucu için HANGİ
          // görevin durumu olduğu da söylenir, yoksa 20 kartta 20 tane
          // ayırt edilemez "seçim kutusu" duyulur.
          aria-label={`Görev durumu: ${t.title}`}
        >
          {SELECT_STATUSES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>

        {/* Detail toggle — keeps the card compact (note input + photo hidden) */}
        <button
          type="button"
          onClick={() => toggleExpanded(t.id)}
          className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {expanded.has(t.id) ? (
            <>
              <ChevronDown className="size-3" /> Gizle
            </>
          ) : (
            <>
              <ChevronRight className="size-3" /> Not{t.type === "cleaning" ? " / fotoğraf" : ""}
              {t.latestPhotoUrl ? <Camera className="size-3" /> : null}
            </>
          )}
        </button>

        {expanded.has(t.id) ? (
          <>
            {/* Checklist — the cleaner sees each item (e.g. "Çarşaf takımı × 2")
                and ticks it off; persisted to the task. */}
            {t.checklist && t.checklist.items.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {t.checklist.items.map((c, i) => (
                  <li key={i}>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0"
                        checked={c.done}
                        disabled={busyId === t.id}
                        onChange={() => toggleChecklistItem(t.id, t.checklist!.items, i)}
                      />
                      <span className={cn(c.done && "text-muted-foreground line-through")}>{c.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}

            {/* Latest photo thumbnail */}
            {t.latestPhotoUrl ? (
              <a href={t.latestPhotoUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={t.latestPhotoUrl}
                  alt="Görev fotoğrafı"
                  className="h-20 w-full rounded-md border border-border object-cover"
                />
              </a>
            ) : null}

            {/* Note input */}
            <textarea
              placeholder="Not ekle…"
              aria-label={`Görev notu: ${t.title}`}
              value={noteMap[t.id] ?? ""}
              onChange={(e) => {
                setNoteValue(t.id, e.target.value);
                // Yazmaya başlayınca "Kaydedildi" kalkar (zamanlayıcı YOK).
                setNoteStatus((prev) => (prev[t.id] ? { ...prev, [t.id]: undefined } : prev));
              }}
              onBlur={() => saveNote(t.id)} // güvenlik ağı: düğmeye basmayı unutan kaybetmesin
              rows={2}
              className={cn(
                "mt-2 w-full resize-none rounded border border-border bg-muted/30 px-2 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring",
              )}
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              {/* Durum GÖRÜNÜR: kullanıcı notun gidip gitmediğini artık biliyor. */}
              <span aria-live="polite" className="text-[11px] text-muted-foreground">
                {noteStatus[t.id] === "saving"
                  ? "Kaydediliyor…"
                  : noteStatus[t.id] === "saved"
                    ? "Kaydedildi"
                    : ""}
              </span>
              <button
                type="button"
                onClick={() => saveNote(t.id)}
                disabled={!noteMap[t.id]?.trim() || noteStatus[t.id] === "saving"}
                className="rounded border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
              >
                Notu kaydet
              </button>
            </div>
            {noteError[t.id] ? (
              <p className="mt-1 text-xs text-destructive">{noteError[t.id]}</p>
            ) : null}

            {/* Photo upload — only for cleaning tasks (proof of cleaning); never check-in prep */}
            {t.type === "cleaning" ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  ref={(el) => { fileInputRefs.current[t.id] = el; }}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => handlePhotoChange(t.id, e)}
                />
                <button
                  type="button"
                  disabled={uploadingId === t.id}
                  onClick={() => fileInputRefs.current[t.id]?.click()}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  {uploadingId === t.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Camera className="size-3" />
                  )}
                  Temizlik fotoğrafı ekle
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ONE control row: time-window filters left, cleaning-share right —
          stacked full-width rows piled up a tall header before the board. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {timeFilters.map((f) => {
            const count = tasks.filter((t) => inWindow(t, f.value)).length;
            const active = timeRange === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setTimeRange(f.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-accent",
                )}
              >
                {f.label} <span className="opacity-70">({count})</span>
              </button>
            );
          })}
        </div>
        {/* Share the cleaning list over WhatsApp / copy — the cleaner doesn't log in */}
        {cleaningTasks.length > 0 ? (
          <button
            type="button"
            onClick={() => setShareOpen((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground hover:bg-accent"
          >
            <Share2 className="size-3.5" /> Temizlik listesini paylaş ({cleaningTasks.length})
          </button>
        ) : null}
      </div>

      {cleaningTasks.length > 0 && shareOpen ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">
                {shareText}
              </pre>
              <div className="flex flex-wrap gap-2">
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  WhatsApp&apos;ta paylaş
                </a>
                <button
                  type="button"
                  onClick={copyList}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
                >
                  {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                  {copied ? "Kopyalandı" : "Kopyala"}
                </button>
              </div>
          <p className="text-[11px] text-muted-foreground">
            Liste yukarıdaki filtreye göre oluşur (ör. “Bu hafta”). Temizlikçine WhatsApp&apos;tan
            gönder ya da kopyalayıp yapıştır.
          </p>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Bu filtrede görev yok.</p>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          {COLUMNS.map((col) => {
            const colTasks = visible.filter((t) => columnOf(t.status) === col.key);
            return (
              <div key={col.key} className="min-w-0 rounded-xl border border-border bg-muted/20 p-3">
                <div className="mb-3 flex items-center gap-2 px-1">
                  <span className={cn("size-2.5 rounded-full", col.dot)} aria-hidden="true" />
                  <h3 className="text-sm font-semibold">{col.label}</h3>
                  <span className="ml-auto rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {colTasks.length}
                  </span>
                </div>
                <div className="space-y-3 lg:max-h-[68vh] lg:overflow-y-auto lg:pr-0.5">
                  {colTasks.length === 0 ? (
                    <p className="py-8 text-center text-xs text-muted-foreground/70">Görev yok</p>
                  ) : (
                    colTasks.map((t) => renderCard(t))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
