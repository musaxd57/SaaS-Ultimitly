"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Property {
  id: string;
  name: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

interface Props {
  properties: Property[];
}

export function ImportForm({ properties }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function close() {
    reset();
    setOpen(false);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setResult(null);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !propertyId) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("propertyId", propertyId);

      const res = await fetch("/api/reservations/import", {
        method: "POST",
        body: fd,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.propertyId ?? data?.file ?? "İçe aktarma başarısız oldu.");
        return;
      }

      setResult(data as ImportResult);
      router.refresh();
    } catch {
      setError("Ağ hatası. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="size-4" /> İçe Aktar
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-base font-semibold">Rezervasyon İçe Aktar</h2>
              <button
                onClick={close}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleSubmit} className="space-y-4 p-5">
              {/* Property selector */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Mülk</label>
                {properties.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Önce bir mülk oluşturun.</p>
                ) : (
                  <Select
                    value={propertyId}
                    onChange={(e) => setPropertyId(e.target.value)}
                    className="w-full"
                  >
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                )}
              </div>

              {/* File input */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Dosya</label>
                <div
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors",
                    file ? "border-primary/60 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-accent/30",
                  )}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="size-8 text-muted-foreground" />
                  {file ? (
                    <span className="text-sm font-medium text-primary">{file.name}</span>
                  ) : (
                    <>
                      <span className="text-sm text-muted-foreground">
                        .ics veya .csv dosyası seçin
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Airbnb, Booking.com, Google Calendar ve manuel CSV desteklenir
                      </span>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".ics,.csv"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
                {file ? (
                  <button
                    type="button"
                    onClick={reset}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Dosyayı kaldır
                  </button>
                ) : null}
              </div>

              {/* Hint */}
              <p className="text-xs text-muted-foreground">
                CSV için beklenen sütunlar: <code>guest_name</code>, <code>arrival</code>,{" "}
                <code>departure</code> (ve isteğe bağlı: <code>amount</code>,{" "}
                <code>channel</code>)
              </p>

              {/* Error */}
              {error ? (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  {error}
                </div>
              ) : null}

              {/* Result */}
              {result ? (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2 font-medium text-success">
                    <CheckCircle className="size-4" />
                    İçe aktarma tamamlandı
                  </div>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">{result.imported}</span> rezervasyon aktarıldı
                    {result.skipped > 0 ? `, ${result.skipped} atlandı` : ""}
                  </p>
                  {result.errors.length > 0 ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        {result.errors.length} hata
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-xs text-destructive">
                        {result.errors.slice(0, 10).map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                        {result.errors.length > 10 ? (
                          <li>...ve {result.errors.length - 10} daha</li>
                        ) : null}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={close}>
                  {result ? "Kapat" : "İptal"}
                </Button>
                {!result ? (
                  <Button type="submit" disabled={!file || !propertyId || loading}>
                    {loading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    İçe Aktar
                  </Button>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
