"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form-field";

export interface PropertyFormData {
  id?: string;
  name: string;
  address: string;
  city: string;
  country: string;
  checkInTime: string;
  checkOutTime: string;
  cleaningBufferMinutes: number;
  notes: string;
}

const empty: PropertyFormData = {
  name: "",
  address: "",
  city: "",
  country: "Türkiye",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  cleaningBufferMinutes: 120,
  notes: "",
};

export function PropertyForm({
  mode,
  property,
  canManage = true,
}: {
  mode: "create" | "edit";
  property?: PropertyFormData;
  /** Staff (read-only) see the form but can't save — the API also returns 403. */
  canManage?: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<PropertyFormData>(property ?? empty);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set<K extends keyof PropertyFormData>(key: K, value: PropertyFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return; // staff can't create/edit properties (route also enforces 403)
    setLoading(true);
    setError(null);
    setFields({});
    const endpoint = mode === "create" ? "/api/properties" : `/api/properties/${property?.id}`;
    const method = mode === "create" ? "POST" : "PATCH";
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.fields) setFields(data.fields);
        setError(data.error ?? "İşlem başarısız oldu");
        return;
      }
      if (mode === "create") router.push(`/properties/${data.id}`);
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

      <Field label="Mülk adı" htmlFor="name" error={fields.name}>
        <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
      </Field>

      <Field label="Adres" htmlFor="address" error={fields.address}>
        <Input id="address" value={form.address} onChange={(e) => set("address", e.target.value)} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Şehir" htmlFor="city" error={fields.city}>
          <Input id="city" value={form.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label="Ülke" htmlFor="country" error={fields.country}>
          <Input id="country" value={form.country} onChange={(e) => set("country", e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Check-in saati" htmlFor="checkInTime" error={fields.checkInTime}>
          <Input
            id="checkInTime"
            type="time"
            value={form.checkInTime}
            onChange={(e) => set("checkInTime", e.target.value)}
          />
        </Field>
        <Field label="Check-out saati" htmlFor="checkOutTime" error={fields.checkOutTime}>
          <Input
            id="checkOutTime"
            type="time"
            value={form.checkOutTime}
            onChange={(e) => set("checkOutTime", e.target.value)}
          />
        </Field>
        <Field
          label="Temizlik tamponu (dk)"
          htmlFor="buffer"
          error={fields.cleaningBufferMinutes}
        >
          <Input
            id="buffer"
            type="number"
            min={0}
            value={form.cleaningBufferMinutes}
            onChange={(e) => set("cleaningBufferMinutes", Number(e.target.value))}
          />
        </Field>
      </div>

      <Field label="Notlar" htmlFor="notes" error={fields.notes}>
        <Textarea
          id="notes"
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="İç notlar, özel talimatlar..."
        />
      </Field>

      {canManage ? (
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {mode === "create" ? "Mülk Ekle" : "Değişiklikleri Kaydet"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Mülk ayarları yalnızca sahip/yönetici tarafından düzenlenebilir.
        </p>
      )}
    </form>
  );
}
