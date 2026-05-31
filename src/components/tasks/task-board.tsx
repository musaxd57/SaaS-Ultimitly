"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, User, Clock, CheckSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { TASK_STATUS, TASK_TYPE, PRIORITY } from "@/lib/constants";

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
}

export function TaskBoard({ tasks }: { tasks: TaskCardData[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

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
