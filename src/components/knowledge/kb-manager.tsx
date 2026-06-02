"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Eye, EyeOff, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/form-field";
import { KB_CATEGORY } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface KbItem {
  id: string;
  propertyId: string;
  propertyName: string;
  category: string;
  title: string;
  content: string;
  language: string;
  isActive: boolean;
}

export function KbManager({
  properties,
  items,
}: {
  properties: { id: string; name: string }[];
  items: KbItem[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    propertyId: properties[0]?.id ?? "",
    category: "general",
    title: "",
    content: "",
    language: "tr",
  });

  const refresh = () => startTransition(() => router.refresh());

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/kb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, isActive: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Bilgi eklenemedi");
        return;
      }
      setForm((f) => ({ ...f, title: "", content: "" }));
      refresh();
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(item: KbItem) {
    setBusyId(item.id);
    await fetch(`/api/kb/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !item.isActive }),
    });
    setBusyId(null);
    refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("Bu bilgiyi silmek istediğinize emin misiniz?")) return;
    setBusyId(id);
    await fetch(`/api/kb/${id}`, { method: "DELETE" });
    setBusyId(null);
    refresh();
  }

  // --- Copy an entry to other apartments -----------------------------------
  const [copyId, setCopyId] = useState<string | null>(null);
  const [copyTargets, setCopyTargets] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  function openCopy(item: KbItem) {
    setCopyId((cur) => (cur === item.id ? null : item.id));
    setCopyTargets(new Set());
    setCopyMsg(null);
  }

  function toggleTarget(pid: string) {
    setCopyTargets((s) => {
      const n = new Set(s);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return n;
    });
  }

  function otherProps(item: KbItem) {
    return properties.filter((p) => p.id !== item.propertyId);
  }

  async function doCopy(item: KbItem) {
    if (copyTargets.size === 0) return;
    setCopying(true);
    setCopyMsg(null);
    try {
      const res = await fetch(`/api/kb/${item.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPropertyIds: [...copyTargets] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCopyMsg(data.error ?? "Kopyalanamadı");
        return;
      }
      setCopyId(null);
      refresh();
    } catch {
      setCopyMsg("Bağlantı hatası.");
    } finally {
      setCopying(false);
    }
  }

  const grouped = properties
    .map((p) => ({ property: p, list: items.filter((i) => i.propertyId === p.id) }))
    .filter((g) => g.list.length > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Create */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4 text-muted-foreground" /> Yeni Bilgi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-3">
            {error ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
            ) : null}
            <Field label="Mülk" htmlFor="kb-property">
              <Select id="kb-property" value={form.propertyId} onChange={(e) => set("propertyId", e.target.value)} required>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Kategori" htmlFor="kb-category">
              <Select id="kb-category" value={form.category} onChange={(e) => set("category", e.target.value)}>
                {KB_CATEGORY.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Başlık" htmlFor="kb-title">
              <Input id="kb-title" value={form.title} onChange={(e) => set("title", e.target.value)} required />
            </Field>
            <Field label="İçerik" htmlFor="kb-content">
              <Textarea id="kb-content" value={form.content} onChange={(e) => set("content", e.target.value)} required />
            </Field>
            <Button type="submit" className="w-full" disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Ekle
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      <div className="space-y-4 lg:col-span-2">
        {grouped.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Henüz bilgi eklenmemiş. Soldaki formdan ekleyebilirsiniz.
            </CardContent>
          </Card>
        ) : (
          grouped.map(({ property, list }) => (
            <Card key={property.id}>
              <CardHeader>
                <CardTitle className="text-base">{property.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {list.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={KB_CATEGORY.tone(item.category)}>
                          {KB_CATEGORY.label(item.category)}
                        </Badge>
                        <span className="text-sm font-medium">{item.title}</span>
                        {!item.isActive ? <Badge tone="muted">Pasif</Badge> : null}
                      </div>
                      <div className="flex items-center gap-1">
                        {otherProps(item).length > 0 ? (
                          <button
                            onClick={() => openCopy(item)}
                            className={cn(
                              "rounded p-1.5 text-muted-foreground hover:bg-accent",
                              copyId === item.id && "bg-accent text-foreground",
                            )}
                            aria-label="Diğer dairelere kopyala"
                            title="Diğer dairelere kopyala"
                          >
                            <Copy className="size-4" />
                          </button>
                        ) : null}
                        <button
                          onClick={() => toggleActive(item)}
                          disabled={busyId === item.id}
                          className="rounded p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
                          aria-label={item.isActive ? "Pasifleştir" : "Aktifleştir"}
                          title={item.isActive ? "Pasifleştir" : "Aktifleştir"}
                        >
                          {item.isActive ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                        </button>
                        <button
                          onClick={() => remove(item.id)}
                          disabled={busyId === item.id}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          aria-label="Sil"
                        >
                          {busyId === item.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </button>
                      </div>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground">
                      {item.content}
                    </p>

                    {copyId === item.id ? (
                      <div className="mt-2.5 space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
                        <p className="text-xs font-medium">
                          Bu bilgiyi hangi dairelere kopyalayalım?
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {otherProps(item).map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => toggleTarget(p.id)}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                                copyTargets.has(p.id)
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border hover:bg-accent",
                              )}
                            >
                              {p.name}
                            </button>
                          ))}
                        </div>
                        {copyMsg ? <p className="text-xs text-destructive">{copyMsg}</p> : null}
                        <div className="flex flex-wrap items-center gap-3">
                          <Button
                            size="sm"
                            onClick={() => doCopy(item)}
                            disabled={copying || copyTargets.size === 0}
                          >
                            {copying ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                            {copyTargets.size > 0
                              ? `${copyTargets.size} daireye kopyala`
                              : "Daire seçin"}
                          </Button>
                          <button
                            type="button"
                            onClick={() =>
                              setCopyTargets(new Set(otherProps(item).map((p) => p.id)))
                            }
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            Hepsini seç
                          </button>
                          <button
                            type="button"
                            onClick={() => setCopyId(null)}
                            className="text-xs text-muted-foreground hover:underline"
                          >
                            İptal
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
