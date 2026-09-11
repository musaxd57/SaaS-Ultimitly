"use client";

import { useRef, useState, useTransition } from "react";
import { FormError } from "@/components/form-error";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, ToggleLeft, ToggleRight, Copy, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/form-field";
import { KB_CATEGORY } from "@/lib/constants";
import { KbGapsPanel, type KbGapView } from "@/components/knowledge/kb-gaps-panel";
import { KbImportText } from "@/components/knowledge/kb-import-text";
import { KbPastAnswers } from "@/components/knowledge/kb-past-answers";
import { cn } from "@/lib/utils";
// YAPRAK modülden: `prompts.ts` (75 KB sistem promptu) tarayıcı paketinin
// bağımlılık grafiğine ASLA girmemeli — depo tam da o dosya yüzünden private.
import { KB_ITEM_CAP } from "@/lib/ai/limits";

// Categories whose content is auto-sent verbatim to the guest (vs. read-only
// facts the AI uses to answer questions). Only used to group the dropdown.
const TRIGGER_CATEGORIES = new Set(["welcome", "checkin", "checkout"]);
const triggerOptions = KB_CATEGORY.options.filter((o) => TRIGGER_CATEGORIES.has(o.value));
const infoOptions = KB_CATEGORY.options.filter((o) => !TRIGGER_CATEGORIES.has(o.value));

// One-click starter templates. Clicking one only PREFILLS the form — nothing is
// saved until the host reviews, replaces the [brackets] and presses "Ekle".
// The AI answers only from what's in the KB, so an empty KB = a weak product;
// these lower the cost of the first 10 minutes of setup.
const KB_PRESETS: { key: string; label: string; category: string; title: string; content: string }[] = [
  {
    key: "wifi",
    label: "Wi-Fi",
    category: "wifi",
    title: "Wi-Fi bilgisi",
    content: "Ağ adı (SSID): [AĞ ADI]\nŞifre: [ŞİFRE]\nModem salonda, TV ünitesinin yanındadır. Bağlantı sorunu olursa modemi 10 saniye kapatıp açmayı deneyebilirsiniz.",
  },
  {
    key: "checkin",
    label: "Giriş talimatı",
    category: "checkin",
    title: "Giriş talimatı",
    content: "Giriş saati: [15:00] ve sonrasıdır.\nAdres: [AÇIK ADRES]\nBinaya girişte [ZİL / KAPI KODU TARİFİ]. Daire [KAT] katta, kapı no [NO].\nAnahtar: [ANAHTAR TESLİM ŞEKLİ — ör. kapıdaki şifreli anahtar kutusu; kodu size giriş günü ayrıca iletilir].\nSorun yaşarsanız bize bu kanaldan yazabilirsiniz.",
  },
  {
    key: "parking",
    label: "Otopark",
    category: "parking",
    title: "Otopark",
    content: "[Bina önünde ücretsiz sokak parkı mevcuttur / En yakın otopark: [OTOPARK ADI], yürüme mesafesi [X] dk, günlük yaklaşık ücret [₺Y]].",
  },
  {
    key: "trash",
    label: "Çöp",
    category: "trash",
    title: "Çöp ve geri dönüşüm",
    content: "Çöpleri ağzı bağlı poşetle [ÇÖP NOKTASI TARİFİ — ör. binanın yan sokağındaki konteyner]'a bırakabilirsiniz. Geri dönüşüm kutusu [VARSA YERİ].",
  },
  {
    key: "rules",
    label: "Ev kuralları",
    category: "rules",
    title: "Ev kuralları",
    content: "Dairede sigara içilmez.\nEvcil hayvan [kabul edilir / kabul edilmez].\nSaat 22:00'den sonra lütfen gürültü yapmayınız (bina sakinleri için).\nParti / etkinlik düzenlenemez.\nMisafir sayısı rezervasyonda belirtilen kişi sayısını aşamaz.",
  },
  {
    key: "checkout",
    label: "Çıkış mesajı",
    category: "checkout",
    title: "Çıkış hatırlatması",
    content: "Çıkış saati [11:00]'dir. Ayrılırken pencereleri kapatmanız, klimayı/ısıtıcıyı kapatmanız ve anahtarı [ANAHTAR BIRAKMA YERİ]'ne bırakmanız yeterli. Bizi tercih ettiğiniz için teşekkürler, tekrar bekleriz!",
  },
];

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
  gaps = [],
}: {
  properties: { id: string; name: string }[];
  items: KbItem[];
  /** A3 — "Kurulum ve eksikler" satırları (salt-okuma; boşsa panel çizilmez). */
  gaps?: KbGapView[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // Long entries (check-in instructions etc.) are CLAMPED to a preview by
  // default so the list stays scannable; per-item toggle expands in place.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [form, setForm] = useState({
    propertyId: properties[0]?.id ?? "",
    category: "general",
    title: "",
    content: "",
    language: "tr",
  });

  const titleRef = useRef<HTMLInputElement>(null);

  /**
   * A4 — eksik satırından forma. Şablon VARSA metni de gelir, YOKSA yalnız mülk
   * ve kategori seçilir (uydurma içerik yazmaktansa boş bırakmak doğru: host'un
   * kendi gerçeğini yazması gerekiyor).
   *
   * 🚨 HİÇBİR ŞEY KAYDEDİLMEZ. Bu düğme yalnız formu doldurur — "host onayından
   * önce aktifleşmesin" şartının UI karşılığı, `KB_PRESETS` ile aynı sözleşme.
   */
  function fillFromGap(propertyId: string, category: string) {
    const preset = KB_PRESETS.find((p) => p.category === category);
    setForm((f) => ({
      ...f,
      propertyId,
      category,
      title: preset?.title ?? f.title,
      content: preset?.content ?? f.content,
    }));
    setError(null);
    // Form sayfanın solunda; küçük ekranda listenin ALTINDA kalıyor. Odak
    // taşınmazsa host düğmeye basar ve hiçbir şey olmamış gibi görünür.
    const el = titleRef.current;
    el?.focus();
    // ⚠️ KORUMALI: `scrollIntoView` her ortamda YOK (jsdom'da tanımsız; kısıtlı
    // tarayıcılarda da eksik olabilir). Korumasız çağrı FIRLATIYORDU — tam suit
    // bunu 3 "unhandled error" olarak yakaladı. Kaydırma bir KONFOR; yokluğu
    // doldurma işini BOZMAMALI.
    if (typeof el?.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

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
        // `badRequest` alan hatalarını `fields` altına koyar ve `error` sabit
        // "Doğrulama hatası"dır — yalnız onu okumak, plan sınırı gibi ÖZELLİKLE
        // yazılmış açıklayıcı mesajları çöpe atıyordu (düzenleme yolu bunu baştan
        // doğru yapıyordu, ekleme yolu yapmıyordu).
        const field = data.fields ? Object.values(data.fields)[0] : null;
        setError((typeof field === "string" ? field : null) ?? data.error ?? "Bilgi eklenemedi");
        return;
      }
      setForm((f) => ({ ...f, title: "", content: "" }));
      refresh();
    } catch {
      setError("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(item: KbItem) {
    setBusyId(item.id);
    setListError(null);
    try {
      const res = await fetch(`/api/kb/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      if (!res.ok) {
        // "Tekrar deneyin" burada ZARARLI bir tavsiyeydi: aktifleştirme plan
        // sınırına takıldıysa tekrar denemek ASLA işe yaramaz — host sonsuz bir
        // döngüye giriyordu. Rota gerçek sebebi `fields`'ta gönderiyor.
        const data = await res.json().catch(() => ({}));
        const field = data.fields ? Object.values(data.fields)[0] : null;
        setListError(
          (typeof field === "string" ? field : null) ??
            data.error ??
            "Bilgi güncellenemedi. Lütfen tekrar deneyin.",
        );
      } else {
        // Görünür geri bildirim (kurucu, 09-08): geçiş sessizdi, yalnız küçük ikon
        // değişiyordu. Ortak toast yüzeyi (bottom-right, otomatik kapanır). Yalnız
        // BAŞARIDA — rota reddettiyse "oldu" iddiası yapılmaz (hata listede).
        // İKİ EYLEM AYRI TİPTE (kurucu, 09-08): aktifleştirme bir kazanım
        // (success), pasifleştirme nötr bir durum değişikliği (info). İkisi de
        // yeşil olunca "ne oldu?" ayırt edilemiyordu.
        if (item.isActive) toast.info("Bilgi pasifleştirildi.");
        else toast.success("Bilgi aktifleştirildi.");
        refresh();
      }
    } catch {
      setListError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    const ok = await confirmDialog({
      title: "Bu bilgiyi silmek istiyor musunuz?",
      body: "AI bundan sonra bu bilgiyi cevaplarında kullanamaz.",
      confirmLabel: "Sil",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(id);
    setListError(null);
    try {
      const res = await fetch(`/api/kb/${id}`, { method: "DELETE" });
      if (!res.ok) setListError("Bilgi silinemedi. Lütfen tekrar deneyin.");
      else refresh();
    } catch {
      setListError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusyId(null);
    }
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
        const field = data.fields ? Object.values(data.fields)[0] : null;
        setCopyMsg((typeof field === "string" ? field : null) ?? data.error ?? "Kopyalanamadı");
        return;
      }
      // Kısmi başarı: sınırı dolmuş daireler atlanmış olabilir. Sessizce
      // "başarılı" demek, host'un olmayan bir kaydı var sanmasına yol açardı.
      if (typeof data.notice === "string") {
        setCopyMsg(data.notice);
        refresh();
        return;
      }
      setCopyId(null);
      refresh();
    } catch {
      setCopyMsg("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
    } finally {
      setCopying(false);
    }
  }

  // --- Edit an entry (category / title / content) --------------------------
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ category: "general", title: "", content: "" });
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit(item: KbItem) {
    setCopyId(null);
    setEditId(item.id);
    setEditForm({ category: item.category, title: item.title, content: item.content });
    setEditError(null);
  }

  async function saveEdit(id: string) {
    setEditBusy(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/kb/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // `_` de dahil HER alan hatası okunur: plan sınırı mesajı `fields._`
        // altında geliyor ve eski iki-alanlık liste onu kaçırıyordu.
        const field = data.fields
          ? (data.fields.content ?? data.fields.title ?? Object.values(data.fields)[0])
          : null;
        setEditError((typeof field === "string" ? field : null) ?? data.error ?? "Kaydedilemedi");
        return;
      }
      setEditId(null);
      refresh();
    } catch {
      setEditError("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
    } finally {
      setEditBusy(false);
    }
  }

  const grouped = properties
    .map((p) => ({ property: p, list: items.filter((i) => i.propertyId === p.id) }))
    .filter((g) => g.list.length > 0);

  return (
    <div className="space-y-4">
      <KbGapsPanel gaps={gaps} onFill={fillFromGap} />
      <KbPastAnswers />
      <KbImportText properties={properties} />
      <div className="grid gap-4 lg:grid-cols-3">
      {/* Create — self-start: grid satırı sağdaki uzun mülk listesi kadar uzar;
          form kartı içeriği kadar kalmalı, en aşağıya kadar sündürülmemeli.
          min-w-0: grid çocuğunun varsayılan `min-width:auto`u sütunu içeriğin
          min-content'ine kilitler (↓aşağıdaki liste sütununun yorumu). */}
      <Card className="min-w-0 lg:col-span-1 lg:self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4 text-muted-foreground" /> Yeni Bilgi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-3">
            {error ? (
              <FormError>{error}</FormError>
            ) : null}
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Hazır şablonla başlayın (formu doldurur, siz düzenleyip eklersiniz):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {KB_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, category: p.category, title: p.title, content: p.content }))
                    }
                    className="rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:bg-accent"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Mülk" htmlFor="kb-property">
              <Select id="kb-property" value={form.propertyId} onChange={(e) => set("propertyId", e.target.value)} required>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Kategori" htmlFor="kb-category">
              <Select id="kb-category" value={form.category} onChange={(e) => set("category", e.target.value)}>
                <optgroup label="Otomatik gönderilen mesajlar">
                  {triggerOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
                <optgroup label="AI'ın yanıtlarken kullandığı bilgiler">
                  {infoOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
              </Select>
              {TRIGGER_CATEGORIES.has(form.category) ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Bu metin misafire otomatik gönderilir.
                </p>
              ) : null}
            </Field>
            <Field label="Başlık" htmlFor="kb-title">
              <Input ref={titleRef} id="kb-title" value={form.title} onChange={(e) => set("title", e.target.value)} required />
            </Field>
            <Field label="İçerik" htmlFor="kb-content">
              <Textarea id="kb-content" value={form.content} onChange={(e) => set("content", e.target.value)} required />
              {form.content.includes("[") ? (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  Köşeli parantezli [alanları] kendi bilgilerinizle değiştirmeyi unutmayın.
                </p>
              ) : null}
              {form.category === "checkin" || form.category === "checkout" ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Not: Giriş/çıkış <strong>saatini</strong> buraya sabitlemenize gerek yok — saat, mülk
                  sayfasındaki “Check-in / Check-out saati” alanından gelir ve yapay zekâ soru gelince
                  <strong> oradaki saati</strong> esas alır. Burada adres, kapı kodu, anahtar ve
                  prosedürlere odaklanın.
                </p>
              ) : null}
            </Field>
            <Button type="submit" className="w-full" disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Ekle
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      {/* min-w-0 ZORUNLU: bu sütunun min-content'i 361 px (rozet + başlık +
          4 aksiyon düğmesi `min-w-[40px]`), 360 px'lik telefonda kaba
          sığmıyor ve `min-width:auto` yüzünden sütun küçülmeyi REDDEDİP
          SAYFAYI YATAY KAYDIRIYORDU (ölçüldü: scrollWidth 376 → 360).
          Metin kırpılmıyor, satır başlıkları sarıyor. */}
      <div className="min-w-0 space-y-4 lg:col-span-2">
        {listError ? (
          <FormError>{listError}</FormError>
        ) : null}
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
                {/* SESSİZ KESME OLMASIN: AI tek yanıtta en fazla KB_ITEM_CAP kalem
                    okur. Bunu söylemezsek host, AI'nın bilmediği bir bilgiyi
                    "eklemiştim" sanır ve yanlış cevabın sebebini asla bulamaz. */}
                {list.filter((i) => i.isActive).length > KB_ITEM_CAP ? (
                  <p className="rounded-md border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                    Bu dairede <strong>{list.filter((i) => i.isActive).length}</strong> aktif bilgi
                    var; AI bir yanıtta <strong>en fazla {KB_ITEM_CAP}</strong> tanesini okur (en son
                    güncellenenler önce). Kullanılmayanları pasife alın ya da birkaç kısa kaydı tek
                    kayıtta birleştirin — böylece AI&apos;nın neyi gördüğü belirsiz kalmaz.
                  </p>
                ) : null}
                {list.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      {/* min-w-0: sağdaki 4 aksiyon düğmesi `min-w-[40px]` ile
                          SABİT (~171 px). Bu grup küçülemezse 360 px'de ikisi
                          birden satıra sığmıyor ve düğmeler kartın kenarından
                          31 px TAŞIYORDU (ölçüldü; min-w-0 ile taşma 0).
                          Başlık kırpılmaz, sarar. */}
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge tone={KB_CATEGORY.tone(item.category)}>
                          {KB_CATEGORY.label(item.category)}
                        </Badge>
                        <span className="text-sm font-medium">{item.title}</span>
                        {!item.isActive ? <Badge tone="muted">Pasif</Badge> : null}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          // TOGGLE (kurucu, 09-08): kalem açıkken tekrar tıklamak
                          // düzenlemeyi KAPATIR. Eskiden yalnız açıyordu; kapatmak
                          // için "İptal"i bulmak gerekiyordu.
                          onClick={() => (editId === item.id ? setEditId(null) : startEdit(item))}
                          className={cn(
                            "inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded p-2.5 text-muted-foreground hover:bg-accent",
                            editId === item.id && "bg-accent text-foreground",
                          )}
                          aria-label="Düzenle"
                          title="Düzenle"
                        >
                          <Pencil className="size-4" />
                        </button>
                        {otherProps(item).length > 0 ? (
                          <button
                            type="button"
                            onClick={() => openCopy(item)}
                            className={cn(
                              "inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded p-2.5 text-muted-foreground hover:bg-accent",
                              copyId === item.id && "bg-accent text-foreground",
                            )}
                            aria-label="Diğer dairelere kopyala"
                            title="Diğer dairelere kopyala"
                          >
                            <Copy className="size-4" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => toggleActive(item)}
                          disabled={busyId === item.id}
                          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded p-2.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
                          aria-label={item.isActive ? "Pasifleştir" : "Aktifleştir"}
                          title={item.isActive ? "Pasifleştir" : "Aktifleştir"}
                        >
                          {item.isActive ? <ToggleRight className="size-4 text-emerald-600 dark:text-emerald-400" /> : <ToggleLeft className="size-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(item.id)}
                          disabled={busyId === item.id}
                          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded p-2.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
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
                    {editId === item.id ? (
                      <div className="mt-2.5 space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
                        {editError ? (
                          <p className="text-xs text-destructive">{editError}</p>
                        ) : null}
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Field label="Kategori" htmlFor={`edit-cat-${item.id}`}>
                            <Select
                              id={`edit-cat-${item.id}`}
                              value={editForm.category}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, category: e.target.value }))
                              }
                            >
                              <optgroup label="Otomatik gönderilen mesajlar">
                                {triggerOptions.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label="AI'ın yanıtlarken kullandığı bilgiler">
                                {infoOptions.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </optgroup>
                            </Select>
                          </Field>
                          <Field label="Başlık" htmlFor={`edit-title-${item.id}`}>
                            <Input
                              id={`edit-title-${item.id}`}
                              value={editForm.title}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, title: e.target.value }))
                              }
                            />
                          </Field>
                        </div>
                        <Field label="İçerik" htmlFor={`edit-content-${item.id}`}>
                          <Textarea
                            id={`edit-content-${item.id}`}
                            rows={6}
                            value={editForm.content}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, content: e.target.value }))
                            }
                          />
                        </Field>
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => saveEdit(item.id)} disabled={editBusy}>
                            {editBusy ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                            Kaydet
                          </Button>
                          {/* İPTAL BİR BUTON (kurucu, 09-08): link gibi duruyordu ve
                              "Kaydet"in yanında kaybolmuştu. Aynı yükseklik, ikincil
                              görünüm — birincil eylemle karışmaz ama tıklanabilir olduğu
                              görünür. */}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setEditId(null)}
                            disabled={editBusy}
                          >
                            <X className="size-3.5" /> İptal
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p
                          className={cn(
                            // ⚠️ `text-foreground/90` — bu metni HOST KENDİ YAZDI ve sayfanın asıl
                            // içeriği o. `text-muted-foreground` ikincil/yardımcı metin
                            // rengidir; kalemin gövdesini onunla çizmek, kullanıcının
                            // girdiği veriyi çevresindeki açıklamalarla aynı ağırlığa
                            // düşürüyordu (kullanıcı: "belirginliği artabilir").
                            "mt-1.5 whitespace-pre-wrap text-sm text-foreground/90",
                            !expandedIds.has(item.id) && "line-clamp-3",
                          )}
                        >
                          {item.content}
                        </p>
                        {/* Rough proxy for "would clamp": long or multi-line content. */}
                        {item.content.length > 160 || item.content.includes("\n") ? (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(item.id)}
                            className="mt-1 text-xs font-medium text-primary hover:underline"
                          >
                            {expandedIds.has(item.id) ? "Daralt" : "Devamını göster"}
                          </button>
                        ) : null}
                      </>
                    )}

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
    </div>
  );
}
