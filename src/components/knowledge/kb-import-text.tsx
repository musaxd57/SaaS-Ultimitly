"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, Loader2, Settings2, SkipForward } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FormError } from "@/components/form-error";
import { Field } from "@/components/form-field";
import { KB_CATEGORY } from "@/lib/constants";
import { toast } from "@/lib/toast";
import { extractKbSuggestions, type KbExtraction, type SkipReason } from "@/lib/kb-extract";

// ---------------------------------------------------------------------------
// A5 — "Metinden bilgi çıkar" (09-08). Host elindeki metni yapıştırır, ürün
// TASLAK öneri üretir, host seçtiklerini ekler.
//
// 🚨 ÇIKARIM TARAYICIDA YAPILIR. Sunucuya yalnız host'un KABUL ETTİĞİ kalemler
// gider; reddettiği metin hiçbir yere yazılmaz, hiçbir yere gönderilmez.
//
// 🚨 ÖNCE GÖSTER, SONRA YAZ — `.ics` "Dosyadan içe aktar" ile aynı emsal.
// Önizleme hiçbir şey kaydetmez; "Ekle" tek tek mevcut `POST /api/kb` yolundan
// geçer, yani plan sınırları · doğrulama · mülk hafızası eşitlemesi AYNEN
// çalışır. Bu rota yeniden yazılmadı: kaçış yolu açmamak için bilinçli.
//
// 🚨 ATLANANLAR GÖRÜNÜR. Yer tutuculu (`{isim}`, `[ŞİFRE]`) satırlar öneriye
// dönüşmez; ama "sessizce yutuldu" da olmaz — kaç satırın neden atlandığı
// yazılır. Aksi hâlde host, yapıştırdığı bilginin girdiğini SANIR.
// ---------------------------------------------------------------------------

const SKIP_TEXT: Record<SkipReason, string> = {
  placeholder: "içinde doldurulmamış yer tutucu var ({isim}, [ŞİFRE] gibi)",
  too_long: "çok uzun",
  duplicate: "aynı bilgi zaten önerildi (çelişen ikinci değer)",
};

const FIELD_TEXT: Record<string, string> = {
  checkInTime: "Giriş saati",
  checkOutTime: "Çıkış saati",
};

export function KbImportText({ properties }: { properties: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [preview, setPreview] = useState<KbExtraction | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function runPreview() {
    const result = extractKbSuggestions(text);
    setPreview(result);
    // Varsayılan: hepsi seçili. Host çıkarmak isterse işareti kaldırır —
    // eklemek isterse tek tek işaretlemekten daha az iş.
    setSelected(new Set(result.items.map((i) => i.category)));
    setError(null);
  }

  function reset() {
    setText("");
    setPreview(null);
    setSelected(new Set());
    setError(null);
  }

  async function apply() {
    if (!preview) return;
    const chosen = preview.items.filter((i) => selected.has(i.category));
    if (chosen.length === 0) return;
    setBusy(true);
    setError(null);
    let created = 0;
    const failed: string[] = [];
    try {
      for (const item of chosen) {
        // TEK TEK: mevcut rotanın plan sınırı ve doğrulaması her kalem için
        // ayrı çalışsın. Toplu bir yol açmak o kapıları atlamak olurdu.
        const res = await fetch("/api/kb", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            propertyId,
            category: item.category,
            title: item.title,
            content: item.content,
            language: "tr",
            isActive: true,
          }),
        });
        if (res.ok) created++;
        else failed.push(KB_CATEGORY.label(item.category));
      }
    } catch {
      setError("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
      setBusy(false);
      return;
    }
    setBusy(false);
    // KISMİ BAŞARI DÜRÜSTÇE: kaçı eklendi, kaçı eklenemedi — "hepsi oldu" demek
    // host'un olmayan bir bilgiye güvenmesine yol açardı.
    if (created > 0) toast.success(`${created} bilgi eklendi.`);
    if (failed.length > 0) setError(`Eklenemedi: ${failed.join(", ")}. Plan sınırınıza takılmış olabilir.`);
    if (failed.length === 0) reset();
    router.refresh();
  }

  if (properties.length === 0) return null;

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <ClipboardPaste className="size-4 text-muted-foreground" /> Metinden bilgi çıkar
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "Kapat" : "Aç"}
          </Button>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Elinizdeki metni (karşılama mesajı, ev rehberi, ilan açıklaması) yapıştırın; hangi bilgilerin
          kaydedilebileceğini <strong>kaydetmeden önce</strong> gösterelim. Seçtikleriniz eklenir, gerisi atılır.
        </p>
      </CardHeader>
      {open ? (
        <CardContent className="space-y-3">
          {error ? <FormError>{error}</FormError> : null}
          <Field label="Mülk" htmlFor="kb-import-property">
            <Select
              id="kb-import-property"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Metin" htmlFor="kb-import-text">
            <Textarea
              id="kb-import-text"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Çıkış saati 11:00'dir.\nÇöpleri binanın yan sokağındaki konteynere bırakabilirsiniz.\nOtopark bina altındadır."}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={runPreview} disabled={!text.trim()}>
              Önizle
            </Button>
            {preview ? (
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                Temizle
              </Button>
            ) : null}
          </div>

          {preview ? (
            <div className="space-y-3 rounded-lg border border-border p-3">
              {preview.truncated ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Metin çok uzundu; yalnız ilk bölümü okundu.
                </p>
              ) : null}

              {preview.items.length === 0 && preview.fields.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Bu metinden kaydedilebilir bir bilgi çıkaramadık. Doğrudan formu kullanabilirsiniz.
                </p>
              ) : null}

              {preview.items.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Eklenecek bilgiler (seçin):</p>
                  {preview.items.map((i) => (
                    <label key={i.category} className="flex items-start gap-2 rounded border border-border p-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.has(i.category)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(i.category);
                            else next.delete(i.category);
                            return next;
                          })
                        }
                        aria-label={`${KB_CATEGORY.label(i.category)} bilgisini ekle`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <Badge tone={KB_CATEGORY.tone(i.category)}>{KB_CATEGORY.label(i.category)}</Badge>
                          <span className="text-xs text-muted-foreground">satır {i.lines.join(", ")}</span>
                        </span>
                        <span className="mt-1 block whitespace-pre-wrap text-xs">{i.content}</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}

              {preview.fields.length > 0 ? (
                <div className="space-y-1 rounded border border-dashed border-border p-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Settings2 className="size-3.5" /> Bunlar mülk ayarlarında tutulur — bilgi kaydı olarak
                    eklenmez:
                  </p>
                  {preview.fields.map((f) => (
                    <p key={f.target} className="text-xs">
                      <strong>{FIELD_TEXT[f.target] ?? f.target}:</strong> {f.value}{" "}
                      <span className="text-muted-foreground">
                        (satır {f.line}) — mülk sayfasından güncelleyebilirsiniz.
                      </span>
                    </p>
                  ))}
                </div>
              ) : null}

              {preview.skipped.length > 0 ? (
                <details className="text-xs">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                    <SkipForward className="size-3.5" /> {preview.skipped.length} satır atlandı
                  </summary>
                  <ul className="mt-1 space-y-1">
                    {preview.skipped.map((s) => (
                      <li key={`${s.line}`} className="text-muted-foreground">
                        <strong>Satır {s.line}:</strong> {SKIP_TEXT[s.reason]} — “{s.excerpt}”
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {preview.items.length > 0 ? (
                <Button type="button" size="sm" onClick={apply} disabled={busy || selected.size === 0}>
                  {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                  Seçilenleri ekle ({selected.size})
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
