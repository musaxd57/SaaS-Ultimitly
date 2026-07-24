"use client";

import { useEffect, useState } from "react";
import { Mail, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Bir kez başarıyla doğrulandıktan sonra buton kalıcı olarak gizlenir (kullanıcı
// isteği — tek seferlik kurulum aracı, sürekli duran bir düğme değil). Bayrak
// tarayıcıda (localStorage) tutulur; sunucu tarafında bir "test edildi" alanı
// taşımaya değmez, temizlenirse buton zararsızca geri gelir.
export const TEST_EMAIL_SENT_KEY = "lixus-test-email-sent";
// Uyarı adresi DEĞİŞİNCE yeni adres test edilmemiş demektir — AlertEmailForm bu
// event'i yayınlar, buton geri gelir ve eski adrese ait bayat onay satırı silinir.
export const ALERT_EMAIL_SAVED_EVENT = "lixus-alert-email-saved";
// Başarı bildirimi geçici bir "toast"tır: bu süre sonunda kendiliğinden temizlenir
// (Codex). HATA bildirimi ise KALIR — kullanıcı okuyup düzeltebilsin.
const SUCCESS_AUTO_DISMISS_MS = 8000;

export function TestEmailButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  // Daha önceki bir ziyarette gönderilmişse blok hiç görünmez. Effect içinde
  // (SSR/hydration uyumsuzluğu olmasın diye) okunur.
  const [hidden, setHidden] = useState(false);

  // BAŞARI bildirimini otomatik temizle; HATA bildirimini elde tut. `result`
  // her değiştiğinde yeniden kurulur → yeni bir başarı gönderimi süreyi baştan
  // başlatır (cleanup eski zamanlayıcıyı iptal eder).
  useEffect(() => {
    if (!result?.ok) return;
    const t = setTimeout(() => setResult(null), SUCCESS_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [result]);

  useEffect(() => {
    try {
      if (localStorage.getItem(TEST_EMAIL_SENT_KEY) === "1") setHidden(true);
    } catch {
      // storage kapalıysa buton görünür kalır — zararsız
    }
    const onAlertEmailSaved = () => {
      setHidden(false);
      setResult(null); // eski adrese ait onay/hata satırı artık yanıltıcı
    };
    window.addEventListener(ALERT_EMAIL_SAVED_EVENT, onAlertEmailSaved);
    return () => window.removeEventListener(ALERT_EMAIL_SAVED_EVENT, onAlertEmailSaved);
  }, []);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/settings/test-email", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setResult({ ok: true, msg: `Test e-postası gönderildi → ${data.to}. Gelen kutunu kontrol et.` });
        // Tek-seferlik kurulum aracı: başarıdan sonra buton kalkar (bayrak +
        // hidden). Onay toast'ı `hidden`'dan BAĞIMSIZ render edilir, sonra 8 sn
        // içinde kendiliğinden temizlenir → bölüm tamamen kaybolur.
        setHidden(true);
        try {
          localStorage.setItem(TEST_EMAIL_SENT_KEY, "1");
        } catch {
          // storage yoksa yalnız bu oturumda gizlenir
        }
      } else {
        const fieldMsg = data?.fields ? Object.values(data.fields)[0] : null;
        setResult({ ok: false, msg: (fieldMsg as string) ?? data?.error ?? "Gönderilemedi." });
      }
    } catch {
      setResult({ ok: false, msg: "İstek gönderilemedi." });
    } finally {
      setBusy(false);
    }
  }

  // Buton + yardım metni tek-seferlik araç durumuna (hidden) bağlı; bildirim
  // toast'ı ondan BAĞIMSIZ render edilir ki buton kalktıktan sonra da görünebilsin.
  if (hidden && !result) return null;

  return (
    <div className="space-y-2">
      {!hidden ? (
        <>
          <p className="text-xs text-muted-foreground">
            E-postaların geldiğini doğrulamak için bir test maili gönderin:
          </p>
          <Button type="button" variant="outline" size="sm" onClick={run} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
            Test e-postası gönder
          </Button>
        </>
      ) : null}
      {result ? (
        <div
          // Başarı = kibar canlı-bölge (role=status); hata = ısrarcı (role=alert)
          // ki ekran okuyucu hemen duyursun. Erişilebilir kapatma düğmesi sağda.
          role={result.ok ? "status" : "alert"}
          aria-live={result.ok ? "polite" : "assertive"}
          className={
            result.ok
              ? "flex items-start justify-between gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
              : "flex items-start justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
        >
          <span className="flex items-start gap-2">
            {result.ok ? (
              <Check className="mt-0.5 size-4 shrink-0" />
            ) : (
              <X className="mt-0.5 size-4 shrink-0" />
            )}
            {result.msg}
          </span>
          <button
            type="button"
            aria-label="Bildirimi kapat"
            onClick={() => setResult(null)}
            className="-mr-1 mt-0.5 shrink-0 rounded p-0.5 opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
