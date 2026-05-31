"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form-field";
import { TASK_TYPE, TASK_STATUS, PRIORITY } from "@/lib/constants";

export function TaskForm({
  properties,
  members,
}: {
  properties: { id: string; name: string }[];
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    propertyId: properties[0]?.id ?? "",
    type: "cleaning",
    title: "",
    description: "",
    assignedToId: "",
    dueAt: "",
    priority: "standard",
    status: "todo",
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
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.fields) setFields(data.fields);
        setError(data.error ?? "Görev oluşturulamadı");
        return;
      }
      router.push("/tasks");
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

      <Field label="Başlık" htmlFor="title" error={fields.title}>
        <Input id="title" value={form.title} onChange={(e) => set("title", e.target.value)} required />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mülk" htmlFor="propertyId" error={fields.propertyId}>
          <Select id="propertyId" value={form.propertyId} onChange={(e) => set("propertyId", e.target.value)} required>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Tür" htmlFor="type">
          <Select id="type" value={form.type} onChange={(e) => set("type", e.target.value)}>
            {TASK_TYPE.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Açıklama" htmlFor="description" error={fields.description}>
        <Textarea id="description" value={form.description} onChange={(e) => set("description", e.target.value)} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Atanan personel" htmlFor="assignedToId" error={fields.assignedToId}>
          <Select id="assignedToId" value={form.assignedToId} onChange={(e) => set("assignedToId", e.target.value)}>
            <option value="">Atanmadı</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Son teslim" htmlFor="dueAt" error={fields.dueAt}>
          <Input id="dueAt" type="datetime-local" value={form.dueAt} onChange={(e) => set("dueAt", e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Öncelik" htmlFor="priority">
          <Select id="priority" value={form.priority} onChange={(e) => set("priority", e.target.value)}>
            {PRIORITY.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Durum" htmlFor="status">
          <Select id="status" value={form.status} onChange={(e) => set("status", e.target.value)}>
            {TASK_STATUS.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={loading || properties.length === 0}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          Görev Oluştur
        </Button>
      </div>
    </form>
  );
}
