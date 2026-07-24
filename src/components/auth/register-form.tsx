"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Fields = Record<string, string>;

export function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    organizationName: "",
    name: "",
    email: "",
    password: "",
  });
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [consent, setConsent] = useState(false);
  // Doğrulama bağlantısını YENİDEN GÖNDERME, başarı ekranının kendisinde durur.
  // Eskiden bu seçenek yalnız giriş sayfasında ve ancak BAŞARISIZ bir giriş
  // denemesinden sonra beliriyordu — yani kullanıcı, maili gelmediğinde önce
  // giremeyeceğini keşfetmek zorundaydı. Bekleme sayacı hem kotayı (adres başına
  // 15 dk'da 4 istek) korur hem de "az önce gönderdik" gerçeğini görünür kılar.
  const RESEND_COOLDOWN_SEC = 60;
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
        body: JSON.stringify({ email: form.email }),
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
    setLoading(true);
    setError(null);
    setFields({});
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, consent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.fields) setFields(data.fields);
        setError(data.error ?? "Kayıt başarısız oldu");
        return;
      }
      if (data.verifyEmail) {
        // Anti-bot: the account is inert until the e-mailed link is clicked.
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
            <strong>{form.email}</strong> adresine bir <strong>doğrulama bağlantısı</strong>{" "}
            gönderdik. Maildeki butona tıklayın; giriş otomatik tamamlanır.
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
                ? `Bağlantıyı yeniden gönder (${resendCooldown})`
                : "Bağlantıyı yeniden gönder"}
          </button>
          {resendDone && resendCooldown > 0 ? (
            <p className="text-center text-xs text-emerald-700">Yeni bağlantı gönderildi.</p>
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
        <p className="font-semibold">14 gün ücretsiz Pro deneme — kart gerekmez.</p>
        <p className="mt-0.5 text-emerald-700">
          Kaydolduğunuzda hesabınızı doğrulamak için e-posta göndeririz. Deneme bitince otomatik ücret
          alınmaz; dilerseniz ücretsiz sürümle devam edebilirsiniz.
        </p>
      </div>
      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="organizationName">İşletme adı</Label>
        <Input
          id="organizationName"
          value={form.organizationName}
          onChange={update("organizationName")}
          placeholder="Örn. Bosphorus Stays"
          required
        />
        {fields.organizationName ? (
          <p className="text-xs text-destructive">{fields.organizationName}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Adınız</Label>
        <Input id="name" value={form.name} onChange={update("name")} required />
        {fields.name ? <p className="text-xs text-destructive">{fields.name}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">E-posta</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={update("email")}
          required
        />
        {fields.email ? <p className="text-xs text-destructive">{fields.email}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Şifre</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={update("password")}
          required
        />
        {fields.password ? (
          <p className="text-xs text-destructive">{fields.password}</p>
        ) : (
          <p className="text-xs text-muted-foreground">En az 8 karakter.</p>
        )}
      </div>
      <div className="space-y-1">
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              clearFieldError("consent");
            }}
            className="mt-0.5 size-4 shrink-0 rounded border-input"
            required
          />
          <span>
            <Link href="/kosullar" target="_blank" className="text-primary hover:underline">
              Kullanım Koşulları
            </Link>{" "}
            ve{" "}
            <Link href="/gizlilik" target="_blank" className="text-primary hover:underline">
              Gizlilik Politikası
            </Link>
            &apos;nı okudum, kabul ediyorum.
          </span>
        </label>
        {fields.consent ? <p className="text-xs text-destructive">{fields.consent}</p> : null}
      </div>
      <Button type="submit" className="w-full" disabled={loading || !consent}>
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
