"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { KB_CATEGORY } from "@/lib/constants";
import { toast } from "@/lib/toast";

/**
 * GEÇMİŞTEN ÖĞREN (migration 65; anahtar `HISTORY_LEARN_ENABLED`). Ev sahibinin geçmiş cevaplarından bilgi tabanı TASLAĞI + mülke özgü
 * talimatlar. Taslak ev sahibi onaylamadan yapay zekâya GİTMEZ. İşaretli / çelişkili taslakta "Kontrol ettim" işaretlenmeden Onayla
 * kapalıdır (sunucu da `confirmFlags` ister). Müşteri metni sade (kurucu 09-23): ne olduğu + ne yapılacağı.
 */
type Flag = "payment" | "needs_edit" | "one_off" | "ungrounded" | "guest_name" | "sensitive" | "door_mention" | "outdated";
export const FLAG_TEXT: Record<Flag, string> = {
  payment: "Ödeme yöntemi geçiyor. Kontrol edin.",
  needs_edit: "Gizlenmiş bir bilgi var (telefon, kod ya da ad). Metni düzenleyin.",
  one_off: "Tek seferlik bir karar gibi görünüyor (indirim, geç çıkış vb.).",
  ungrounded: "Bir değer cevaplarınızda birebir bulunamadı. Doğruluğunu kontrol edin.",
  guest_name: "Bir misafir adı geçiyor olabilir.",
  sensitive: "Kişisel bilgi (telefon, e-posta, IBAN) geçiyor olabilir.",
  door_mention: "Kapı ya da kutu kodundan söz ediyor. Kodun kendisinin yazmadığından emin olun.",
  outdated: "Daha yeni bir cevabınız farklı. Bu bilgi eskimiş olabilir.",
};

interface Draft {
  id: string;
  category: string;
  title: string;
  content: string;
  supportConversations: number;
  newestMonth: string | null;
  oldestMonth: string | null;
  conflict: boolean;
  conflictNote: string | null;
  flags: Flag[];
}
interface Run {
  id: string;
  status: string;
  errorCode: string | null;
  pairCount: number;
  draftCount: number;
}
interface Instruction {
  id: string;
  content: string;
}

function runLine(run: Run | undefined): string | null {
  if (!run) return null;
  if (run.status === "queued" || run.status === "running") return "Geçmiş mesajlar okunuyor. Bu birkaç dakika sürebilir.";
  if (run.status === "failed") return "Okuma tamamlanamadı. Biraz sonra tekrar deneyin.";
  return `Son okuma: ${run.pairCount} soru okundu, ${run.draftCount} taslak çıktı.`;
}

function DraftCard({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const [title, setTitle] = useState(draft.title);
  const [content, setContent] = useState(draft.content);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sunucu düzenlenen metinde YENİ bir işaret bulursa (409 needsConfirm) kutu ve uyarılar onunla açılır — ev sahibi kilitlenmez.
  const [serverFlags, setServerFlags] = useState<Flag[]>([]);
  const flags = [...new Set([...draft.flags, ...serverFlags])];
  const needsCheck = flags.length > 0 || draft.conflict;

  async function act(action: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/history-learn/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "approve" ? { action, title, content, confirmFlags: checked } : { action }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string>; needsConfirm?: boolean; flags?: Flag[] };
        if (body.needsConfirm) {
          setServerFlags((body.flags ?? []).filter((f): f is Flag => f in FLAG_TEXT));
          setChecked(false);
        }
        setError(body.error ?? Object.values(body.fields ?? {})[0] ?? "İşlem yapılamadı. Tekrar deneyin.");
        return;
      }
      toast.success(action === "approve" ? "Bilgi tabanına eklendi." : "Taslak reddedildi.");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="history-learn-draft">
      <div className="flex items-center justify-between gap-2">
        <Badge tone={KB_CATEGORY.tone(draft.category)}>{KB_CATEGORY.label(draft.category)}</Badge>
        <span className="text-xs text-muted-foreground">
          {draft.supportConversations} konuşmada böyle cevaplamışsınız
          {draft.newestMonth ? ` · son ${draft.newestMonth}` : ""}
        </span>
      </div>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label="Başlık" disabled={busy} />
      <Textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={2000} rows={3} aria-label="İçerik" disabled={busy} />
      {draft.conflict ? (
        <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Cevaplarınız bu konuda farklı. {draft.conflictNote ?? ""}
        </p>
      ) : null}
      {flags.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800 dark:text-amber-300">
          {flags.map((f) => (
            <li key={f}>{FLAG_TEXT[f]}</li>
          ))}
        </ul>
      ) : null}
      {needsCheck ? (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={busy} />
          Kontrol ettim, bilgi doğru.
        </label>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => act("approve")} disabled={busy || (needsCheck && !checked)}>
          {busy ? <Loader2 className="animate-spin" /> : null} Onayla
        </Button>
        <Button size="sm" variant="outline" onClick={() => act("reject")} disabled={busy}>
          Reddet
        </Button>
      </div>
    </div>
  );
}

export function HistoryLearnPanel({ propertyId }: { propertyId: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [newInstruction, setNewInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch(`/api/properties/${propertyId}/history-learn`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/properties/${propertyId}/instructions`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (a) {
      setRuns(a.runs);
      setDrafts(a.drafts);
    }
    if (b) setInstructions(b.instructions);
    return a?.runs?.[0] as Run | undefined;
  }, [propertyId]);

  const poll = useCallback(async () => {
    const latest = await load();
    if (latest && (latest.status === "queued" || latest.status === "running")) timer.current = setTimeout(poll, 4000);
  }, [load]);

  useEffect(() => {
    void poll();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/properties/${propertyId}/history-learn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: 300 }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Başlatılamadı. Tekrar deneyin.");
        return;
      }
      await poll();
    } finally {
      setBusy(false);
    }
  }

  async function addInstruction() {
    setError(null);
    const res = await fetch(`/api/properties/${propertyId}/instructions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newInstruction }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
      setError(body.error ?? Object.values(body.fields ?? {})[0] ?? "Kaydedilemedi.");
      return;
    }
    setNewInstruction("");
    toast.success("Talimat eklendi.");
    void load();
  }

  async function removeInstruction(id: string) {
    const res = await fetch(`/api/properties/${propertyId}/instructions/${id}`, { method: "DELETE" });
    if (res.ok) void load();
  }

  const latest = runs[0];
  const running = latest?.status === "queued" || latest?.status === "running";
  return (
    <div className="space-y-4" data-testid="history-learn-panel">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Misafirlerin geçmişte sorduğu soruları ve sizin cevaplarınızı okur, bilgi tabanı için taslak hazırlar. Taslaklar siz onaylamadan
          kullanılmaz.
        </p>
        <Button size="sm" onClick={start} disabled={busy || running}>
          {busy || running ? <Loader2 className="animate-spin" /> : null} Geçmişi oku
        </Button>
        {runLine(latest) ? <p className="text-xs text-muted-foreground">{runLine(latest)}</p> : null}
      </div>
      {drafts.length ? (
        <div className="space-y-2">
          {drafts.map((d) => (
            <DraftCard key={d.id} draft={d} onDone={() => void load()} />
          ))}
        </div>
      ) : null}
      <div className="space-y-2">
        <p className="text-sm font-medium">Bu daire için talimatlar</p>
        <p className="text-xs text-muted-foreground">Yapay zekânın bu dairede nasıl cevap vermesini istediğinizi yazın. Güvenlik kuralları her zaman önce gelir.</p>
        {instructions.map((i) => (
          <div key={i.id} className="flex items-start justify-between gap-2 text-sm">
            <span>{i.content}</span>
            <Button size="sm" variant="ghost" onClick={() => removeInstruction(i.id)}>
              Kaldır
            </Button>
          </div>
        ))}
        <Textarea
          value={newInstruction}
          onChange={(e) => setNewInstruction(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Örnek: Erken giriş sorulursa temizliğin genelde 13:00'te bittiğini söyle."
          aria-label="Yeni talimat"
        />
        <Button size="sm" variant="outline" onClick={addInstruction} disabled={!newInstruction.trim()}>
          Talimat ekle
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
