"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LICENSE_TEXT } from "@/lib/licenses/messages";
import { LICENSE_TYPE_INFO, LICENSE_TYPES, AGENCY_GROUPS, HOLDER_KIND_LABEL, type LicenseType, type HolderKind } from "@/lib/licenses/catalog";

/**
 * Ayarlar › İşletme belgeleri (Faz 1a; tasarım docs/TASARIM-2026-11-06-isletme-belgesi-dogrulama-ve-yetki.md). YALNIZ işletme sahibine
 * çizilir; sunucu 404 derse (anahtar kapalı) kart HİÇ görünmez. Belge görüntüsü istenmez — numara, unvan ve vergi numarası yeter; resmî
 * kayıtla eşleştirmeyi ve yetkili teyidini ekibimiz yapar. Metinler sade (Ek B).
 */

type Row = {
  id: string;
  type: LicenseType;
  typeLabel: string;
  number: string;
  status: string;
  statusLabel: string;
  statusText: string | null;
  group: string | null;
  holder: { kind: string; legalName: string; taxIdMasked: string };
  units: { id: string; name: string }[];
  mark: { text: string; expiresAt: string } | null;
};
type Data = { planAllowed: boolean; twoFactor: boolean; licenses: Row[] };

const NETWORK = "İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.";
const WITHDRAWABLE = new Set(["pending", "under_review", "verified", "suspended"]);

export function LicensesCard({ properties }: { properties: { id: string; name: string }[] }) {
  const [data, setData] = useState<Data | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [type, setType] = useState<LicenseType>("agency");
  const [number, setNumber] = useState("");
  const [group, setGroup] = useState<string>("A");
  const [kind, setKind] = useState<HolderKind>("company");
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [units, setUnits] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/licenses", { cache: "no-store" });
      if (res.status === 404 || res.status === 403) {
        setHidden(true);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Data);
    } catch {
      setError(NETWORK);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (hidden) return null;

  const scope = LICENSE_TYPE_INFO[type].scope;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/licenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          number,
          attributes: type === "agency" ? { group } : {},
          holder: { kind, legalName, taxId },
          propertyIds: scope === "units" ? units : [],
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string; fields?: Record<string, string> };
      if (res.ok) {
        setNotice(body.message ?? LICENSE_TEXT.applicationReceived);
        setNumber("");
        setLegalName("");
        setTaxId("");
        setUnits([]);
        await load();
      } else {
        setError(body.fields ? Object.values(body.fields).join(" ") : (body.error ?? NETWORK));
      }
    } catch {
      setError(NETWORK);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string) {
    if (!window.confirm("Bu belgeyi geri çekmek istediğinize emin misiniz?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/licenses/${encodeURIComponent(id)}/withdraw`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) setError(body.error ?? NETWORK);
      else setNotice(body.message ?? LICENSE_TEXT.withdrawn);
      await load();
    } catch {
      setError(NETWORK);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">İşletme belgeleri</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Acenta ve konaklama belgelerinizi ekleyin. Belgeniz resmî kayıtla eşleşince burada ve ilgili dairenin sayfasında görünür.
        </p>
        {!data ? (
          error ? null : <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Yükleniyor" />
        ) : (
          <>
            {data.licenses.length > 0 && (
              <ul className="space-y-3">
                {data.licenses.map((l) => (
                  <li key={l.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {l.typeLabel}
                        {l.group ? ` (${l.group} grubu)` : ""} · {l.number}
                      </span>
                      <span className="rounded bg-muted px-2 py-0.5 text-xs">{l.statusLabel}</span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {l.holder.legalName} · {l.holder.taxIdMasked}
                      {l.units.length > 0 ? ` · ${l.units.map((u) => u.name).join(", ")}` : ""}
                    </div>
                    {l.mark && <div className="mt-1 text-emerald-700 dark:text-emerald-400">{l.mark.text}</div>}
                    {l.statusText && <div className="mt-1">{l.statusText}</div>}
                    {WITHDRAWABLE.has(l.status) && data.twoFactor && (
                      <Button type="button" variant="ghost" size="sm" className="mt-1 px-0" disabled={busy} onClick={() => void withdraw(l.id)}>
                        Geri çek
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!data.planAllowed ? (
              <p>{LICENSE_TEXT.planRequired}</p>
            ) : !data.twoFactor ? (
              <p>{LICENSE_TEXT.twoFactorRequired}</p>
            ) : (
              <form onSubmit={(e) => void submit(e)} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="lic-type">Belge türü</Label>
                    <Select id="lic-type" value={type} onChange={(e) => setType(e.target.value as LicenseType)}>
                      {LICENSE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {LICENSE_TYPE_INFO[t].label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="lic-number">Belge numarası</Label>
                    <Input id="lic-number" value={number} maxLength={60} onChange={(e) => setNumber(e.target.value)} required />
                  </div>
                  {type === "agency" && (
                    <div className="space-y-1">
                      <Label htmlFor="lic-group">Acenta grubu</Label>
                      <Select id="lic-group" value={group} onChange={(e) => setGroup(e.target.value)}>
                        {AGENCY_GROUPS.map((g) => (
                          <option key={g} value={g}>
                            {g} grubu
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label htmlFor="lic-kind">Belge sahibi</Label>
                    <Select id="lic-kind" value={kind} onChange={(e) => setKind(e.target.value as HolderKind)}>
                      {(["company", "sole_proprietor"] as const).map((k) => (
                        <option key={k} value={k}>
                          {HOLDER_KIND_LABEL[k]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="lic-name">Ticari unvan</Label>
                    <Input id="lic-name" value={legalName} maxLength={200} onChange={(e) => setLegalName(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="lic-tax">{kind === "company" ? "Vergi numarası" : "TC kimlik numarası"}</Label>
                    <Input id="lic-tax" value={taxId} inputMode="numeric" maxLength={20} autoComplete="off" onChange={(e) => setTaxId(e.target.value)} required />
                  </div>
                </div>
                {scope === "units" && (
                  <fieldset className="space-y-1">
                    <legend className="text-sm font-medium">Belgenin kapsadığı daireler</legend>
                    {properties.length === 0 ? (
                      <p className="text-muted-foreground">Önce bir daire ekleyin.</p>
                    ) : (
                      properties.map((p) => (
                        <label key={p.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={units.includes(p.id)}
                            onChange={(e) => setUnits((u) => (e.target.checked ? [...u, p.id] : u.filter((x) => x !== p.id)))}
                          />
                          {p.name}
                        </label>
                      ))
                    )}
                  </fieldset>
                )}
                <Button type="submit" disabled={busy}>
                  {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  Başvur
                </Button>
              </form>
            )}
          </>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
