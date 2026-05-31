"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form-field";
import { PRIORITY } from "@/lib/constants";

const CHANNELS = [
  { value: "manual", label: "Manuel" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-posta" },
  { value: "airbnb", label: "Airbnb" },
  { value: "booking", label: "Booking" },
];

export interface ReservationOption {
  id: string;
  propertyId: string;
  label: string;
}

export function ConversationForm({
  properties,
  reservations,
}: {
  properties: { id: string; name: string }[];
  reservations: ReservationOption[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    propertyId: properties[0]?.id ?? "",
    reservationId: "",
    guestIdentifier: "",
    channel: "whatsapp",
    priority: "standard",
    firstMessage: "",
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const propertyReservations = reservations.filter((r) => r.propertyId === form.propertyId);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === "propertyId" ? { reservationId: "" } : {}),
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFields({});
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.fields) setFields(data.fields);
        setError(data.error ?? "Konuşma oluşturulamadı");
        return;
      }
      router.push(`/inbox/${data.id}`);
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
        <Select id="propertyId" value={form.propertyId} onChange={(e) => set("propertyId", e.target.value)} required>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </Field>

      <Field label="Rezervasyon (opsiyonel)" htmlFor="reservationId">
        <Select id="reservationId" value={form.reservationId} onChange={(e) => set("reservationId", e.target.value)}>
          <option value="">Bağlama yok</option>
          {propertyReservations.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </Select>
      </Field>

      <Field label="Misafir (ad / telefon / e-posta)" htmlFor="guestIdentifier" error={fields.guestIdentifier}>
        <Input id="guestIdentifier" value={form.guestIdentifier} onChange={(e) => set("guestIdentifier", e.target.value)} required />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kanal" htmlFor="channel">
          <Select id="channel" value={form.channel} onChange={(e) => set("channel", e.target.value)}>
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Öncelik" htmlFor="priority">
          <Select id="priority" value={form.priority} onChange={(e) => set("priority", e.target.value)}>
            {PRIORITY.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="İlk mesaj (misafirden gelen)" htmlFor="firstMessage" error={fields.firstMessage}>
        <Textarea
          id="firstMessage"
          value={form.firstMessage}
          onChange={(e) => set("firstMessage", e.target.value)}
          placeholder="Örn. Merhaba, erken giriş mümkün mü?"
          required
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" disabled={loading || properties.length === 0}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          Konuşma Oluştur
        </Button>
      </div>
    </form>
  );
}
