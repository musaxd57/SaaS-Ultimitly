"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form-field";
import { RESERVATION_CHANNEL, RESERVATION_STATUS } from "@/lib/constants";

const CURRENCIES = ["EUR", "TRY", "USD", "GBP"];

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function ReservationForm({
  properties,
  defaultPropertyId,
}: {
  properties: { id: string; name: string }[];
  defaultPropertyId?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    propertyId: defaultPropertyId ?? properties[0]?.id ?? "",
    guestName: "",
    guestPhone: "",
    guestEmail: "",
    arrivalDate: isoDate(0),
    departureDate: isoDate(1),
    channel: "manual",
    status: "confirmed",
    totalAmount: "",
    currency: "EUR",
    sourceReference: "",
    notes: "",
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFields({});
    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          totalAmount: form.totalAmount === "" ? undefined : Number(form.totalAmount),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.fields) setFields(data.fields);
        setError(data.error ?? "Rezervasyon oluşturulamadı");
        return;
      }
      router.push("/reservations");
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      <Field label="Mülk" htmlFor="propertyId" error={fields.propertyId}>
        <Select
          id="propertyId"
          value={form.propertyId}
          onChange={(e) => set("propertyId", e.target.value)}
          required
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Misafir adı" htmlFor="guestName" error={fields.guestName}>
          <Input id="guestName" value={form.guestName} onChange={(e) => set("guestName", e.target.value)} required />
        </Field>
        <Field label="Telefon" htmlFor="guestPhone" error={fields.guestPhone}>
          <Input id="guestPhone" value={form.guestPhone} onChange={(e) => set("guestPhone", e.target.value)} />
        </Field>
      </div>

      <Field label="E-posta" htmlFor="guestEmail" error={fields.guestEmail}>
        <Input id="guestEmail" type="email" value={form.guestEmail} onChange={(e) => set("guestEmail", e.target.value)} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Giriş tarihi" htmlFor="arrivalDate" error={fields.arrivalDate}>
          <Input id="arrivalDate" type="date" value={form.arrivalDate} onChange={(e) => set("arrivalDate", e.target.value)} required />
        </Field>
        <Field label="Çıkış tarihi" htmlFor="departureDate" error={fields.departureDate}>
          <Input id="departureDate" type="date" value={form.departureDate} onChange={(e) => set("departureDate", e.target.value)} required />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kanal" htmlFor="channel" error={fields.channel}>
          <Select id="channel" value={form.channel} onChange={(e) => set("channel", e.target.value)}>
            {RESERVATION_CHANNEL.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Durum" htmlFor="status" error={fields.status}>
          <Select id="status" value={form.status} onChange={(e) => set("status", e.target.value)}>
            {RESERVATION_STATUS.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Toplam tutar" htmlFor="totalAmount" error={fields.totalAmount}>
          <Input id="totalAmount" type="number" min={0} step="0.01" value={form.totalAmount} onChange={(e) => set("totalAmount", e.target.value)} placeholder="Opsiyonel" />
        </Field>
        <Field label="Para birimi" htmlFor="currency" error={fields.currency}>
          <Select id="currency" value={form.currency} onChange={(e) => set("currency", e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Kaynak referansı" htmlFor="sourceReference" hint="Örn. Airbnb rezervasyon kodu" error={fields.sourceReference}>
        <Input id="sourceReference" value={form.sourceReference} onChange={(e) => set("sourceReference", e.target.value)} />
      </Field>

      <Field label="Notlar" htmlFor="notes" error={fields.notes}>
        <Textarea id="notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" disabled={loading || properties.length === 0}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          Rezervasyon Oluştur
        </Button>
      </div>
    </form>
  );
}
