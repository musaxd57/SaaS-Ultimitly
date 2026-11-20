"use client";

import { useRef, useState, useTransition } from "react";
import { FormError } from "@/components/form-error";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Trash2, Globe, Building2, ChevronDown, ChevronRight, Pencil, Copy, Search, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/form-field";
import { Pager } from "@/components/pager";
import { TEMPLATE_CATEGORY } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { MessageTemplate } from "@/lib/templates";

/** Liste satırı: tam gövde YOK, kısa önizleme var (kurucu 11-19 akşam madde 1) — düzenleme tam metni `GET /api/templates/[id]`den alır. */
interface CustomTemplateRow {
  id: string;
  title: string;
  preview: string;
  category: string;
  language: string;
  isActive: boolean;
  propertyName: string | null;
  propertyId: string | null;
}

/** Sunucu sayfasının durumu (arama + sayfa) — liste en çok `pageSize` satır taşır, `matchCount` aramaya uyan toplamdır. */
interface Listing {
  query: string;
  page: number;
  pageSize: number;
  matchCount: number;
}

interface Props {
  properties: { id: string; name: string }[];
  customTemplates: CustomTemplateRow[];
  /** İşletmenin TOPLAM özel şablon sayısı (aramadan bağımsız). Verilmezse listedeki satır sayısı. */
  totalCount?: number;
  /** Verilmezse tek sayfa, arama yok. */
  listing?: Listing;
  /**
   * Sınır satırı (kurucu 11-20 sabah Ş-2): sınırın %90'ında uyarı, sınırda bugünkü sınır metni. Metin sunucuda kurulur
   * (`messageTemplateCapNotice`, eşik yürürlükteki sınırdan); bileşen yalnız gösterir. Yoksa satır yok.
   */
  capNotice?: string | null;
  defaultTemplates: MessageTemplate[];
  /** Owner/manager may add/edit/delete templates; staff get a read-only view. */
  canManage?: boolean;
}

/** `GET /api/templates/[id]` yanıtının düzenleme formunun okuduğu alanları. */
interface TemplateDetailResponse {
  title?: unknown;
  body?: unknown;
  category?: unknown;
  language?: unknown;
  propertyId?: unknown;
  updatedAt?: unknown;
  error?: unknown;
}

const LANG_LABELS: Record<string, string> = { tr: "Türkçe", en: "İngilizce", de: "Almanca", fr: "Fransızca", ar: "Arapça" };

const EMPTY_FORM = { title: "", body: "", category: "general", language: "tr", propertyId: "" };

export function TemplateManager({ properties, customTemplates, totalCount, listing, capNotice, defaultTemplates, canManage = true }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const allCount = totalCount ?? customTemplates.length;
  const view: Listing = listing ?? { query: "", page: 1, pageSize: Math.max(1, customTemplates.length), matchCount: customTemplates.length };
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** "Düzenle"ye basılan şablonun tam metni okunurken (çift tıklama ikinci okuma başlatmasın). */
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  /**
   * Hiç özel şablon yokken varsayılanlar AÇIK başlar: kurucu "bunlar gözükmüyor"
   * dedi — kapalı bir ok tuşunun arkasındaki içerik, yeni host için yok
   * hükmündeydi. Kendi şablonu olan host için kapalı kalır (gürültü olmasın).
   */
  const [expandedDefaults, setExpandedDefaults] = useState(allCount === 0);
  /**
   * 🚨 Dolu = DÜZENLEME (PATCH), boş = YENİ KAYIT (POST). Varsayılan şablondan
   * "uyarla" da YENİ kayıttır: varsayılanlar koddaki sabitlerdir, DB satırı
   * değildir — düzenlenemezler, yalnız KOPYALANABİLİRLER.
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adaptedFrom, setAdaptedFrom] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  /**
   * Codex 11-17 H1: düzenlenen şablonun formun açıldığı andaki sürümü. Kayıt bunu `expectedUpdatedAt` olarak gönderir; arada başka sekme /
   * kişi kaydettiyse sunucu 409 der ve form (yazılanla) açık kalır — eski tam form başkasının metnini geri yazamaz. Sürüm, formun
   * doldurulduğu TAM metinle aynı okumadan (`GET /api/templates/[id]`) gelir.
   */
  const [editBase, setEditBase] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  /**
   * Form açılış kuşağı (11-19 gece): "Düzenle" tam metni beklerken kullanıcı "Yeni Şablon" / "Kendime uyarla" açar ya da formu kapatırsa,
   * geç dönen okuma formu EZMEMELİ (yazılan kaybolur, kip sessizce başka şablonun düzenlemesine döner, kayıt o şablona gider). Her açma /
   * kapama kuşağı artırır; okuma yalnız başladığı kuşak hâlâ geçerliyse formu doldurur.
   */
  const openSeq = useRef(0);

  const refresh = () => startTransition(() => router.refresh());

  function setF(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** Formu aç ve görünür yap — kart listesi uzun, form sayfanın tepesinde. */
  function openForm() {
    setError(null);
    setShowForm(true);
    // ⚠️ KORUMALI ÇAĞRI: `scrollIntoView` her ortamda YOK (jsdom'da tanımsız).
    // Korumasız hâli bu depoda bir kez tam suit'i üç "unhandled error" ile
    // kırmıştı; `requestAnimationFrame` içinde olduğu için React error boundary
    // de yakalamaz (inceleme ajanı 09-11 — aynı ders silinen koddaydı).
    requestAnimationFrame(() => formRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }));
  }

  function openNew() {
    openSeq.current++;
    setEditingId(null);
    setAdaptedFrom(null);
    setForm(EMPTY_FORM);
    openForm();
  }

  /**
   * Liste yalnız kısa önizleme taşır (kurucu 11-19 akşam madde 1): form TAM metni ve sürümü `GET /api/templates/[id]`den alır. Her açılış
   * taze okuma — kaydettikten sonra liste henüz yenilenmeden yeniden açılsa da en son sürüm gider (eskiden bunun için ayrı bir "bu ekrandan
   * kaydedilen sürüm" belleği vardı). Okunamazsa form açılmaz; şablon arada silindiyse (404) liste yenilenir.
   */
  async function openEdit(t: CustomTemplateRow) {
    if (openingId) return;
    setOpeningId(t.id);
    const seq = ++openSeq.current;
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(t.id)}`);
      const d = (await res.json().catch(() => null)) as TemplateDetailResponse | null;
      // Bu arada başka bir form açıldı / form kapandı: geç dönen okuma hiçbir şeyi değiştirmez (hata da duyurulmaz).
      if (seq !== openSeq.current) return;
      if (!res.ok || !d || typeof d.body !== "string" || typeof d.updatedAt !== "string") {
        toast.error(typeof d?.error === "string" ? d.error : "Şablon yüklenemedi. Lütfen tekrar deneyin.");
        if (res.status === 404) refresh();
        return;
      }
      setEditingId(t.id);
      setEditBase(d.updatedAt);
      setAdaptedFrom(null);
      setForm({
        title: typeof d.title === "string" ? d.title : t.title,
        body: d.body,
        category: typeof d.category === "string" ? d.category : t.category,
        language: typeof d.language === "string" ? d.language : t.language,
        propertyId: typeof d.propertyId === "string" ? d.propertyId : "",
      });
      openForm();
    } catch {
      if (seq === openSeq.current) toast.error("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
    } finally {
      setOpeningId(null);
    }
  }

  /**
   * Varsayılan şablonu KENDİ kopyasına çevirir. Kurucu bildirdi: varsayılanlar
   * ekranda duruyor ama "düzenlenmiyor bile" — doğrusu bu: içerik forma dolar,
   * host istediği gibi değiştirir ve KAYDEDİNCE kendi şablonu olur.
   */
  function openAdapt(t: MessageTemplate) {
    openSeq.current++;
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
        body: JSON.stringify({
          ...form,
          propertyId: form.propertyId || null,
          ...(editingId && editBase ? { expectedUpdatedAt: editBase } : {}),
        }),
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

  // Sunucu sayfası (kurucu 11-19 akşam madde 1): liste en çok `pageSize` satır; arama ve sayfa adreste (`?q=…&sayfa=N`, gelen kutusu kalıbı).
  const totalPages = Math.max(1, Math.ceil(view.matchCount / view.pageSize));
  const from = customTemplates.length === 0 ? 0 : (view.page - 1) * view.pageSize + 1;
  const to = customTemplates.length === 0 ? 0 : (view.page - 1) * view.pageSize + customTemplates.length;
  const hrefFor = (page: number) => {
    const qs = new URLSearchParams();
    if (view.query) qs.set("q", view.query);
    if (page > 1) qs.set("sayfa", String(page));
    const s = qs.toString();
    return s ? `/templates?${s}` : "/templates";
  };
  const showPager = totalPages > 1 || (view.query !== "" && view.matchCount > 0);
  const pagerBar = (position: "üst" | "alt") => (
    <Pager
      page={view.page}
      totalPages={totalPages}
      summary={
        totalPages > 1
          ? `${view.matchCount} şablondan ${from}–${to} arası · Sayfa ${view.page} / ${totalPages}`
          : `${view.matchCount} şablon`
      }
      hrefFor={hrefFor}
      position={position}
    />
  );

  return (
    <div className="space-y-6">
      {/* Custom Templates Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Özel Şablonlar ({allCount})</h2>
        {canManage ? (
          <Button size="sm" onClick={() => {
            if (showForm && !editingId && !adaptedFrom) {
              openSeq.current++;
              setShowForm(false);
            } else openNew();
          }}>
            <Plus className="size-4" />
            Yeni Şablon
          </Button>
        ) : null}
      </div>

      {/* Sınır satırı (Ş-2): %90'da uyarı, sınırda bugünkü sınır metni — tek satır, sunucunun kurduğu metin. */}
      {capNotice ? (
        <p className="rounded-md border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          {capNotice}
        </p>
      ) : null}

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
                  <Field label="Daire (opsiyonel)" htmlFor="tmpl-property">
                    <Select
                      id="tmpl-property"
                      value={form.propertyId}
                      onChange={(e) => setF("propertyId", e.target.value)}
                    >
                      <option value="">Tüm daireler</option>
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
                      openSeq.current++;
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

      {/* Arama — sunucuda, işletmenin BÜTÜN şablonlarında (liste yalnız bir sayfa taşır). Gelen kutusu arama formunun kalıbı: GET formu,
          gizli etiket (yer tutucu ad değildir), "Ara" düğmesi, arama varken temizle bağlantısı. */}
      {allCount > 0 ? (
        <form method="GET" action="/templates" role="search" className="flex flex-nowrap items-center gap-1.5">
          <label htmlFor="tmpl-search" className="sr-only">
            Şablonlarda ara
          </label>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              id="tmpl-search"
              name="q"
              type="search"
              defaultValue={view.query}
              maxLength={100}
              placeholder="Başlıkta veya metinde ara…"
              className="h-10 w-full rounded-md border border-border bg-card pl-8 pr-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background sm:h-8"
            />
          </div>
          <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
            Ara
          </button>
          {view.query ? (
            <Link
              href="/templates"
              aria-label="Aramayı temizle"
              title="Aramayı temizle"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "shrink-0 px-2 text-muted-foreground")}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </form>
      ) : null}

      {/* Custom Template List */}
      {allCount === 0 && !showForm ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Henüz özel şablon oluşturulmadı.
            {canManage ? " Yukarıdaki butonla sıfırdan yazabilir ya da aşağıdaki varsayılanlardan birini kendinize uyarlayabilirsiniz." : ""}
          </CardContent>
        </Card>
      ) : customTemplates.length === 0 && view.query ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            “{view.query}” ile eşleşen şablon bulunamadı.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {showPager && totalPages > 1 ? pagerBar("üst") : null}
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
                          <Globe className="size-3" /> Tüm daireler
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground/80 line-clamp-3">{t.preview}</p>
                  </div>
                  {canManage ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void openEdit(t)}
                        disabled={openingId !== null}
                        aria-busy={openingId === t.id}
                        className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                        aria-label="Düzenle"
                      >
                        {openingId === t.id ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
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
          {showPager ? pagerBar("alt") : null}
        </div>
      )}

      {/* Default Templates */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setExpandedDefaults((s) => !s)}
          aria-expanded={expandedDefaults}
          className="-my-1.5 flex items-center gap-2 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
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
                        <Badge tone="muted">Varsayılan</Badge>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground line-clamp-3">{t.body}</p>
                    </div>
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => openAdapt(t)}
                        className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground sm:min-h-0"
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
