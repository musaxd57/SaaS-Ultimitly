"use client";

import { useState } from "react";
import { Loader2, Search, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/form-field";
import {
  AI_QUALITY_PURPOSES,
  AI_REVIEW_LABELS,
  AI_REVIEW_LABEL_NAMES,
  type AiQualityPurpose,
  type AiReviewLabelCode,
} from "@/lib/ai-quality/codes";

/**
 * Kurucu yapay zekâ kalite konsolu (salt-okuma + etiket). Her listeleme ve etiket sunucuda AMAÇLA kaydedilir; mesaj gönderilmez,
 * konuşma / müşteri verisi değişmez. Sözleşme `src/lib/ai-quality/console.ts`.
 */

interface OrgOption {
  id: string;
  name: string;
}

interface Generation {
  id: string;
  conversationId: string;
  surface: string;
  model: string;
  promptVersion: string;
  decision: string;
  gateReason: string | null;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  draftText: string | null;
  sentText: string | null;
  createdAt: string;
  labels: { id: string; label: AiReviewLabelCode; note: string | null; createdAt: string }[];
}

const DECISION_NAMES: Record<string, string> = {
  auto_sent: "Otomatik gönderildi",
  human_review: "Ev sahibine bırakıldı",
  no_reply: "Cevap yok",
};

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

export function AiQualityConsole({ orgs }: { orgs: OrgOption[] }) {
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [purpose, setPurpose] = useState<AiQualityPurpose | "">("");
  const [ticket, setTicket] = useState("");
  const [decision, setDecision] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Generation[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);

  async function load(before: string | null) {
    if (!purpose) {
      setError("İnceleme amacını seçin.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({ orgId, purpose, ...(ticket.trim() ? { ticket: ticket.trim() } : {}) });
      if (decision) q.set("decision", decision);
      if (before) q.set("before", before);
      const res = await fetch(`/api/admin/ai-quality?${q}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const fields = data.fields as Record<string, string> | undefined;
        setError((fields ? Object.values(fields)[0] : null) ?? data.error ?? "İzler yüklenemedi.");
        return;
      }
      setRows((prev) => (before && prev ? [...prev, ...(data.generations as Generation[])] : (data.generations as Generation[])));
      setNextBefore(data.nextBefore ?? null);
    } catch {
      setError("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  function onLabeled(generationId: string, label: Generation["labels"][number]) {
    setRows((prev) => prev?.map((g) => (g.id === generationId ? { ...g, labels: [...g.labels, label] } : g)) ?? prev);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Yapay zekânın her cevap kararı: modelin taslağı, misafire giden metin, kapının kararı ve gerekçesi. Salt-okuma — hiçbir mesaj
        gönderilmez, hiçbir konuşma değişmez. Her listeleme ve etiket seçtiğiniz amaçla kayda girer.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="İşletme" htmlFor="aq-org" className="min-w-[200px]">
          <select id="aq-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} className={selectClass}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amaç" htmlFor="aq-purpose" className="min-w-[180px]">
          <select id="aq-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value as AiQualityPurpose | "")} className={selectClass}>
            <option value="">Seçin…</option>
            {(Object.keys(AI_QUALITY_PURPOSES) as AiQualityPurpose[]).map((p) => (
              <option key={p} value={p}>
                {AI_QUALITY_PURPOSES[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Talep no (isteğe bağlı)" htmlFor="aq-ticket" className="w-[160px]">
          <input id="aq-ticket" value={ticket} onChange={(e) => setTicket(e.target.value)} className={selectClass} maxLength={40} />
        </Field>
        <Field label="Karar" htmlFor="aq-decision" className="min-w-[170px]">
          <select id="aq-decision" value={decision} onChange={(e) => setDecision(e.target.value)} className={selectClass}>
            <option value="">Hepsi</option>
            {Object.entries(DECISION_NAMES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Button type="button" variant="outline" onClick={() => load(null)} disabled={busy || !orgId}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          İzleri göster
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {rows && rows.length === 0 ? <p className="text-sm text-muted-foreground">Bu işletme için kayıtlı iz yok.</p> : null}

      {rows?.map((g) => (
        <GenerationCard key={g.id} g={g} orgId={orgId} purpose={purpose} ticket={ticket} onLabeled={onLabeled} />
      ))}

      {nextBefore ? (
        <Button type="button" variant="ghost" onClick={() => load(nextBefore)} disabled={busy}>
          Daha eski izler
        </Button>
      ) : null}
    </div>
  );
}

function GenerationCard({
  g,
  orgId,
  purpose,
  ticket,
  onLabeled,
}: {
  g: Generation;
  orgId: string;
  purpose: AiQualityPurpose | "";
  ticket: string;
  onLabeled: (id: string, l: Generation["labels"][number]) => void;
}) {
  const [label, setLabel] = useState<AiReviewLabelCode>("correct");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-quality/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, generationId: g.id, label, note: note.trim() || null, purpose, ...(ticket.trim() ? { ticket: ticket.trim() } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const fields = data.fields as Record<string, string> | undefined;
        setError((fields ? Object.values(fields)[0] : null) ?? data.error ?? "Etiket kaydedilemedi.");
        return;
      }
      onLabeled(g.id, data.label);
      setNote("");
    } catch {
      setError("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{new Date(g.createdAt).toLocaleString("tr-TR")}</span>
        <span className="font-medium text-foreground">{DECISION_NAMES[g.decision] ?? g.decision}</span>
        {g.gateReason ? <span>gerekçe: {g.gateReason}</span> : null}
        <span>
          {g.model} · istem {g.promptVersion}
        </span>
        {g.latencyMs !== null ? <span>{g.latencyMs} ms</span> : null}
        {g.promptTokens !== null ? (
          <span>
            {g.promptTokens}+{g.completionTokens ?? 0} token{g.reasoningTokens ? ` (düşünme ${g.reasoningTokens})` : ""}
          </span>
        ) : null}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <div className="text-xs font-medium text-muted-foreground">Modelin taslağı</div>
          <p className="whitespace-pre-wrap">{g.draftText ?? "— (saklama süresi doldu ya da yok)"}</p>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground">Misafire giden</div>
          <p className="whitespace-pre-wrap">{g.sentText ?? "— (gönderilmedi)"}</p>
        </div>
      </div>
      {g.labels.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {g.labels.map((l) => (
            <li key={l.id} className="rounded bg-muted px-2 py-0.5 text-xs" title={l.note ?? undefined}>
              {AI_REVIEW_LABEL_NAMES[l.label] ?? l.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <select value={label} onChange={(e) => setLabel(e.target.value as AiReviewLabelCode)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
          {AI_REVIEW_LABELS.map((l) => (
            <option key={l} value={l}>
              {AI_REVIEW_LABEL_NAMES[l]}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Not (isteğe bağlı)"
          maxLength={1000}
          className="h-8 min-w-[200px] flex-1 rounded-md border border-input bg-background px-2 text-xs"
        />
        <Button type="button" size="sm" variant="outline" onClick={save} disabled={busy || !purpose}>
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Tag className="size-3" />}
          Etiketle
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
