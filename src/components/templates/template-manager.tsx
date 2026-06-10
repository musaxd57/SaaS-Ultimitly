"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Globe, Building2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/form-field";
import { TEMPLATE_CATEGORY } from "@/lib/constants";
import type { MessageTemplate } from "@/lib/templates";

interface CustomTemplateRow {
  id: string;
  title: string;
  body: string;
  category: string;
  language: string;
  isActive: boolean;
  propertyName: string | null;
  propertyId: string | null;
}

interface Props {
  properties: { id: string; name: string }[];
  customTemplates: CustomTemplateRow[];
  defaultTemplates: MessageTemplate[];
}

const LANG_LABELS: Record<string, string> = { tr: "Türkçe", en: "İngilizce", de: "Almanca", fr: "Fransızca", ar: "Arapça" };

export function TemplateManager({ properties, customTemplates, defaultTemplates }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [expandedDefaults, setExpandedDefaults] = useState(false);
  const [form, setForm] = useState({
    title: "",
    body: "",
    category: "general",
    language: "tr",
    propertyId: "",
  });

  const refresh = () => startTransition(() => router.refresh());

  function setF(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, propertyId: form.propertyId || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Şablon oluşturulamadı");
        return;
      }
      setForm({ title: "", body: "", category: "general", language: "tr", propertyId: "" });
      setShowForm(false);
      refresh();
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Bu şablonu silmek istediğinize emin misiniz?")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
      if (!res.ok) window.alert("Şablon silinemedi.");
      else refresh();
    } catch {
      window.alert("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Custom Templates Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Özel Şablonlar ({customTemplates.length})</h2>
        <Button size="sm" onClick={() => setShowForm((s) => !s)}>
          <Plus className="size-4" />
          Yeni Şablon
        </Button>
      </div>

      {/* Create Form */}
      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Yeni Şablon Oluştur</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              {error ? (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Başlık" htmlFor="tmpl-title">
                  <Input
                    id="tmpl-title"
                    value={form.title}
                    onChange={(e) => setF("title", e.target.value)}
                    required
                  />
                </Field>
                <Field label="Kategori" htmlFor="tmpl-category">
                  <Select
                    id="tmpl-category"
                    value={form.category}
                    onChange={(e) => setF("category", e.target.value)}
                  >
                    {TEMPLATE_CATEGORY.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Dil" htmlFor="tmpl-lang">
                  <Select
                    id="tmpl-lang"
                    value={form.language}
                    onChange={(e) => setF("language", e.target.value)}
                  >
                    {Object.entries(LANG_LABELS).map(([val, lbl]) => (
                      <option key={val} value={val}>{lbl}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Mülk (opsiyonel)" htmlFor="tmpl-property">
                  <Select
                    id="tmpl-property"
                    value={form.propertyId}
                    onChange={(e) => setF("propertyId", e.target.value)}
                  >
                    <option value="">Tüm mülkler</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field
                label="Şablon metni"
                htmlFor="tmpl-body"
                hint="Yer tutucular: {{guestName}}, {{checkInTime}}, {{checkOutTime}}, {{propertyName}}, {{wifiInfo}}"
              >
                <Textarea
                  id="tmpl-body"
                  value={form.body}
                  onChange={(e) => setF("body", e.target.value)}
                  className="min-h-[120px]"
                  required
                />
              </Field>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  İptal
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Oluştur
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {/* Custom Template List */}
      {customTemplates.length === 0 && !showForm ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Henüz özel şablon oluşturulmadı. Yukarıdaki butona tıklayarak ekleyebilirsiniz.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {customTemplates.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{t.title}</span>
                      <Badge tone={TEMPLATE_CATEGORY.tone(t.category)}>
                        {TEMPLATE_CATEGORY.label(t.category)}
                      </Badge>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {LANG_LABELS[t.language] ?? t.language}
                      </span>
                      {t.propertyName ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Building2 className="size-3" /> {t.propertyName}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Globe className="size-3" /> Tüm mülkler
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground line-clamp-3">{t.body}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(t.id)}
                    disabled={busyId === t.id}
                    className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    aria-label="Sil"
                  >
                    {busyId === t.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Default Templates */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setExpandedDefaults((s) => !s)}
          className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          {expandedDefaults ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Varsayılan Şablonlar ({defaultTemplates.length})
        </button>

        {expandedDefaults ? (
          <div className="space-y-3">
            {defaultTemplates.map((t) => (
              <Card key={t.id} className="opacity-80">
                <CardContent className="p-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{t.title}</span>
                      <Badge tone={TEMPLATE_CATEGORY.tone(t.category)}>
                        {TEMPLATE_CATEGORY.label(t.category)}
                      </Badge>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {LANG_LABELS[t.language] ?? t.language}
                      </span>
                      <Badge tone="muted">Varsayılan</Badge>
                    </div>
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground line-clamp-3">{t.body}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
