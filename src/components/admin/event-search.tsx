"use client";

import { useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface EventRow {
  at: string;
  event: string;
  level: string;
  correlationId: string;
  organizationId: string | null;
  data: Record<string, unknown> | null;
}
interface ConsentRow {
  id: string;
  organizationId: string;
  planCode: string;
  at: string;
}

/**
 * TAKİP NUMARASIYLA OLAY ARAMA (kurucu kararı 10-10 §5). Müşteri hata ekranındaki numarayı ("7f3a91b2") paylaşır; operatör o işlemin
 * olaylarını sırayla görür ve gerekirse JSON olarak indirir. Uç: `api/admin/events` (süper-admin + 2FA, bürünmede yasak, her arama kayıtlı).
 */
export function EventSearch() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ events: EventRow[]; consents: ConsentRow[] } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/events?id=${encodeURIComponent(query.trim())}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setResult({ events: data.events ?? [], consents: data.consents ?? [] });
      else setError(data.fields?.id ?? data.fields?._ ?? data.error ?? "Arama yapılamadı.");
    } catch {
      setError("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!result) return;
    const blob = new Blob([JSON.stringify({ query: query.trim(), ...result }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lixus-olaylar-${query.trim().slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Takip numarası (ör. 7f3a91b2)"
          aria-label="Takip numarası"
          className="font-mono"
          maxLength={64}
        />
        <Button type="submit" disabled={busy || query.trim() === ""}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Ara
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {result.events.length} olay{result.consents.length > 0 ? ` · ${result.consents.length} ödeme onayı kaydı` : ""}
            </p>
            {(result.events.length > 0 || result.consents.length > 0) && (
              <Button type="button" variant="outline" size="sm" onClick={download}>
                <Download className="h-4 w-4" />
                JSON olarak indir
              </Button>
            )}
          </div>
          {result.consents.map((c) => (
            <p key={c.id} className="rounded border border-border bg-muted/40 p-2 font-mono text-xs">
              {c.at} · onay {c.id} · plan {c.planCode} · işletme {c.organizationId}
            </p>
          ))}
          {result.events.length > 0 ? (
            <ul className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
              {result.events.map((ev, i) => (
                <li key={`${ev.at}-${i}`} className={ev.level === "error" ? "text-destructive" : undefined}>
                  {ev.at} · {ev.event}
                  {ev.organizationId ? ` · işletme ${ev.organizationId}` : ""}
                  {ev.data ? ` · ${JSON.stringify(ev.data)}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Bu numarayla kayıtlı olay yok (90 günden eski kayıtlar silinir).</p>
          )}
        </div>
      )}
    </div>
  );
}
