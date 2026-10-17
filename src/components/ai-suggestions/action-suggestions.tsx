"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COMMITMENT_TOPIC_LABELS, isCommitmentTopic } from "@/lib/guest-commitments-core";

// Yapay zekâ EYLEM ÖNERİLERİ (⑤ ilk dilim, kurucu 10-12: "öner + tek tıkla onay"). Yalnız sahip / yönetici görür; misafire hiçbir şey
// gitmez. Söz önerisinde gün / saat onaydan önce değiştirilebilir. Görünen metin sade (teknik terim yok).
export interface ActionSuggestionItem {
  key: string;
  kind: "task" | "kb_wifi" | "commitment";
  title: string;
  detail: string;
  evidenceAt: string;
  proposal: Record<string, unknown>;
}

export function ActionSuggestions({ items }: { items: ActionSuggestionItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { day: string; time: string }>>({});
  // Söz önerisi mevcut söze bağlandıysa kısa bilgi (öneri listeden kalkınca da görünür — kurucu Q1 "a", 10-17).
  const [notice, setNotice] = useState<string | null>(null);
  if (items.length === 0 && !notice) return null;

  async function decide(item: ActionSuggestionItem, decision: "approve" | "dismiss") {
    setBusy(item.key);
    setError(null);
    setNotice(null);
    try {
      const edit = edits[item.key];
      const res = await fetch("/api/ai-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: item.key, decision, ...(edit ? { day: edit.day, time: edit.time } : {}) }),
      });
      if (res.status === 409) {
        startTransition(() => router.refresh()); // öneri artık geçerli değil / başkası karar verdi
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { fields?: Record<string, string> } | null;
        setError(body?.fields ? Object.values(body.fields)[0] : "İşlem yapılamadı. Tekrar deneyin.");
        return;
      }
      const done = (await res.json().catch(() => null)) as { created?: { merged?: boolean; topicAttached?: boolean } } | null;
      if (done?.created?.merged) {
        const topic = (item.proposal as { topic?: unknown }).topic;
        setNotice(
          done.created.topicAttached && isCommitmentTopic(topic)
            ? `Aynı saatte kaydettiğiniz söze bağlandı (${COMMITMENT_TOPIC_LABELS[topic]}); yeni görev açılmadı.`
            : "Aynı saatte kaydettiğiniz söze bağlandı; yeni görev açılmadı.",
        );
      }
      startTransition(() => router.refresh());
    } catch {
      setError("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2" data-testid="action-suggestions">
      {items.map((s) => {
        const p = s.proposal as { day?: string; time?: string };
        const edit = edits[s.key] ?? (s.kind === "commitment" ? { day: p.day ?? "today", time: p.time ?? "" } : undefined);
        return (
          <div key={s.key} className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 size-4 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">{s.title}</p>
                <p className="text-xs opacity-80">{s.detail}</p>
              </div>
            </div>
            {s.kind === "commitment" && edit ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <select
                  aria-label="Gün"
                  className="rounded border bg-background px-1.5 py-1"
                  value={edit.day}
                  onChange={(e) => setEdits({ ...edits, [s.key]: { ...edit, day: e.target.value } })}
                >
                  <option value="today">Bugün</option>
                  <option value="tomorrow">Yarın</option>
                </select>
                <input
                  aria-label="Saat"
                  type="time"
                  className="rounded border bg-background px-1.5 py-1"
                  value={edit.time}
                  onChange={(e) => setEdits({ ...edits, [s.key]: { ...edit, time: e.target.value } })}
                />
              </div>
            ) : null}
            <div className="mt-2 flex gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => decide(s, "approve")}>
                Onayla
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => decide(s, "dismiss")}>
                Yok say
              </Button>
            </div>
          </div>
        );
      })}
      {notice ? (
        <p role="status" className="text-xs text-muted-foreground" data-testid="action-suggestion-notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
