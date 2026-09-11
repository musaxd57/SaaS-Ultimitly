"use client";

import { useRef, useState, useTransition } from "react";
import { FormError } from "@/components/form-error";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Globe, Building2, ChevronDown, ChevronRight, Pencil, Copy } from "lucide-react";
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
  /** Owner/manager may add/edit/delete templates; staff get a read-only view. */
  canManage?: boolean;
}

const LANG_LABELS: Record<string, string> = { tr: "Türkçe", en: "İngilizce", de: "Almanca", fr: "Fransızca", ar: "Arapça" };

const EMPTY_FORM = { title: "", body: "", category: "general", language: "tr", propertyId: "" };

export function TemplateManager({ properties, customTemplates, defaultTemplates, canManage = true }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  /**
   * Hiç özel şablon yokken varsayılanlar AÇIK başlar: kurucu "bunlar gözükmüyor"
   * dedi — kapalı bir ok tuşunun arkasındaki içerik, yeni host için yok
   * hükmündeydi. Kendi şablonu olan host için kapalı kalır (gürültü olmasın).
   */
  const [expandedDefaults, setExpandedDefaults] = useState(customTemplates.length === 0);
  /**
   * 🚨 Dolu = DÜZENLEME (PATCH), boş = YENİ KAYIT (POST). Varsayılan şablondan
   * "uyarla" da YENİ kayıttır: varsayılanlar koddaki sabitlerdir, DB satırı
   * değildir — düzenlenemezler, yalnız KOPYALANABİLİRLER.
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adaptedFrom, setAdaptedFrom] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const formRef = useRef<HTMLDivElement | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  function setF(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** Formu aç ve görünür yap — kart listesi uzun, form sayfanın tepesinde. */
  function openForm() {
    setError(null);
    setShowForm(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  function openNew() {
    setEditingId(null);
    setAdaptedFrom(null);
    setForm(EMPTY_FORM);
    openForm();
  }

  function openEdit(t: CustomTemplateRow) {
    setEditingId(t.id);
    setAdaptedFrom(null);
    setForm({
      title: t.title,
      body: t.body,
      category: t.category,
      language: t.language,
      propertyId: t.propertyId ?? "",
    });
    openForm();
  }

  /**
   * Varsayılan şablonu KENDİ kopyasına çevirir. Kurucu bildirdi: varsayılanlar
   * ekranda duruyor ama "düzenlenmiyor bile" — doğrusu bu: içerik forma dolar,
   * host istediği gibi değiştirir ve KAYDEDİNCE kendi şablonu olur.
   */
  function openAdapt(t: MessageTemplate) {
    setEditingId(null);
    setAdaptedFrom(t.title);
    setForm({ title: t.title, body: t.body, category: t.category, language: t.language, propertyId: "" });
    openForm();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(editingId ? `/api/templates/${editingId}` : "/api/templates", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, propertyId: form.propertyId || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Surface the FIELD message ("Başlık gerekli") — the generic top-level
        // error alone ("Doğrulama hatası") told the user nothing actionable.
        const fieldMsg = data.fields ? (Object.values(data.fields)[0] as string) : null;
        setError(fieldMsg ?? data.error ?? (editingId ? "Şablon güncellenemedi" : "Şablon oluşturulamadı"));
        return;
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      setEditingId(null);
      setAdaptedFrom(null);
      refresh();
    } catch {
      setError("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirmDialog({
      title: "Bu şablonu silmek istiyor musunuz?",
      body: "Şablon kalıcı olarak silinir; gönderilmiş mesajlar etkilenmez.",
      confirmLabel: "Sil",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
      if (!res.ok) toast.error("Şablon silinemedi.");
      else {
        // Silinen satır formda açıksa form bayat kalırdı (kaydet → 404).
        if (editingId === id) {
          setEditingId(null);
          setShowForm(false);
          setForm(EMPTY_FORM);
        }
        refresh();
      }
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Custom Templates Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Özel Şablonlar ({customTemplates.length})</h2>
        {canManage ? (
          <Button size="sm" onClick={() => (showForm && !editingId && !adaptedFrom ? setShowForm(false) : openNew())}>
            <Plus className="size-4" />
            Yeni Şablon
          </Button>
        ) : null}
      </div>

      {/* Create / Edit Form */}
      <div ref={formRef}>
        {canManage && showForm ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {editingId ? "Şablonu Düzenle" : adaptedFrom ? "Varsayılandan Uyarla" : "Yeni Şablon Oluştur"}
              </CardTitle>
              {adaptedFrom ? (
                <p className="text-xs text-muted-foreground">
                  “{adaptedFrom}” içeriği kopyalandı. İstediğiniz gibi değiştirin; kaydedince kendi şablonunuz olur,
                  varsayılan olduğu gibi kalır.
                </p>
              ) : null}
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {error ? (
                  <FormError>{error}</FormError>
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
                  hint="Yer tutucular: {{guestName}} (ya da {isim}), {{checkInTime}}, {{checkOutTime}}, {{propertyName}}, {{wifiInfo}} — değerler eklenirken otomatik doldurulur."
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowForm(false);
                      setEditingId(null);
                      setAdaptedFrom(null);
                    }}
                  >
                    İptal
                  </Button>
                  <Button type="submit" disabled={creating}>
                    {creating ? <Loader2 className="size-4 animate-spin" /> : editingId ? <Pencil className="size-4" /> : <Plus className="size-4" />}
                    {editingId ? "Kaydet" : "Oluştur"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Custom Template List */}
      {customTemplates.length === 0 && !showForm ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Henüz özel şablon oluşturulmadı.
            {canManage ? " Yukarıdaki butonla sıfırdan yazabilir ya da aşağıdaki varsayılanlardan birini kendinize uyarlayabilirsiniz." : ""}
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
                  {canManage ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(t)}
                        className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="Düzenle"
                      >
                        <Pencil className="size-4" />
                      </button>
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
                  ) : null}
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
            <p className="text-xs text-muted-foreground">
              Bunlar Lixus ile birlikte gelen hazır metinlerdir; oldukları gibi bırakılır.
              {canManage ? " Değiştirmek için “Kendime uyarla” deyin — içerik forma dolar, kaydettiğinizde kendi şablonunuz olur." : ""}
            </p>
            {defaultTemplates.map((t) => (
              <Card key={t.id} className="opacity-80">
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
                        <Badge tone="muted">Varsayılan</Badge>
                      </div>
                      <p className="whitespace-pre-wrap text-xs text-muted-foreground line-clamp-3">{t.body}</p>
                    </div>
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => openAdapt(t)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Copy className="size-3.5" />
                        Kendime uyarla
                      </button>
                    ) : null}
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
