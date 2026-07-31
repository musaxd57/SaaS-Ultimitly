"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Serbest metin alanının GÖRÜNÜR karakter tavanı.
 *
 * Sunucu 1.000'e kadar kabul ediyor (`leadSchema`) — o bir arka duvar. Buradaki
 * daha sıkı tavanın iki sebebi var: (1) kutu tavansızken içine sınırsız metin
 * akıp kaydırma çubuğu çıkarıyordu, ucuz duruyordu; (2) bu alan bir satış notu,
 * roman değil — 400 karakter "5 dairem var, Airbnb + Booking kullanıyorum,
 * eylülde başlamak istiyorum" demeye fazlasıyla yeter.
 */
const MESSAGE_MAX = 400;

/** Türkiye ülke kodu, alanın İÇİNDE sabit durur — aday yalnız gerisini yazar. */
const PHONE_PREFIX = "+90";

/**
 * Yazılanı tek bir doğru biçime indir: `+90 5XXXXXXXXX`.
 *
 * ⚠️ SABİT ÖNEK TEK BAŞINA YETMİYOR — ve bu, öneki eklerken açılan gerçek bir
 * hataydı. Türk kullanıcı refleksle **"0532 …"** yazar; ham metni öneğe eklemek
 * `+90 0532 …` üretiyordu. Bu numara geçersizdir ve operatör panelindeki
 * WhatsApp bağlantısı (`wa.me/<rakamlar>`) ölü bir adrese gider — yani gelen
 * lead HİÇ ARANAMAZ. Yapıştırılan `+90`/`90`/`0090` önekleri de aynı şekilde
 * ikilenirdi.
 *
 * Bu yüzden gönderimden önce: rakam-dışı her şey atılır, baştaki ülke kodu ve
 * sıfır kırpılır, kalan tek biçimde birleştirilir. Rakam yoksa BOŞ döner —
 * telefon yazmayan her aday "+90" diye sahte bir kayıt üretmesin.
 */
export function normalizeTrPhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0090")) d = d.slice(4);
  else if (d.startsWith("90") && d.length > 10) d = d.slice(2);
  d = d.replace(/^0+/, "");
  if (!d) return "";
  return `${PHONE_PREFIX} ${d}`;
}

/** Public "request a demo / free trial" form on the landing page. */
export function LeadForm() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [website, setWebsite] = useState(""); // honeypot — humans never fill this
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const phone = normalizeTrPhone(form.phone);
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, phone, website, consent }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setDone(true);
      else setErrors(data.fields ?? { _: data.error ?? "Gönderilemedi." });
    } catch {
      setErrors({ _: "Bağlantı hatası." });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-6 text-center">
        <Check className="mx-auto size-8 text-emerald-600" />
        <p className="mt-2 font-semibold text-emerald-900">Talebiniz alındı!</p>
        <p className="mt-1 text-sm text-emerald-800">
          En kısa sürede sizinle iletişime geçip kurulumunuzu birlikte yapacağız.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-6 text-foreground">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Input aria-label="Adınız" placeholder="Adınız" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          {errors.name ? <p className="mt-1 text-xs text-destructive">{errors.name}</p> : null}
        </div>
        <div>
          <Input aria-label="E-posta adresiniz" type="email" placeholder="E-posta adresiniz" value={form.email} onChange={(e) => set("email", e.target.value)} required />
          {errors.email ? <p className="mt-1 text-xs text-destructive">{errors.email}</p> : null}
        </div>
      </div>

      {/*
        TELEFON — ülke kodu alanın İÇİNDE sabit. Müşterilerin tamamı Türkiye'de
        olduğu için "+90"ı her seferinde yazdırmanın anlamı yok; sabit önek hem
        bir adım kısaltıyor hem beklenen biçimi söylüyor (host doğrudan
        "532 ..." yazmaya başlıyor). Değer state'te ÖNEKSİZ tutulur ve gönderimde
        birleştirilir — böylece boş alan "+90" diye sahte bir kayıt üretmez.
      */}
      <div className="flex h-10 w-full items-center rounded-md border border-input bg-card text-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background">
        <span className="select-none border-r border-input px-3 text-muted-foreground" aria-hidden="true">
          {PHONE_PREFIX}
        </span>
        <input
          aria-label="Telefon numaranız (ülke kodu +90, opsiyonel)"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          maxLength={20}
          placeholder="532 123 45 67 (opsiyonel)"
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          className="h-full flex-1 rounded-r-md bg-transparent px-3 outline-none placeholder:text-muted-foreground"
        />
      </div>
      {errors.phone ? <p className="text-xs text-destructive">{errors.phone}</p> : null}

      {/*
        SERBEST METİN — sabit boyut + görünür tavan. Öncesinde ne `maxLength`
        vardı ne sayaç ne de `resize` kısıtı: kullanıcı köşesinden çekip kutuyu
        büyütebiliyor, sınırsız metin yazınca da kutu kaydırma çubuklu bir şeye
        dönüşüyordu. `resize-none` + sayaç, alanın ne beklediğini söylüyor.
      */}
      <div>
        <textarea
          aria-label="Mesajınız (opsiyonel)"
          placeholder="Kaç daireniz var? Airbnb, Booking… hangisini kullanıyorsunuz? (opsiyonel)"
          value={form.message}
          onChange={(e) => set("message", e.target.value.slice(0, MESSAGE_MAX))}
          rows={3}
          maxLength={MESSAGE_MAX}
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {/* Sayaç yalnız SONA YAKLAŞINCA çıkar — boş formda gereksiz gürültü olmasın. */}
        {form.message.length > MESSAGE_MAX * 0.7 ? (
          <p className="mt-1 text-right text-xs text-muted-foreground">
            {form.message.length} / {MESSAGE_MAX}
          </p>
        ) : null}
        {errors.message ? <p className="mt-1 text-xs text-destructive">{errors.message}</p> : null}
      </div>
      {/* Honeypot: hidden from humans; bots that fill it get silently dropped. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          required
          className="mt-0.5 size-4 shrink-0 rounded border-input"
        />
        <span>
          <Link href="/gizlilik" className="underline hover:text-foreground">KVKK Aydınlatma Metni</Link>
          &apos;ni okudum; demo talebime dönüş yapılması için ad, e-posta ve telefon bilgilerimin
          işlenmesine açık rıza veriyorum.
        </span>
      </label>
      {errors.consent ? <p className="text-xs text-destructive">{errors.consent}</p> : null}
      {errors._ ? <p className="text-sm text-destructive">{errors._}</p> : null}
      <Button type="submit" className="w-full" size="lg" disabled={busy || !consent}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        Ücretsiz demo iste
      </Button>
      <p className="text-center text-xs text-muted-foreground">Kredi kartı gerekmez.</p>
    </form>
  );
}
