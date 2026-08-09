"use client";

import { useState, useEffect, useRef } from "react";
import { Field } from "@/components/form-field";
import { FormError } from "@/components/form-error";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Step = "request" | "confirm" | "done";

export function ForgotPasswordForm() {
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  /**
   * Sunucu `fields.email` / `fields.code` / `fields.newPassword` ayrımını ZATEN
   * yapıyordu; istemci hepsini tek genel banda topluyordu, yani bilgi vardı ama
   * çöpe gidiyordu. Ekran okuyucu kullanıcısı "kod mu yanlış, şifre mi kısa"
   * ayrımını yapamıyordu. Ayrım korunur → hata DOĞRU alana bağlanır.
   */
  const [fieldError, setFieldError] = useState<{
    email?: string;
    code?: string;
    newPassword?: string;
  }>({});
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  /**
   * E-postadaki bağlantıdan gelen challenge token'ı.
   *
   * 🚨 Token URL **FRAGMENT**'inde gelir (`#t=...`), query'de DEĞİL: fragment
   * HTTP isteğinin parçası değildir, yani sunucuya, Railway edge log'una,
   * vekillere ve `Referer` başlığına HİÇ girmez. Buradan okur okumaz adres
   * çubuğundan da siliyoruz (↓`useEffect`), böylece tarayıcı geçmişinde de
   * kalmaz. `sessionStorage`/`localStorage` BİLİNÇLİ KULLANILMAZ — orada
   * yazdığımız an sekme kapansa bile diskte kalır; React state'i sayfa
   * yenilenince kaybolur, istediğimiz tam olarak budur.
   */
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
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

  /**
   * Bağlantıdan gelindiyse token'ı fragment'ten al ve ADRES ÇUBUĞUNU TEMİZLE.
   *
   * Sıra önemli: önce state'e alınır, sonra `replaceState`. `replaceState`
   * geçmişteki MEVCUT girdiyi değiştirir (yenisini eklemez) → "geri" tuşu
   * token'lı URL'e dönemez.
   */
  useEffect(() => {
    const raw = window.location.hash;
    if (!raw) return;
    const m = /(?:^#|&)t=([0-9a-f]{64})(?:&|$)/.exec(raw);
    if (m) {
      setChallengeToken(m[1]);
      // Kullanıcı e-postasını yazma adımını atlar: bağlantı zaten challenge'ı
      // adresliyor, geriye yalnız e-postadaki kod + yeni şifre kalıyor.
      setStep("confirm");
    }
    // Eşleşme OLMASA DA temizlenir: kırpılmış/bozuk bir token da adres
    // çubuğunda durmamalı. `history.state` KORUNUR — Next App Router'ın
    // yönlendirici durumu o nesnede yaşıyor; `null` yazmak onu düşürürdü.
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
  }, []);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    setFieldError({});
    try {
      const res = await fetch("/api/account/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.fields?.email) setFieldError({ email: data.fields.email });
        else setError(data.error ?? "İstek başarısız oldu.");
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
    setFieldError({});
    setCooldown(0);
    setFocusEmail(true);
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFieldError({});
    try {
      const res = await fetch("/api/account/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Token'lı yolda e-posta GÖNDERİLMEZ: challenge'ı token adresler, sunucu
        // o yolda e-postayı hiçbir yerde kullanmaz. Bağlantıya kendi
        // e-postasından ulaşan kullanıcıya adresini tekrar yazdırmak boş
        // sürtünme olurdu — üstelik burada elimizde o adres YOK (bağlantı taze
        // bir sayfa yüklüyor).
        body: JSON.stringify(
          challengeToken
            ? { action: "confirm", token: challengeToken, code, newPassword }
            : { action: "confirm", email, code, newPassword },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.fields?.code) setFieldError({ code: data.fields.code });
        else if (data.fields?.newPassword) setFieldError({ newPassword: data.fields.newPassword });
        else setError(data.error ?? "İşlem başarısız oldu.");
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
        <FormError>{error}</FormError>
      ) : null}

      {step === "request" ? (
        <form onSubmit={requestCode} className="space-y-4">
          <Field
            label="E-posta"
            htmlFor="email"
            error={fieldError.email}
            hint="Hesabınıza kayıtlı e-postaya 8 haneli bir sıfırlama kodu göndereceğiz."
          >
            <Input
              id="email"
              ref={emailRef}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Kod gönder
          </Button>
        </form>
      ) : !challengeToken ? (
        /* ── KOD ALANI YOK: ÖNCE BAĞLANTI ─────────────────────────────────────
           🚨 BURASI BİR ZAMANLAR KAPALI DÖNGÜYDÜ (kullanıcı canlıda fark etti,
           08-09). Bu ekran kod + yeni şifre alanlarını gösteriyordu; kullanıcı
           e-postadaki 8 haneli kodu buraya yazıyor ve "Bu kod artık
           kullanılamıyor" alıyordu. Sebep: bütçe/kimlik challenge SATIRINDA ve
           satırı YALNIZCA bağlantıdaki token adresleyebiliyor — adres+kod ile
           challenge aramak m47'nin kapattığı DoS'u geri açardı, o yüzden sunucu
           tarafı DOĞRU davranıyordu. Yanlış olan EKRANDI: olmayan bir yolu
           davet ediyordu.
           ⚠️ Bu yüzden düzeltme ROTADA DEĞİL BURADA. Kod alanı ancak token
           geldikten SONRA çizilir; o zamana kadar tek çağrı "bağlantıyı aç".
           ⚠️ Sekme KAPATILAMAZ (tarayıcı `window.close()`u script açmadığı
           sekmede engeller) — o yüzden bu sekme kapatılmıyor, YÖNLENDİRİLİYOR:
           bağlantıya tıklandığında zaten TAZE bir sayfa yüklenir ve doğru
           adımda açılır. */
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{email}</span> adresine ait bir hesap
            varsa e-posta gönderdik.
          </p>
          <p className="rounded-lg border border-primary/30 bg-accent/40 p-3 text-sm">
            <span className="font-medium">E-postadaki bağlantıyı açın.</span>{" "}
            <span className="text-muted-foreground">
              Doğrulama kodunu o bağlantının açtığı sayfada gireceksiniz — kodu bu ekrana
              yazamazsınız.
            </span>
          </p>
          <button
            type="button"
            onClick={backToEmailStep}
            className="w-full text-center text-sm font-medium text-primary hover:underline"
          >
            E-posta adresini değiştir
          </button>
          <button
            type="button"
            onClick={() => requestCode()}
            disabled={loading || cooldown > 0}
            className={
              cooldown > 0
                ? "w-full text-center text-sm text-muted-foreground disabled:opacity-100"
                : "w-full text-center text-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80"
            }
          >
            {cooldown > 0 ? `E-postayı tekrar gönder (${cooldown})` : "E-postayı tekrar gönder"}
          </button>
          <p className="text-center text-xs text-muted-foreground">
            E-posta gelmediyse spam klasörünü kontrol edin. Yine yoksa bu adresle kayıtlı bir
            hesabınız olmayabilir —{" "}
            <Link href="/register" className="font-medium text-primary hover:underline">
              yeni hesap oluşturun
            </Link>
            .
          </p>
        </div>
      ) : (
        <form onSubmit={confirm} className="space-y-4">
          {/* Bağlantıdan gelindi: adres bilinmiyor (taze sayfa yükü) ve gerekmiyor.
              "E-posta adresini değiştir" burada anlamsız olurdu — değiştirilecek
              bir alan yok; onun yerine baştan başlama yolu (↓"Baştan başla"). */}
          <p className="text-sm text-muted-foreground">
            E-postanızdaki 8 haneli kodu girin ve yeni şifrenizi belirleyin.
          </p>
          <Field label="Doğrulama kodu" htmlFor="code" error={fieldError.code}>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              // ⚠️ `pattern` BİLİNÇLİ YOK: tarayıcının kendi doğrulama balonu
              // bizim hata metnimizin önüne geçer ve gönderimi sessizce bloklar.
              maxLength={8}
              placeholder="8 haneli kod"
              value={code}
              // Hata bir DURUM mesajı ("bu kod artık geçerli değil"), zaman aşımıyla
              // değil kullanıcı düzeltmeye başlayınca kalkar. (Resend / yeniden
              // gönderim zaten setError(null) yapıyor.) Timer bilinçli YOK: metin
              // okunurken kaybolursa kullanıcı aynı eski kodu tekrar dener.
              onChange={(e) => {
                setCode(e.target.value);
                if (error) setError(null);
                setFieldError((f) => (f.code ? {} : f));
              }}
              autoFocus
              required
            />
          </Field>
          <Field label="Yeni şifre" htmlFor="newPassword" error={fieldError.newPassword}>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              placeholder="En az 8 karakter"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setFieldError((f) => (f.newPassword ? {} : f));
              }}
              required
            />
          </Field>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Şifreyi sıfırla
          </Button>
          {/* Token'lı yolda "tekrar gönder" ÇALIŞAMAZ: istek e-posta adresi ister,
              bağlantıdan gelen sayfada o adres yok (taze sayfa yükü). Süresi
              dolmuş / denemesi tükenmiş bir bağlantının tek çıkışı baştan
              başlamaktır — ve orası adresi soran ekrandır. */}
          <button
            type="button"
            onClick={() => {
              setChallengeToken(null);
              backToEmailStep();
            }}
            disabled={loading}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Baştan başla
          </button>
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
