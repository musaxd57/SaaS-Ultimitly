"use client";

import { useState, useEffect, useRef } from "react";
import { Field } from "@/components/form-field";
import { FormError } from "@/components/form-error";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { TurnstileWidget, type TurnstileHandle } from "@/components/auth/turnstile-widget";
import { VERIFY_RESEND_QUIET_MS, VERIFY_RESEND_REQUESTED_TEXT } from "@/lib/auth/verify-resend-window";
import { REGISTER_CAPTCHA_REQUIRED, REGISTER_CONSENT_REQUIRED } from "@/lib/auth/register-messages";

type Fields = Record<string, string>;

/**
 * The browser's own IANA timezone, for the org we're about to create. Reports,
 * "today" boundaries, automated-message hour windows and the QR concierge's
 * open-hours gate all run on the org's zone, and until this was sent every new
 * org started on Europe/Istanbul — correct for Turkey, wrong for anyone else.
 *
 * Best-effort by design: the server VALIDATES this and falls back to the
 * deployment default, and the host can change it in Settings. Returns "" rather
 * than throwing on an ancient browser, so sign-up never depends on it.
 */
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/** `turnstileSiteKey`: sunucu yalnız `SIGNUP_TURNSTILE_ENABLED` açık ve anahtarlar tamken verir (U15); yoksa widget yok, davranış eskisi. */
/**
 * Cümle içi bağlantı (onay satırı, aydınlatma satırı): altı çizili. Yalnız renkle ayrılan bağlantı, renkleri ayırt edemeyen kullanıcıya
 * düz yazı gibi görünür (WCAG 1.4.1; axe `link-in-text-block`, FB gezisi 11-20). Sözleşme bağlantısının fark edilmesi ayrıca önemli.
 */
const INLINE_LINK_CLASS = "text-primary underline underline-offset-2 hover:no-underline";

export function RegisterForm({ turnstileSiteKey = null }: { turnstileSiteKey?: string | null } = {}) {
  const router = useRouter();
  const [humanToken, setHumanToken] = useState("");
  const [humanLoadError, setHumanLoadError] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);
  const needsHuman = Boolean(turnstileSiteKey) && !humanToken;
  const [form, setForm] = useState({
    organizationName: "",
    name: "",
    email: "",
    password: "",
  });
  // Yanıt geldiği andaki alan değerleri (istek sürerken düzenlenen alanın eski sunucu hatası gösterilmesin).
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  // Y10 (10-14 dış inceleme): bağlantının GÖNDERİLDİĞİ adres istek anında dondurulur — istek sürerken alan düzenlenirse başarı ekranı
  // ve "yeniden gönder" yeni yazılan adresi değil bağlantının gittiği adresi kullanır.
  const [sentTo, setSentTo] = useState("");
  const [consent, setConsent] = useState(false);
  const consentRef = useRef<HTMLInputElement>(null);
  // Doğrulama bağlantısını YENİDEN GÖNDERME, başarı ekranının kendisinde durur.
  // Eskiden bu seçenek yalnız giriş sayfasında ve ancak BAŞARISIZ bir giriş
  // denemesinden sonra beliriyordu — yani kullanıcı, maili gelmediğinde önce
  // giremeyeceğini keşfetmek zorundaydı. Bekleme sayacı hem kotayı (adres başına
  // 15 dk'da 4 istek) korur hem de "az önce gönderdik" gerçeğini görünür kılar.
  // 🚨 Tur 7 T7-AUTH-1 (kurucu onayı 11-05): sayaç sunucunun sessiz penceresiyle (U12, 10 dk) AYNI sabitten — eskiden 60 sn'de açılıyordu,
  // pencere içindeki her basış "Yeni bağlantı gönderildi." diyordu ama hiçbir şey gitmiyordu. Sunucu yine kendi penceresini uygular
  // (sayfayı yenilemek / ikinci sekme onu atlatmaz); bu yalnız dürüst bir ekran.
  const RESEND_COOLDOWN_SEC = VERIFY_RESEND_QUIET_MS / 1000;
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  async function resendVerification() {
    if (resending || resendCooldown > 0) return;
    setResending(true);
    setResendError(null);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: sentTo }),
      });
      // fetch 429/5xx'te throw ETMEZ: res.ok bakılmazsa kullanıcıya yalan
      // "gönderildi" gösterilir ve hiç gelmeyecek bir maili bekler.
      if (!res.ok) {
        setResendError(
          res.status === 429
            ? "Çok sık denendi — birkaç dakika sonra tekrar deneyin."
            : "Bağlantı gönderilemedi. Lütfen tekrar deneyin.",
        );
        return;
      }
      setResendDone(true);
      setResendCooldown(RESEND_COOLDOWN_SEC);
    } catch {
      setResendError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setResending(false);
    }
  }

  /** Sunucudan gelen hata bir DURUM'dur ("bu e-posta zaten kayıtlı"), kullanıcı o
   *  alanı düzeltmeye başlayınca BAYATLAR — yoksa yeni yazılan (bomboş) adresin
   *  altında hâlâ "zaten kayıtlı" yazar ve üstteki özet kutusu ekranda kalır.
   *  Giriş ve şifre-sıfırlama formlarındaki kuralın aynısı; zamanlayıcı YOK. */
  function clearFieldError(key: string) {
    setFields((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setError((prev) => (prev ? null : prev));
  }

  function update(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      clearFieldError(key);
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    // UX-3 (kurucu 11-13: "düğme hep basılabilir; soluk olması garip — büyük siteler nasıl yapıyorsa"): düğme artık onay kutusu boşken
    // de basılır. Metin alanlarını tarayıcı kendisi denetler (boş / geçersiz e-posta → tarayıcının uyarısı, bu fonksiyon hiç çağrılmaz);
    // onay kutusu tarayıcıya bırakılmaz (`required` yok) ki uyarı kutunun ALTINDA, bizim metnimizle çıksın. İstek GİTMEZ — kayıt ucu
    // IP başına saatte 5 denemeyle sınırlı, unutulmuş bir kutu hakkı yemesin.
    if (!consent) {
      setFields((f) => ({ ...f, consent: REGISTER_CONSENT_REQUIRED }));
      consentRef.current?.focus();
      consentRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      return;
    }
    // İnsan doğrulaması (anahtar açıksa) henüz bitmediyse: sunucunun reddettiği durumla aynı alan uyarısı; istek gitmez.
    if (needsHuman) {
      setFields((f) => ({ ...f, captcha: REGISTER_CAPTCHA_REQUIRED }));
      return;
    }
    setLoading(true);
    setError(null);
    setFields({});
    const submitted = { ...form };
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...submitted,
          consent,
          timezone: browserTimezone(),
          ...(turnstileSiteKey ? { turnstileToken: humanToken } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Belirteç tek kullanımlık — her başarısız gönderimden sonra yeni doğrulama gerekir.
        if (turnstileSiteKey) turnstile.current?.reset();
        // İstek sürerken düzenlenen alanın eski hatası yeni değerin altına YAZILMAZ (Haiku 10-14: "zaten kayıtlı" b@… altında).
        if (data.fields) {
          const live = formRef.current;
          const fresh = Object.fromEntries(
            Object.entries(data.fields as Record<string, string>).filter(
              ([k]) => !(k in submitted) || live[k as keyof typeof live] === submitted[k as keyof typeof submitted],
            ),
          );
          setFields(fresh);
        }
        setError(data.error ?? "Kayıt başarısız oldu");
        return;
      }
      if (data.verifyEmail) {
        // Anti-bot: the account is inert until the e-mailed link is clicked.
        setSentTo(submitted.email);
        setSent(true);
        // Bağlantı AZ ÖNCE gönderildi: yeniden-gönder düğmesi sayaçla açılır —
        // hemen basmak yeni bir şey getirmez, sadece kotayı yerdi.
        setResendCooldown(RESEND_COOLDOWN_SEC);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <div className="space-y-3 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-5 text-sm text-emerald-900">
          <p className="font-semibold">Hesabınız oluşturuldu — son bir adım kaldı! 📧</p>
          <p>
            <strong>{sentTo}</strong> adresine bir <strong>doğrulama bağlantısı</strong>{" "}
            gönderdik. Maildeki butona tıklayın ve az önce belirlediğiniz şifreyi girin.
          </p>
          <p className="text-xs text-emerald-700">
            Bağlantı gelmediyse spam/gereksiz klasörünü kontrol edin. Bağlantı 24 saat geçerlidir.
          </p>
        </div>
        {/* Çıkış yolu: bu ekran eskiden çıkmazdı — mail gelmezse yeniden gönderme
            imkânı giriş sayfasında olduğu hâlde oraya bir bağlantı yoktu. */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={resendVerification}
            disabled={resending || resendCooldown > 0}
            className="w-full rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            {resending
              ? "Gönderiliyor…"
              : resendCooldown > 0
                ? `Bağlantıyı yeniden gönder (${Math.floor(resendCooldown / 60)}:${String(resendCooldown % 60).padStart(2, "0")})`
                : "Bağlantıyı yeniden gönder"}
          </button>
          {resendDone && resendCooldown > 0 ? (
            <p className="text-center text-xs text-emerald-700">{VERIFY_RESEND_REQUESTED_TEXT}</p>
          ) : null}
          {resendError ? (
            <p className="text-center text-xs text-destructive">{resendError}</p>
          ) : null}
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Bağlantıyı kullandıktan sonra{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            giriş sayfasından
          </Link>{" "}
          devam edebilirsiniz.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
        <p className="font-semibold">14 gün ücretsiz Pro denemesi. Kart gerekmez.</p>
        <p className="mt-0.5 text-emerald-700">
          {/* GERÇEK davranışla birebir (kullanıcının kendi metni, 07-30): deneme
              bitince hesap silinmez ve ücret çekilmez, ama otomatik mesajlaşma
              kapanır (premiumAllowed tek kapı). "Sınırlı erişim" =
              LimitedModeBanner'ın anlattığı kısıtlı mod. */}
          Deneme sonunda otomatik ücret alınmaz. Hesabınızı sınırlı erişimle kullanmaya devam
          edebilirsiniz; otomatik yanıtlar ve AI özellikleri için ücretli plan gerekir.
        </p>
      </div>
      <FormError>{error}</FormError>
      <Field label="İşletme adı" htmlFor="organizationName" error={fields.organizationName}>
        <Input
          id="organizationName"
          value={form.organizationName}
          onChange={update("organizationName")}
          placeholder="Örn. Bosphorus Stays"
          required
        />
      </Field>
      <Field label="Adınız" htmlFor="name" error={fields.name}>
        <Input id="name" value={form.name} onChange={update("name")} required />
      </Field>
      <Field label="E-posta" htmlFor="email" error={fields.email}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={update("email")}
          required
        />
      </Field>
      {/* Kural artik ipucu olarak KALICI: hata belirince kaybolmuyor
          (Field ikisini birden gosterir ve ikisini de describedby'a baglar). */}
      {/* PasswordInput, Field'in tek cocugu: aria enjeksiyonu ic Input'a
          props uzerinden akar (bilecen sarmalayici-div dersi). Guclu sifre
          onerisi BILINCLI YOK - tarayicinin kendi onericisi (autocomplete=
          new-password) hem uretir hem kullanicinin sifre yoneticisine kaydeder;
          uygulama ici ureticiyle yarismak kafa karistiriyordu (kullanici karari). */}
      <Field label="Şifre" htmlFor="password" error={fields.password} hint="En az 8 karakter.">
        <PasswordInput
          id="password"
          autoComplete="new-password"
          value={form.password}
          onChange={update("password")}
          required
        />
      </Field>
      <div className="space-y-1">
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            ref={consentRef}
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              clearFieldError("consent");
            }}
            className="mt-0.5 size-4 shrink-0 rounded border-input"
            aria-invalid={fields.consent ? true : undefined}
            aria-describedby={fields.consent ? "register-consent-error" : undefined}
          />
          {/* Kurucu 11-13 ("kelime seçimleri önemli, ceza yemeyelim"): kutu yalnız sözleşmeyi (Kullanım Koşulları) KABUL ettirir. Gizlilik
              Politikası bir aydınlatma metnidir; KVKK'ya göre aydınlatma onaya / kabule bağlanmaz → kutusuz bilgi satırı (↓). */}
          <span>
            <Link href="/kosullar" target="_blank" className={INLINE_LINK_CLASS}>
              Kullanım Koşulları
            </Link>
            &apos;nı okudum ve kabul ediyorum.
          </span>
        </label>
        {fields.consent ? (
          <p id="register-consent-error" role="alert" className="text-xs text-destructive">
            {fields.consent}
          </p>
        ) : null}
        <p data-privacy-notice className="pl-6 text-xs text-muted-foreground">
          Kişisel verilerinizi nasıl işlediğimizi{" "}
          <Link href="/gizlilik" target="_blank" className={INLINE_LINK_CLASS}>
            Gizlilik Politikası
          </Link>
          &apos;nda anlattık.
        </p>
      </div>
      {turnstileSiteKey ? (
        <div className="space-y-1">
          <TurnstileWidget
            ref={turnstile}
            siteKey={turnstileSiteKey}
            action="register"
            onToken={(t) => {
              setHumanToken(t);
              if (t) clearFieldError("captcha");
            }}
            onLoadError={() => setHumanLoadError(true)}
          />
          {humanLoadError ? (
            <p className="text-center text-xs text-destructive">
              Güvenlik doğrulaması yüklenemedi. Sayfayı yenileyip tekrar deneyin.
            </p>
          ) : null}
          {fields.captcha ? <p className="text-center text-xs text-destructive">{fields.captcha}</p> : null}
        </div>
      ) : null}
      {/* UX-3: yalnız istek sürerken pasif (çift gönderim). Onay / doğrulama eksiği basınca söylenir (yukarıdaki `onSubmit`). */}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        Hesap Oluştur
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Zaten hesabınız var mı?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Giriş yapın
        </Link>
      </p>
    </form>
  );
}
