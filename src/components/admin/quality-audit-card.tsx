"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/form-field";

/**
 * Claude kalite üst-denetçisi (gölge) tetikleyicisi. SALT-OKUMA: sonuç yalnız
 * bu ekranda gösterilen bir rapordur — mesaj gönderilmez, prompt değişmez;
 * öneriler ancak insan onayıyla koda işlenir. API anahtarı yoksa kart pasiftir.
 */

interface OrgOption {
  id: string;
  name: string;
}

interface Finding {
  messageId: string;
  severity: "low" | "medium" | "high";
  criterion: "uslup" | "risk" | "dil" | "dogruluk" | "diger";
  issue: string;
  suggestion: string | null;
}

interface AuditResult {
  organizationName: string;
  sampleSize: number;
  days: number;
  model: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  overall: string;
  findings: Finding[];
  promptSuggestions: string[];
  testSuggestions: string[];
}

const SEVERITY_CLASS: Record<Finding["severity"], string> = {
  high: "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-muted text-muted-foreground",
};

const CRITERION_LABEL: Record<Finding["criterion"], string> = {
  uslup: "Üslup",
  risk: "Risk",
  dil: "Dil",
  dogruluk: "Doğruluk",
  diger: "Diğer",
};

export function QualityAuditCard({
  orgs,
  defaultOrgId,
  configured,
}: {
  orgs: OrgOption[];
  defaultOrgId: string;
  configured: boolean;
}) {
  const [orgId, setOrgId] = useState(defaultOrgId || orgs[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/quality-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult(data as AuditResult);
      } else {
        const fields = data.fields as Record<string, string> | undefined;
        setError(
          (fields ? Object.values(fields)[0] : null) ?? data.error ?? "Denetim çalıştırılamadı.",
        );
      }
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Seçilen işletmenin son 7 günde <strong>gönderilmiş</strong> AI yanıtlarını Claude&apos;a
        değerlendirtir (üslup / risk / dil / doğruluk). Salt-okuma gölge denetim: hiçbir mesaj
        gönderilmez, hiçbir prompt değişmez — öneriler ancak insan onayıyla koda işlenir. Misafir
        adı, e-posta ve telefon Claude&apos;a gitmeden redakte edilir.
      </p>

      {!configured ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Pasif: Railway&apos;e <code className="font-mono text-xs">ANTHROPIC_API_KEY</code>{" "}
          eklendiğinde bu kart aktifleşir. (İsteğe bağlı{" "}
          <code className="font-mono text-xs">QUALITY_AUDIT_MODEL</code> ile model seçilebilir;
          varsayılan claude-opus-4-8.)
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="İşletme" htmlFor="qa-org" className="min-w-[220px]">
            <select
              id="qa-org"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <Button type="button" variant="outline" onClick={run} disabled={busy || !orgId}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {busy ? "Claude değerlendiriyor… (1-2 dk sürebilir)" : "Denetimi çalıştır"}
          </Button>
        </div>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {result ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-sm">
            <strong>{result.organizationName}</strong> · son {result.days} gün ·{" "}
            {result.sampleSize} yanıt incelendi
            {result.model ? (
              <span className="text-muted-foreground">
                {" "}
                · {result.model}
                {result.usage
                  ? ` · ${result.usage.inputTokens.toLocaleString("tr-TR")} giriş / ${result.usage.outputTokens.toLocaleString("tr-TR")} çıkış token`
                  : ""}
              </span>
            ) : null}
          </p>
          <p className="text-sm text-muted-foreground">{result.overall}</p>

          {result.findings.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {result.findings.map((f, i) => (
                <li key={`${f.messageId}-${i}`} className="space-y-1 px-3 py-2">
                  <p className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${SEVERITY_CLASS[f.severity]}`}
                    >
                      {f.severity === "high" ? "Yüksek" : f.severity === "medium" ? "Orta" : "Düşük"}
                    </span>
                    <span className="font-medium">{CRITERION_LABEL[f.criterion]}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{f.messageId}</span>
                  </p>
                  <p className="text-sm">{f.issue}</p>
                  {f.suggestion ? (
                    <p className="text-sm text-muted-foreground">Öneri: {f.suggestion}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : result.sampleSize > 0 ? (
            <p className="text-sm font-medium text-emerald-600">Bulgu yok — incelenen yanıtlar kurallara uygun.</p>
          ) : null}

          {result.promptSuggestions.length > 0 ? (
            <div>
              <p className="text-sm font-medium">Prompt önerileri (insan onayı gerekir)</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {result.promptSuggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.testSuggestions.length > 0 ? (
            <div>
              <p className="text-sm font-medium">Golden test önerileri</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {result.testSuggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
