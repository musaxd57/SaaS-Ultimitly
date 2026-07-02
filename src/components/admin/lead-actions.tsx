"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";

// Mini sales-pipeline controls for one lead row in the operator panel:
// status select + follow-up date + note, saved via PATCH /api/admin/leads/[id].

const STATUS_OPTIONS = [
  { value: "new", label: "Yeni" },
  { value: "contacted", label: "Arandı" },
  { value: "demo", label: "Demo verildi" },
  { value: "won", label: "Kazanıldı" },
  { value: "lost", label: "Kaybedildi" },
];

const STATUS_STYLE: Record<string, string> = {
  new: "bg-blue-50 text-blue-700",
  contacted: "bg-amber-50 text-amber-700",
  demo: "bg-violet-50 text-violet-700",
  won: "bg-emerald-50 text-emerald-700",
  lost: "bg-zinc-100 text-zinc-500",
};

export function LeadActions({
  leadId,
  status,
  note,
  followUpAt,
}: {
  leadId: string;
  status: string;
  note: string | null;
  followUpAt: string | null; // yyyy-MM-dd or null (pre-formatted by the server page)
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState({ status, note: note ?? "", followUpAt: followUpAt ?? "" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: form.status,
          note: form.note.trim() || null,
          followUpAt: form.followUpAt || null,
        }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      setDirty(false);
      setSaved(true);
      startTransition(() => router.refresh());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={form.status}
        onChange={(e) => set("status", e.target.value)}
        aria-label="Durum"
        className={`h-7 rounded-md border-0 px-1.5 text-xs font-medium ${STATUS_STYLE[form.status] ?? "bg-muted"}`}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={form.followUpAt}
        onChange={(e) => set("followUpAt", e.target.value)}
        aria-label="Takip tarihi"
        title="Takip tarihi"
        className="h-7 rounded-md border border-border bg-card px-1.5 text-xs"
      />
      <input
        type="text"
        value={form.note}
        onChange={(e) => set("note", e.target.value)}
        placeholder="Not…"
        aria-label="Not"
        className="h-7 w-36 rounded-md border border-border bg-card px-1.5 text-xs"
      />
      {dirty ? (
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          Kaydet
        </button>
      ) : saved ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
          <Check className="size-3" /> Kaydedildi
        </span>
      ) : null}
      {error ? <span className="text-xs text-destructive">Kaydedilemedi</span> : null}
    </div>
  );
}
