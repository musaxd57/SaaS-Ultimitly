"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = "request" | "confirm" | "done";

export function ForgotPasswordForm() {
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  // "E-posta adresini değiştir" sonrası odağı alana taşımak için tek-atımlık
  // bayrak. `autoFocus` KULLANILMAZ: o, sayfa ilk açıldığında da odağı çalardı —
  // burada yalnız kullanıcının kendi başlattığı geri dönüşte odak taşınmalı.
  const [focusEmail, setFocusEmail] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (!focusEmail) return;
    emailRef.current?.focus();
    setFocusEmail(false);
  }, [focusEmail]);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/account/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.fields?.email ?? data.error ?? "İstek başarısız oldu.");
        return;
      }
      setStep("confirm");
      setCooldown(30);
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  /** Kod ekranından e-posta adımına DÖNÜŞ. Uç nokta enumeration-safe olduğu için
   *  adres kayıtlı olmasa da kod ekranına geçiliyor — yani harf hatası yapan
   *  kullanıcı, gelmeyecek bir kodu bekleyerek kilitleniyordu (tek çıkış sayfayı
   *  yenilemekti). `email` KORUNUR: yazım hatasını düzeltmek, adresi baştan
   *  yazmaktan kolaydır. Bayat durum (eski kod + eski hata) temizlenir; bekleme
   *  sayacı da sıfırlanır — yanlış adresi düzeltmek cezalandırılacak bir şey değil,
   *  sunucu tarafı hız sınırı zaten kötüye kullanımı karşılıyor.
   *
   *  `newPassword` de temizlenir (Codex): BAŞKA bir adres için hazırlanmış şifre
   *  bellekte asılı kalmamalı — kullanıcı hangi hesap için yazdığını unutabilir ve
   *  yeni adrese farkında olmadan o şifreyi kurabilirdi.
   *
   *  Odak e-posta alanına taşınır: geri dönmenin TEK sebebi adresi düzeltmek,
   *  kullanıcıyı bir de alanı aramaya zorlamak gereksiz. */
  function backToEmailStep() {
    setStep("request");
    setCode("");
    setNewPassword("");
    setError(null);
    setCooldown(0);
    setFocusEmail(true);
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/account/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", email, code, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.fields?.code ?? data.fields?.newPassword ?? data.error ?? "İşlem başarısız oldu.",
        );
        return;
      }
      setStep("done");
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "done") {
    return (
      <div className="space-y-4">
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
          Şifreniz güncellendi. Artık yeni şifrenizle giriş yapabilirsiniz.
        </p>
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Giriş yap
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      {step === "request" ? (
        <form onSubmit={requestCode} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-posta</Label>
            <Input
              id="email"
              ref={emailRef}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Hesabınıza kayıtlı e-postaya 8 haneli bir sıfırlama kodu göndereceğiz.
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Kod gönder
          </Button>
        </form>
      ) : (
        <form onSubmit={confirm} className="space-y-4">
          {/* Hangi adrese gidildiği burada YAZILI olmalı: yazım hatası ancak
              görülürse fark edilir, ve fark edildiğinde çıkış yolu hemen yanında
              durmalı. Adres kullanıcının kendi yazdığı değer — hesap var/yok
              bilgisi vermez, enumeration güvenliği bozulmaz. */}
          <p className="text-sm text-muted-foreground">
            Kod <span className="font-medium text-foreground">{email}</span> adresine gönderildi.{" "}
            <button
              type="button"
              onClick={backToEmailStep}
              className="font-medium text-primary hover:underline"
            >
              E-posta adresini değiştir
            </button>
          </p>
          <div className="space-y-2">
            <Label htmlFor="code">Doğrulama kodu</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="8 haneli kod"
              value={code}
              // Hata bir DURUM mesajı ("bu kod artık geçerli değil"), zaman aşımıyla
              // değil kullanıcı düzeltmeye başlayınca kalkar. (Resend / yeniden
              // gönderim zaten setError(null) yapıyor.) Timer bilinçli YOK: metin
              // okunurken kaybolursa kullanıcı aynı eski kodu tekrar dener.
              onChange={(e) => {
                setCode(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">Yeni şifre</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              placeholder="En az 8 karakter"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Şifreyi sıfırla
          </Button>
          <button
            type="button"
            onClick={() => requestCode()}
            disabled={loading || cooldown > 0}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {cooldown > 0 ? `Kodu tekrar gönder (${cooldown})` : "Kodu tekrar gönder"}
          </button>
          {/* KOŞULLU yardım (yaygın desen: "Don't see it? Check your spam folder"):
              kullanıcı zaten gelen kutusuna bakıyor — ona "gelen kutuna bak" demek
              boş emir; yalnız kod GELMEDİYSE spam anlamlı. Hesap var/yok ayrımı
              yapmaz (enumeration-safe), formun geri kalanıyla aynı resmî dil. */}
          <p className="text-center text-xs text-muted-foreground">
            Kod gelmediyse spam klasörünü kontrol edin.
          </p>
        </form>
      )}

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Girişe dön
        </Link>
      </p>
    </div>
  );
}
