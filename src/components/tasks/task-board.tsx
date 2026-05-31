"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, User, Clock, CheckSquare, Camera, FileText } from "lucide-react";
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
  checklist: { done: number; total: number } | null;
  latestPhotoUrl?: string | null;
  latestNote?: string | null;
}

export function TaskBoard({ tasks }: { tasks: TaskCardData[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [noteMap, setNoteMap] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function setStatus(id: string, status: string) {
    setBusyId(id);
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusyId(null);
    startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    if (!window.confirm("Bu görevi silmek istediğinize emin misiniz?")) return;
    setBusyId(id);
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    setBusyId(null);
    startTransition(() => router.refresh());
  }

  async function handlePhotoChange(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingId(id);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: fd });
      if (!uploadRes.ok) return;
      const { url } = await uploadRes.json();
      await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoUrl: url }),
      });
      startTransition(() => router.refresh());
    } finally {
      setUploadingId(null);
      if (fileInputRefs.current[id]) fileInputRefs.current[id]!.value = "";
    }
  }

  async function handleNoteBlur(id: string) {
    const note = noteMap[id];
    if (!note?.trim()) return;
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    setNoteMap((prev) => ({ ...prev, [id]: "" }));
    startTransition(() => router.refresh());
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {TASK_STATUS.options.map((col) => {
        const items = tasks.filter((t) => t.status === col.value);
        return (
          <div key={col.value} className="flex flex-col gap-3 rounded-xl bg-muted/40 p-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-sm font-semibold">{col.label}</span>
              <Badge tone="muted">{items.length}</Badge>
            </div>
            <div className="flex flex-col gap-2">
              {items.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">Görev yok</p>
              ) : (
                items.map((t) => (
                  <div key={t.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">{t.title}</p>
                      <button
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
                      <Badge tone={PRIORITY.tone(t.priority)}>{PRIORITY.label(t.priority)}</Badge>
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
                      placeholder="Not ekle... (kaydedmek için odaktan çık)"
                      value={noteMap[t.id] ?? ""}
                      onChange={(e) => setNoteMap((prev) => ({ ...prev, [t.id]: e.target.value }))}
                      onBlur={() => handleNoteBlur(t.id)}
                      rows={2}
                      className={cn(
                        "mt-2 w-full resize-none rounded border border-border bg-muted/30 px-2 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring",
                      )}
                    />

                    {/* Photo upload */}
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
                        Fotoğraf Ekle
                      </button>
                    </div>

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
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
