"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/form-field";
import { toast } from "@/lib/toast";

/**
 * TİPİK GECELİK FİYAT ARALIĞI (isteğe bağlı, V2 para etkisi). Yalnız "Dikkat Gerektirenler"de çift
 * rezervasyonun risk altındaki tutarını ARALIK olarak göstermek için. Yapay zekâya gitmez. Kendi PUT/DELETE
 * uç noktası vardır; ana mülk formuna dokunmaz. Müşteri metni sade (kurucu 09-23): ne işe yaradığı + ne yapılacağı.
 */
const CURRENCIES = [
  { code: "TRY", label: "₺ TRY" },
  { code: "EUR", label: "€ EUR" },
  { code: "USD", label: "$ USD" },
  { code: "GBP", label: "£ GBP" },
] as const;

export function NightlyRateForm({
  propertyId,
  canManage,
  initial,
  stale,
}: {
  propertyId: string;
  canManage: boolean;
  initial: { low: number; high: number; currency: string } | null;
  /** Kayıtlı aralık 6 aydan eski. */
  stale: boolean;
}) {
  const router = useRouter();
  const [low, setLow] = useState(initial ? String(initial.low) : "");
  const [high, setHigh] = useState(initial ? String(initial.high) : "");
  const [currency, setCurrency] = useState(initial?.currency ?? "TRY");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const l = Number(low);
    const h = Number(high);
    if (!Number.isInteger(l) || !Number.isInteger(h) || l <= 0 || h <= l) {
      setError("En düşük ve en yüksek fiyatı tam sayı olarak girin; en yüksek, en düşükten büyük olmalı.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/nightly-rate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ low: l, high: h, currency }),
      });
      if (!res.ok) {
        setError("Kaydedilemedi. Değerleri kontrol edip tekrar deneyin.");
        return;
      }
      toast.success("Gecelik fiyat aralığı kaydedildi.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/nightly-rate`, { method: "DELETE" });
      if (!res.ok) {
        setError("Kaldırılamadı. Tekrar deneyin.");
        return;
      }
      setLow("");
      setHigh("");
      toast.success("Gecelik fiyat aralığı kaldırıldı.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Gecelik fiyat aralığı (isteğe bağlı)</p>
        <p className="text-xs text-muted-foreground">
          Çift rezervasyon gibi durumlarda risk altındaki tutarı tahmin etmek için kullanılır. Yapay zekâ bu fiyatı
          misafirlere söylemez.
        </p>
        {stale ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-500">Bu aralık 6 aydan eski; güncelleyin.</p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="En düşük" htmlFor="rate-low">
          <Input id="rate-low" type="number" min={1} inputMode="numeric" value={low} disabled={!canManage} onChange={(e) => setLow(e.target.value)} />
        </Field>
        <Field label="En yüksek" htmlFor="rate-high">
          <Input id="rate-high" type="number" min={1} inputMode="numeric" value={high} disabled={!canManage} onChange={(e) => setHigh(e.target.value)} />
        </Field>
        <Field label="Para birimi" htmlFor="rate-currency">
          <Select id="rate-currency" value={currency} disabled={!canManage} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {canManage ? (
        <div className="flex justify-end gap-2">
          {initial ? (
            <Button type="button" variant="outline" disabled={busy} onClick={clear}>
              Kaldır
            </Button>
          ) : null}
          <Button type="button" disabled={busy} onClick={save}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Kaydet
          </Button>
        </div>
      ) : null}
    </div>
  );
}
