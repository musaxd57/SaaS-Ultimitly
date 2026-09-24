"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form-field";
import { toast } from "@/lib/toast";

/**
 * ERKEN GİRİŞ KURALI (mülk başına, isteğe bağlı — doğrulanmış erken giriş akışı, `lib/early-checkin`). Misafir erken
 * gelmek isterse sistem önceki misafirin çıkışını, çakışan rezervasyonu ve temizliğin "bitti" işaretini kontrol
 * eder; kural hepsi uygunsa ne yapılacağını söyler. Ücreti yapay zekâ yalnız OKUR, uydurmaz. Müşteri metni sade.
 */
const MODES = [
  { code: "off", label: "Kapalı — erken giriş istekleri size gelir" },
  { code: "draft", label: "Cevabı hazırla, ben göndereyim" },
  { code: "auto", label: "Her şey uygunsa otomatik gönder" },
] as const;

const CURRENCIES = [
  { code: "TRY", label: "₺ TRY" },
  { code: "EUR", label: "€ EUR" },
  { code: "USD", label: "$ USD" },
  { code: "GBP", label: "£ GBP" },
] as const;

export interface EarlyCheckinRuleInitial {
  mode: string;
  earliest: string;
  fee: { amount: number; currency: string } | null;
  note: string | null;
}

export function EarlyCheckinRuleForm({
  propertyId,
  canManage,
  initial,
}: {
  propertyId: string;
  canManage: boolean;
  initial: EarlyCheckinRuleInitial | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState(initial?.mode ?? "off");
  const [earliest, setEarliest] = useState(initial?.earliest ?? "12:00");
  const [amount, setAmount] = useState(initial?.fee ? String(initial.fee.amount) : "");
  const [currency, setCurrency] = useState(initial?.fee?.currency ?? "TRY");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const a = amount.trim() === "" ? null : Number(amount.replace(",", "."));
    if (a !== null && (!Number.isFinite(a) || a <= 0)) {
      setError("Ücreti sayı olarak girin ya da boş bırakın.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/early-checkin-rule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, earliest, fee: a === null ? null : { amount: a, currency }, note: note.trim() || null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { fields?: { _?: string } } | null;
        setError(body?.fields?._ ?? "Kaydedilemedi. Değerleri kontrol edip tekrar deneyin.");
        return;
      }
      toast.success("Erken giriş kuralı kaydedildi.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Erken giriş</p>
        <p className="text-xs text-muted-foreground">
          Misafir erken gelmek isterse önceki misafirin çıkışını, başka rezervasyon olup olmadığını ve temizliğin
          &quot;bitti&quot; olarak işaretlenip işaretlenmediğini kontrol ederiz. Bir şey eksikse mesaj size kalır.
        </p>
      </div>
      <Field label="Ne yapılsın?" htmlFor="eci-mode">
        <Select id="eci-mode" value={mode} disabled={!canManage} onChange={(e) => setMode(e.target.value)}>
          {MODES.map((m) => (
            <option key={m.code} value={m.code}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="En erken giriş saati" htmlFor="eci-earliest">
          <Input id="eci-earliest" type="time" value={earliest} disabled={!canManage} onChange={(e) => setEarliest(e.target.value)} />
        </Field>
        <Field label="Ücret (isteğe bağlı)" htmlFor="eci-fee">
          <Input id="eci-fee" type="number" min={0} step="0.01" inputMode="decimal" value={amount} disabled={!canManage} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Para birimi" htmlFor="eci-currency">
          <Select id="eci-currency" value={currency} disabled={!canManage} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Misafire eklenecek not (isteğe bağlı)" htmlFor="eci-note">
        <Textarea id="eci-note" rows={2} maxLength={200} value={note} disabled={!canManage} onChange={(e) => setNote(e.target.value)} placeholder="Örn. Ödeme talebi Airbnb üzerinden gelecek." />
      </Field>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {canManage ? (
        <div className="flex justify-end">
          <Button type="button" disabled={busy} onClick={save}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Kaydet
          </Button>
        </div>
      ) : null}
    </div>
  );
}
