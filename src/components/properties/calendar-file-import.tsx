"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, FileUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// DOSYADAN İÇE AKTAR — tek seferlik `.ics` aktarımı (Codex, 2026-09-08).
//
// URL senkronizasyonundan (CalendarSources) AYRI bir yüzey ve bunu AÇIKÇA söyler:
// bir kez okunur, tekrarlanmaz, dosyada bulunmayan kayıtlar iptal edilmez.
//
// İKİ ADIM, BİLİNÇLİ: dosya seçilince önce ÖNİZLEME istenir (`mode=preview`,
// sunucuda hiçbir yazma yok) → host hangi mülke kaç kaydın ekleneceğini /
// güncelleneceğini / iptal edileceğini / atlanacağını (ve nedenini) kaydetmeden
// görür → sonra "İçe aktar" gerçek aktarımı yapar. Sınıflandırma sunucudadır;
// bu bileşen yalnız gösterir (tek doğruluk kaynağı = rota).
// ---------------------------------------------------------------------------

interface PreviewRow {
  line: number;
  uid: string | null;
  guestName: string | null;
  arrival: string | null;
  departure: string | null;
  action: "create" | "update" | "cancel" | "skip";
  reason: string | null;
  error: string | null;
}
interface PreviewResponse {
  preview: true;
  property: { id: string; name: string };
  counts: { create: number; update: number; cancel: number; skipped: number };
  /** Dosya eksik okunduysa sade uyarı (F16); tam okumada null. */
  note?: string | null;
  total: number;
  rows: PreviewRow[];
}
interface ImportResult {
  imported: number;
  updated: number;
  cancelled: number;
  skipped: number;
  errors: string[];
  note?: string | null;
}

/** Sunucunun atlama gerekçeleri → host'un anlayacağı tek cümle. */
const REASON_TEXT: Record<string, string> = {
  owned_by_feed: "takvim bağlantısına ait (dosya dokunmaz)",
  owned_by_other: "başka kaynağa ait kayıt (dosya dokunmaz)",
  unchanged: "değişiklik yok",
  duplicate: "zaten kayıtlı",
  cancelled_stays: "kayıt iptalli kalır (dosya geri açmaz)",
  cancel_no_match: "iptal edilecek kayıt bulunamadı",
  cancel_already: "kayıt zaten iptalli",
  cancel_no_ref: "iptal satırında kimlik (UID) yok",
  erased: "silme talebi nedeniyle içe aktarılamaz",
  invalid_guest: "misafir adı eksik",
  invalid_arrival: "giriş tarihi geçersiz",
  invalid_departure: "çıkış tarihi geçersiz",
  invalid_range: "çıkış tarihi girişten önce",
};

const ACTION_TEXT: Record<PreviewRow["action"], string> = {
  create: "Eklenecek",
  update: "Güncellenecek",
  cancel: "İptal edilecek",
  skip: "Atlanacak",
};

// `propertyName` prop OLARAK ALINMAZ: önizlemede gösterilen ad SUNUCUNUN
// döndürdüğü addır (`preview.property.name`) — dosyanın hangi mülke
// yazılacağını istemcinin kendi metni değil, yazacak olan taraf söyler.
export function CalendarFileImport({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function errorTextFrom(data: unknown): string {
    const d = data as { fields?: Record<string, string>; error?: string } | null;
    if (d?.fields) {
      const first = Object.values(d.fields)[0];
      if (typeof first === "string") return first;
    }
    return d?.error ?? "Dosya okunamadı.";
  }

  async function askPreview(selected: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setPreview(null);
    try {
      const form = new FormData();
      form.set("file", selected);
      form.set("propertyId", propertyId);
      form.set("mode", "preview");
      const res = await fetch("/api/reservations/import", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorTextFrom(data));
        setFile(null);
        return;
      }
      setFile(selected);
      setPreview(data as PreviewResponse);
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
      setFile(null);
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("propertyId", propertyId);
      const res = await fetch("/api/reservations/import", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorTextFrom(data));
        return;
      }
      setResult(data as ImportResult);
      setPreview(null);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  const actionable = preview ? preview.counts.create + preview.counts.update + preview.counts.cancel : 0;

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
      <p className="text-xs text-muted-foreground">
        <strong className="font-medium text-foreground">Tek seferlik aktarım.</strong> Elinizdeki bir{" "}
        <code>.ics</code> dosyasını (başka bir sistemden dışa aktarım) bir kez okur. Yukarıdaki takvim
        bağlantısından farklıdır: düzenli senkronizasyon yapmaz, tekrar okunmaz. Dosyada bulunmayan eski
        rezervasyonlar sırf eksik diye iptal edilmez.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer?.files?.[0];
          if (dropped) void askPreview(dropped);
        }}
        className={`rounded-lg border border-dashed p-3 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border"
        }`}
      >
        <label className="flex cursor-pointer flex-col items-center gap-1 text-xs text-muted-foreground">
          <FileUp className="size-5" />
          <span>
            <span className="font-medium text-foreground">.ics dosyasını sürükleyin</span> veya seçmek için tıklayın
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".ics"
            aria-label=".ics dosyası seç"
            className="sr-only"
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (selected) void askPreview(selected);
            }}
          />
        </label>
      </div>

      {busy && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> İşleniyor…
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {preview && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 text-xs">
              <p>
                Aktarılacak mülk: <strong className="font-medium">{preview.property.name}</strong>
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {preview.counts.create} eklenecek · {preview.counts.update} güncellenecek ·{" "}
                {preview.counts.cancel} iptal edilecek · {preview.counts.skipped} atlanacak
                {preview.total > preview.rows.length ? ` (ilk ${preview.rows.length} satır listelendi)` : ""}
              </p>
              {preview.note ? (
                <p role="status" className="mt-1 text-amber-700 dark:text-amber-400">
                  {preview.note}
                </p>
              ) : null}
            </div>
            <Button variant="ghost" size="sm" onClick={reset} title="Vazgeç">
              <X className="size-4" /> Vazgeç
            </Button>
          </div>

          <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
            {preview.rows.map((r) => (
              <li key={r.line} className="flex flex-wrap items-baseline gap-x-2 border-b border-border/50 pb-1">
                <span
                  className={
                    r.action === "cancel"
                      ? "font-medium text-destructive"
                      : r.action === "skip"
                        ? "text-muted-foreground"
                        : "font-medium text-foreground"
                  }
                >
                  {ACTION_TEXT[r.action]}
                </span>
                <span className="truncate">{r.guestName ?? "—"}</span>
                <span className="text-muted-foreground">
                  {r.arrival ?? "?"} → {r.departure ?? "?"}
                </span>
                {r.error ? (
                  <span className="text-destructive">{r.error}</span>
                ) : r.reason ? (
                  <span className="text-muted-foreground">({REASON_TEXT[r.reason] ?? r.reason})</span>
                ) : null}
              </li>
            ))}
          </ul>

          <Button size="sm" className="w-full" onClick={runImport} disabled={busy || actionable === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            İçe aktar
          </Button>
          {actionable === 0 && (
            <p className="text-xs text-muted-foreground">Bu dosyada yapılacak bir değişiklik yok.</p>
          )}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-border p-3 text-xs">
          <p>
            <strong className="font-medium">{result.imported} eklendi</strong> · {result.updated} güncellendi ·{" "}
            {result.cancelled} iptal edildi · {result.skipped} atlandı
          </p>
          {result.note ? <p className="mt-1 text-amber-700 dark:text-amber-400">{result.note}</p> : null}
          {result.errors.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-destructive">
              {result.errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
