"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/**
 * Operatör: işletme belgesi kuyruğu (Faz 1a). Resmî kaydı operatör AÇAR (bağlantılar yalnız katalogdaki resmî adresler), gördüğü alanları
 * KOPYALAR; eşleşmeyi kod hesaplar. Hak sahipliği kanıtı Lixus'a yüklenmez — operatör dışarıda inceler, yöntem + kısa kayıt yazar.
 */

type Reading = {
  source: string;
  query: string;
  outcome: string;
  fields: Record<string, string>;
  match: { number: boolean; legalName: boolean };
  note?: string;
};
type Proof = { method: string; evidenceRef: string; taxIdConfirmed: boolean };
type Row = {
  id: string;
  organizationName: string;
  typeLabel: string;
  type: string;
  number: string;
  status: string;
  attributes: Record<string, unknown>;
  holder: { kind: string; legalName: string; taxIdMasked: string; verifiedElsewhere: boolean };
  unitCount: number;
  sources: { id: string; label: string; url: string }[];
  lastReading: { at: string; value: Reading } | null;
  lastProof: { at: string; value: Proof } | null;
  lastRegistryOkAt: string | null;
  createdAt: string;
};

const OUTCOMES: Record<string, string> = { valid: "Bulundu — geçerli", cancelled: "Bulundu — iptal / askı", not_found: "Bulunamadı", unreadable: "Okunamadı" };
const METHODS: Record<string, string> = {
  esign_declaration: "Yetkilinin e-imzalı beyanı",
  document_set: "İmza sirküleri + vergi levhası + MERSİS",
  registry_contact: "Resmî kayıttaki adres onayladı",
  registered_domain: "Kayıtlı alan adı (DNS) — tek başına yetmez",
};
const MISSING: Record<string, string> = {
  reading: "kayıt okuması yok",
  reading_stale: "okuma 7 günden eski",
  reading_not_valid: "son okuma 'geçerli' değil",
  number_mismatch: "numara eşleşmiyor",
  name_mismatch: "unvan eşleşmiyor (gerekçe yazın)",
  proof: "hak sahipliği kanıtı yok",
  proof_weak: "kanıt yöntemi tek başına yetmez",
  tax_unconfirmed: "vergi numarası teyit edilmedi",
};
const REJECT: Record<string, string> = { not_found: "Kayıtta yok", mismatch: "Uyuşmazlık", no_authority: "Temsil yetkisi yok", other: "Diğer" };
const SUSPEND: Record<string, string> = { registry_cancelled: "Kayıtta iptal", not_found: "Kayıtta bulunamıyor", mismatch: "Uyuşmazlık", operator: "Operatör" };

async function post(url: string, body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

function RowCard({ row, onChanged }: { row: Row; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [source, setSource] = useState(row.sources[0]?.id ?? "");
  const [query, setQuery] = useState(row.number);
  const [outcome, setOutcome] = useState("valid");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [method, setMethod] = useState("esign_declaration");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [taxIdConfirmed, setTaxIdConfirmed] = useState(false);
  const [nameOverride, setNameOverride] = useState("");
  const [reason, setReason] = useState("other");
  const [suspendReason, setSuspendReason] = useState("operator");
  const isAgency = row.type === "agency";

  async function run(fn: () => Promise<{ ok: boolean; body: Record<string, unknown> }>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (r.ok) {
        setMsg(okText);
        await onChanged();
      } else {
        const missing = Array.isArray(r.body.missing) ? (r.body.missing as string[]).map((m) => MISSING[m] ?? m).join(", ") : "";
        const fieldErr = r.body.fields ? Object.keys(r.body.fields as object).join(", ") : "";
        setMsg([String(r.body.error ?? "Hata"), missing, fieldErr].filter(Boolean).join(" — "));
      }
    } catch {
      setMsg("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  const setField = (k: string, v: string) => setFields((f) => ({ ...f, [k]: v }));
  const found = outcome === "valid" || outcome === "cancelled";
  const base = `/api/admin/licenses/${encodeURIComponent(row.id)}`;

  return (
    <li className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <span className="font-medium">
          {row.organizationName} · {row.typeLabel}
          {isAgency && typeof row.attributes.group === "string" ? ` (beyan: ${row.attributes.group})` : ""} · {row.number}
        </span>
        <span className="rounded bg-muted px-2 py-0.5 text-xs">{row.status}</span>
      </div>
      <div className="text-muted-foreground">
        {row.holder.legalName} · {row.holder.taxIdMasked} · {row.unitCount} daire · başvuru {new Date(row.createdAt).toLocaleDateString("tr-TR")}
        {row.lastRegistryOkAt ? ` · son eşleşme ${new Date(row.lastRegistryOkAt).toLocaleDateString("tr-TR")}` : ""}
      </div>
      {row.holder.verifiedElsewhere && <div className="font-medium text-destructive">Bu şirket başka bir hesapta doğrulanmış.</div>}
      <div className="flex flex-wrap gap-3">
        {row.sources.map((s) => (
          <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
            {s.label}
          </a>
        ))}
      </div>
      {row.lastReading && (
        <div className="text-xs">
          Son okuma ({new Date(row.lastReading.at).toLocaleString("tr-TR")}): {OUTCOMES[row.lastReading.value.outcome] ?? row.lastReading.value.outcome} · numara{" "}
          {row.lastReading.value.match.number ? "eşleşti" : "EŞLEŞMEDİ"} · unvan {row.lastReading.value.match.legalName ? "eşleşti" : "EŞLEŞMEDİ"}
          {row.lastReading.value.fields.legalName ? ` · kayıttaki unvan: ${row.lastReading.value.fields.legalName}` : ""}
          {row.lastReading.value.fields.group ? ` · grup ${row.lastReading.value.fields.group}` : ""}
        </div>
      )}
      {row.lastProof && (
        <div className="text-xs">
          Son kanıt: {METHODS[row.lastProof.value.method] ?? row.lastProof.value.method} · vergi no {row.lastProof.value.taxIdConfirmed ? "teyitli" : "TEYİTSİZ"} ·{" "}
          {row.lastProof.value.evidenceRef}
        </div>
      )}

      <details>
        <summary className="cursor-pointer">Kayıt okuması yaz</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Kaynak">
            {row.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Sorgulanan numara" placeholder="Sorgulanan numara" />
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Sonuç">
            {Object.entries(OUTCOMES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          {found && <Input placeholder="Kayıttaki ticari unvan (kopyalayın)" value={fields.legalName ?? ""} onChange={(e) => setField("legalName", e.target.value)} />}
          {found && isAgency && <Input placeholder="Acenta unvanı" value={fields.agencyName ?? ""} onChange={(e) => setField("agencyName", e.target.value)} />}
          {found && isAgency && <Input placeholder="Grup (A / B / C)" maxLength={1} value={fields.group ?? ""} onChange={(e) => setField("group", e.target.value.toUpperCase())} />}
          {found && !isAgency && <Input placeholder="Tesis türü" value={fields.facilityType ?? ""} onChange={(e) => setField("facilityType", e.target.value)} />}
          {found && !isAgency && <Input placeholder="Sınıf" value={fields.starClass ?? ""} onChange={(e) => setField("starClass", e.target.value)} />}
          {found && <Input placeholder="Belge durumu (kayıttaki)" value={fields.statusText ?? ""} onChange={(e) => setField("statusText", e.target.value)} />}
          <Input placeholder="Not" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button
          type="button"
          size="sm"
          className="mt-2"
          disabled={busy}
          onClick={() =>
            void run(() => post(`${base}/reading`, { source, query, outcome, fields: found ? Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim())) : {}, note }), "Okuma kaydedildi.")
          }
        >
          Okumayı kaydet
        </Button>
      </details>

      <details>
        <summary className="cursor-pointer">Hak sahipliği kanıtı yaz</summary>
        <div className="mt-2 grid gap-2">
          <Select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Yöntem">
            {Object.entries(METHODS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Input placeholder="Kısa kayıt (ör. TSG ilanı, imza tarihi) — belge yüklenmez" value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={taxIdConfirmed} onChange={(e) => setTaxIdConfirmed(e.target.checked)} /> Vergi numarası belgelerle eşleşiyor
          </label>
        </div>
        <Button type="button" size="sm" className="mt-2" disabled={busy} onClick={() => void run(() => post(`${base}/proof`, { method, evidenceRef, taxIdConfirmed }), "Kanıt kaydedildi.")}>
          Kanıtı kaydet
        </Button>
      </details>

      <details>
        <summary className="cursor-pointer">Karar</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input className="max-w-sm" placeholder="Unvan farklıysa gerekçe (en az 10 karakter)" value={nameOverride} onChange={(e) => setNameOverride(e.target.value)} />
          <Button type="button" size="sm" disabled={busy} onClick={() => void run(() => post(`${base}/decision`, { action: "approve", nameOverride: nameOverride || undefined }), "Onaylandı.")}>
            Onayla
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => post(`${base}/decision`, { action: "review" }), "İncelemeye alındı.")}>
            İncelemeye al
          </Button>
          <Select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Ret sebebi">
            {Object.entries(REJECT).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => post(`${base}/decision`, { action: "reject", reason }), "Reddedildi.")}>
            Reddet
          </Button>
          <Select value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} aria-label="Askı sebebi">
            {Object.entries(SUSPEND).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => post(`${base}/decision`, { action: "suspend", reason: suspendReason }), "Askıya alındı.")}>
            Askıya al
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => post(`${base}/decision`, { action: "reinstate" }), "Askıdan döndü.")}>
            Askıdan döndür
          </Button>
        </div>
      </details>
      {msg && <p role="status">{msg}</p>}
    </li>
  );
}

export function LicenseQueue() {
  const [data, setData] = useState<{ open: Row[]; recheck: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/licenses", { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 404 ? "Özellik kapalı (BUSINESS_LICENSES_ENABLED / LICENSE_HMAC_SECRET)." : `Hata ${res.status}`);
        return;
      }
      setData(await res.json());
    } catch {
      setError("Bağlantı hatası.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Yükleniyor" />;
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Açık başvurular ({data.open.length})</h2>
        {data.open.length === 0 ? <p className="text-sm text-muted-foreground">Bekleyen başvuru yok.</p> : <ul className="space-y-3">{data.open.map((r) => <RowCard key={r.id} row={r} onChanged={load} />)}</ul>}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Yeniden okunacak doğrulanmış belgeler ({data.recheck.length})</h2>
        {data.recheck.length === 0 ? <p className="text-sm text-muted-foreground">Yok.</p> : <ul className="space-y-3">{data.recheck.map((r) => <RowCard key={r.id} row={r} onChanged={load} />)}</ul>}
      </section>
    </div>
  );
}
