"use client";

import { useRef, useState, useTransition } from "react";
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
  checklist: { done: number; total: number } | null;
  latestPhotoUrl?: string | null;
  latestNote?: string | null;
}

export function TaskBoard({ tasks }: { tasks: TaskCardData[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [noteMap, setNoteMap] = useState<Record<string, string>>({});
  const [noteError, setNoteError] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Cards are compact by default (note input + photo hidden) so 50+ tasks don't
  // become an endless scroll; tap "Not / fotoğraf" to reveal the editors.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Filter by status (default: all) — cards render in a wide responsive grid so
  // 50+ tasks flow left-to-right instead of stacking into one endless column.
  const [statusFilter, setStatusFilter] = useState<string>("");
  // Time window — default "this week" so far-future tasks don't all dump in.
  const [timeRange, setTimeRange] = useState<"today" | "week" | "month" | "all">("week");
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
        window.alert(res.status === 403 ? "Bu işlem için yetkiniz yok." : "Görev durumu güncellenemedi.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      window.alert("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Bu görevi silmek istediğinize emin misiniz?")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        window.alert(res.status === 403 ? "Görev silme yetkiniz yok (yalnızca yönetici)." : "Görev silinemedi.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      window.alert("Bağlantı hatası. Lütfen tekrar deneyin.");
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
      const uploadRes = await fetch("/api/upload", { method: "POST", body: fd });
      if (!uploadRes.ok) {
        window.alert("Fotoğraf yüklenemedi.");
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
        window.alert("Fotoğraf kaydedilemedi, tekrar deneyin.");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setUploadingId(null);
      if (fileInputRefs.current[id]) fileInputRefs.current[id]!.value = "";
    }
  }

  async function handleNoteBlur(id: string) {
    const note = noteMap[id];
    if (!note?.trim()) return;
    setNoteError((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        // Keep the typed note so it isn't lost; tell the user it didn't save.
        setNoteError((prev) => ({ ...prev, [id]: "Not kaydedilemedi, tekrar deneyin." }));
        return;
      }
      setNoteMap((prev) => ({ ...prev, [id]: "" }));
      startTransition(() => router.refresh());
    } catch {
      setNoteError((prev) => ({ ...prev, [id]: "Bağlantı hatası, not kaydedilemedi." }));
    }
  }

  const statusFilters = [{ value: "", label: "Tümü" }, ...TASK_STATUS.options];
  const timeFilters: { value: "today" | "week" | "month" | "all"; label: string }[] = [
    { value: "today", label: "Bugün" },
    { value: "week", label: "Bu hafta" },
    { value: "month", label: "Bu ay" },
    { value: "all", label: "Tümü" },
  ];
  const rangeMatch = (d: number | null | undefined, range: typeof timeRange) => {
    if (d == null) return true; // no due date → always show
    if (range === "today") return d <= 0; // today + overdue
    if (range === "week") return d <= 7;
    if (range === "month") return d <= 31;
    return true;
  };
  const visible = tasks.filter(
    (t) => (!statusFilter || t.status === statusFilter) && rangeMatch(t.dueDays, timeRange),
  );

  // Shareable cleaning list (the cleaner doesn't log in — the host sends this over
  // WhatsApp / copies it). Built from the CLEANING tasks in the current filter view.
  const cleaningTasks = visible.filter((t) => t.type === "cleaning");
  const shareText =
    "🧹 Temizlik Listesi\n\n" +
    (cleaningTasks.length === 0
      ? "(seçili aralıkta temizlik yok)"
      : cleaningTasks
          .map((t) => `• ${t.dueLabel ?? ""} — ${t.propertyName} — ${t.title}`)
          .join("\n"));
  const waLink = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  async function copyList() {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert("Kopyalanamadı. Listeyi elle seçip kopyalayabilirsiniz.");
    }
  }

  return (
    <div className="space-y-3">
      {/* Time window — so far-future tasks (e.g. August arrivals) don't all dump in */}
      <div className="flex flex-wrap gap-2">
        {timeFilters.map((f) => {
          const count = tasks.filter(
            (t) => (!statusFilter || t.status === statusFilter) && rangeMatch(t.dueDays, f.value),
          ).length;
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

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {statusFilters.map((f) => {
          const count = tasks.filter(
            (t) => (!f.value || t.status === f.value) && rangeMatch(t.dueDays, timeRange),
          ).length;
          const active = statusFilter === f.value;
          return (
            <button
              key={f.value || "all"}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
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
        <div>
          <button
            type="button"
            onClick={() => setShareOpen((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground hover:bg-accent"
          >
            <Share2 className="size-3.5" /> Temizlik listesini paylaş ({cleaningTasks.length})
          </button>
          {shareOpen ? (
            <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
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
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Bu filtrede görev yok.</p>
      ) : (
        <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((t) => (
                  <div key={t.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">{t.title}</p>
                      <button
                        type="button"
                        onClick={() => remove(t.id)}
                        disabled={busyId === t.id}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        aria-label="Sil"
                      >
                        {busyId === t.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone={TASK_TYPE.tone(t.type)}>{TASK_TYPE.label(t.type)}</Badge>
                      {/* Only flag priority when it's urgent — 'Standart' is just noise on 50+ cards */}
                      {t.priority === "urgent" ? (
                        <Badge tone={PRIORITY.tone(t.priority)}>{PRIORITY.label(t.priority)}</Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      <p>{t.propertyName}</p>
                      {t.assigneeName ? (
                        <p className="flex items-center gap-1">
                          <User className="size-3" /> {t.assigneeName}
                        </p>
                      ) : null}
                      {t.dueLabel ? (
                        <p className="flex items-center gap-1">
                          <Clock className="size-3" /> {t.dueLabel}
                        </p>
                      ) : null}
                      {t.checklist ? (
                        <p className="flex items-center gap-1">
                          <CheckSquare className="size-3" /> {t.checklist.done}/{t.checklist.total}
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

                    {/* Status — always visible for a one-tap change */}
                    <Select
                      value={t.status}
                      disabled={busyId === t.id}
                      onChange={(e) => setStatus(t.id, e.target.value)}
                      className="mt-2 h-8 text-xs"
                    >
                      {TASK_STATUS.options.map((o) => (
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
                          {t.latestPhotoUrl ? " 📷" : ""}
                        </>
                      )}
                    </button>

                    {expanded.has(t.id) ? (
                      <>
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
                          placeholder="Not ekle… (kaydetmek için kutudan çıkın)"
                          value={noteMap[t.id] ?? ""}
                          onChange={(e) => setNoteMap((prev) => ({ ...prev, [t.id]: e.target.value }))}
                          onBlur={() => handleNoteBlur(t.id)}
                          rows={2}
                          className={cn(
                            "mt-2 w-full resize-none rounded border border-border bg-muted/30 px-2 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring",
                          )}
                        />
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
          ))}
        </div>
      )}
    </div>
  );
}
