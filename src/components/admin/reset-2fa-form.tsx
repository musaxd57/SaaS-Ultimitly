"use client";

import { useState } from "react";
import { useFlash } from "@/lib/use-flash";
import { Loader2, ShieldOff, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";

/**
 * Operator escape hatch for a hard-locked customer: phone (authenticator) gone
 * AND no recovery codes → 2FA reset by e-mail. The API is super-admin only,
 * audit-logged, and bumps the account's sessionEpoch (old sessions die).
 * Verify the customer's identity out-of-band (phone call) BEFORE using this.
 */
export function Reset2faForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useFlash<string>(); // 6 sn sonra kendiliğinden gider
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/admin/reset-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // Metin SUNUCUNUN söylediğine göre yazılır. Sabit metin, bayat-kayıt
        // temizliğinde "tüm oturumları düşürüldü" diyerek operatöre yalan
        // söylerdi — o dalda hiçbir oturum düşürülmez (kasıtlı: bayat secret
        // hiçbir şeyi yetkilendirmiyor, kesinti karşılıksız olurdu).
        setDone(
          data.outcome === "stale_cleared"
            ? `${email} hesabında 2FA zaten KAPALIYDI; yarım kalmış kurulumdan artakalan kayıt silindi. Oturumlar düşürülmedi, müşteri için hiçbir şey değişmez. İşlem denetim kaydına yazıldı.`
            : `${email} için 2FA kapatıldı ve tüm oturumları düşürüldü. Müşteri artık yalnız şifresiyle girip 2FA'yı güvendiği telefonda yeniden açabilir.`,
        );
        setEmail("");
      } else {
        setError(data.fields?.email ?? data.fields?._ ?? data.error ?? "Sıfırlanamadı.");
      }
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Müşteri telefonunu kaybettiyse <strong>ve</strong> kurtarma kodu da yoksa hesabına giremez.
        Kimliğini telefonla doğruladıktan sonra buradan 2FA&apos;sını sıfırla: hesap yalnız şifreyle
        girişe döner, tüm açık oturumları düşürülür ve işlem denetim kaydına yazılır.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Kullanıcının e-postası" htmlFor="r2fa-email" className="min-w-[240px] flex-1">
          <Input
            id="r2fa-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="musteri@ornek.com"
          />
        </Field>
        <Button type="submit" variant="outline" disabled={busy || !email.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
          2FA&apos;yı sıfırla
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {done ? (
        <p className="inline-flex items-start gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="mt-0.5 size-4 shrink-0" /> {done}
        </p>
      ) : null}
    </form>
  );
}
