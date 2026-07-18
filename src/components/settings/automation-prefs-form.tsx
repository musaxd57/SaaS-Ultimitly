"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Per-tenant automation preferences each customer controls:
 *  - autoReplyDisclosure: show the "(machine-prepared)" note on AUTO replies.
 *  - handoffHoldHours: how long the AI stays silent after a human-handoff request.
 */
export function AutomationPrefsForm({
  disclosure,
  holdHours,
  holdingAck,
  closingReply,
  closingText,
  lateCheckoutOffer,
  taskFromMessage,
  supplyRequest,
}: {
  disclosure: boolean;
  holdHours: number;
  holdingAck: boolean;
  closingReply: boolean;
  closingText: string;
  lateCheckoutOffer: string;
  taskFromMessage: boolean;
  supplyRequest: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [autoReplyDisclosure, setDisclosure] = useState(disclosure);
  const [handoffHoldHours, setHoldHours] = useState(String(holdHours));
  const [autoHoldingReplyEnabled, setHoldingAck] = useState(holdingAck);
  const [autoClosingReplyEnabled, setClosingReply] = useState(closingReply);
  const [closingReplyText, setClosingText] = useState(closingText);
  const [lateCheckoutOfferText, setLateCheckoutOffer] = useState(lateCheckoutOffer);
  const [autoTaskFromMessageEnabled, setTaskFromMessage] = useState(taskFromMessage);
  const [autoSupplyRequestEnabled, setSupplyRequest] = useState(supplyRequest);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Baseline of every field as last persisted; the Kaydet button stays disabled
  // until at least one field differs from it. Refreshed after a successful save.
  const [baseline, setBaseline] = useState({
    autoReplyDisclosure: disclosure,
    handoffHoldHours: String(holdHours),
    autoHoldingReplyEnabled: holdingAck,
    autoClosingReplyEnabled: closingReply,
    closingReplyText: closingText,
    lateCheckoutOfferText: lateCheckoutOffer,
    autoTaskFromMessageEnabled: taskFromMessage,
    autoSupplyRequestEnabled: supplyRequest,
  });
  const dirty =
    autoReplyDisclosure !== baseline.autoReplyDisclosure ||
    handoffHoldHours !== baseline.handoffHoldHours ||
    autoHoldingReplyEnabled !== baseline.autoHoldingReplyEnabled ||
    autoClosingReplyEnabled !== baseline.autoClosingReplyEnabled ||
    closingReplyText !== baseline.closingReplyText ||
    lateCheckoutOfferText !== baseline.lateCheckoutOfferText ||
    autoTaskFromMessageEnabled !== baseline.autoTaskFromMessageEnabled ||
    autoSupplyRequestEnabled !== baseline.autoSupplyRequestEnabled;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoReplyDisclosure,
          handoffHoldHours: Number(handoffHoldHours),
          autoHoldingReplyEnabled,
          autoClosingReplyEnabled,
          closingReplyText,
          lateCheckoutOfferText,
          autoTaskFromMessageEnabled,
          autoSupplyRequestEnabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSaved(true);
        setBaseline({
          autoReplyDisclosure,
          handoffHoldHours,
          autoHoldingReplyEnabled,
          autoClosingReplyEnabled,
          closingReplyText,
          lateCheckoutOfferText,
          autoTaskFromMessageEnabled,
          autoSupplyRequestEnabled,
        });
        startTransition(() => router.refresh());
      } else {
        // Surface the SPECIFIC field message (e.g. the offer payment-method
        // rejection) instead of the generic "Doğrulama hatası" — otherwise the host
        // can't tell what to fix. Any field error wins; falls back to the general one.
        const fieldError = data.fields ? (Object.values(data.fields)[0] as string | undefined) : undefined;
        setError(fieldError ?? data.error ?? "Kaydedilemedi.");
      }
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={autoReplyDisclosure}
          onChange={(e) => { setDisclosure(e.target.checked); setSaved(false); }}
          className="mt-0.5 size-4"
        />
        <span className="text-sm">
          <span className="font-medium">Otomatik yanıt notu</span>
          <span className="block text-xs text-muted-foreground">
            Otomatik gönderilen cevapların sonuna “(Bu yanıt otomatik asistanımızca hazırlandı; bir
            hata olursa ekibimiz hemen düzeltir.)” notu eklensin. Misafirin diline göre yazılır.
            Kapatırsanız misafir bu notu görmez. (Elle gönderdiğiniz cevaplarda zaten görünmez.)
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={autoHoldingReplyEnabled}
          onChange={(e) => { setHoldingAck(e.target.checked); setSaved(false); }}
          className="mt-0.5 size-4"
        />
        <span className="text-sm">
          <span className="font-medium">Hafif şikayette otomatik ön-yanıt</span>
          <span className="block text-xs text-muted-foreground">
            Açarsanız: para/iade, iptal, güvenlik, kötü-yorum tehdidi gibi sinyaller İÇERMEYEN hafif
            şikayetlerde misafire anında tek bir bekletme mesajı gider — &ldquo;Bunun için özür dileriz.
            Mesajınızı ev sahibimize ilettim; en kısa sürede sizinle ilgilenecek. Sorunun kısa bir
            detayını ya da fotoğrafını paylaşırsanız çözümü hızlandırır.&rdquo; Karar vermez, söz vermez;
            konuşma yine &ldquo;Sorunlu&rdquo; olarak size düşer ve e-posta ile haber verilir. Kapalıyken (varsayılan)
            şikayetlere hiçbir otomatik mesaj gitmez.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={autoClosingReplyEnabled}
          onChange={(e) => { setClosingReply(e.target.checked); setSaved(false); }}
          className="mt-0.5 size-4"
        />
        <span className="text-sm">
          <span className="font-medium">Teşekkür ve övgü mesajına nezaket yanıtı</span>
          <span className="block text-xs text-muted-foreground">
            Açarsanız: misafir konuşmayı &ldquo;teşekkürler / tamam / 👍&rdquo; gibi kısa bir kapanışla
            bitirdiğinde ya da <span className="font-medium">salt övgü</span> yazdığında (&ldquo;her şey
            harikaydı!&rdquo;), kendi dilinde tek satırlık kibar bir yanıt otomatik gider. İçinde soru,
            talep veya şikâyet izi olan mesajlar bu yola <span className="font-medium">girmez</span> —
            normal güvenlik akışına düşer. Aynı mesaja yalnızca bir kez yanıt verilir; nezaket yanıtına
            gelen ikinci &ldquo;sağ olun&rdquo; sohbeti uzatmaz. Bu kısa yanıta otomatik-yanıt notu
            eklenmez, imzanız eklenir. Kapalıyken (varsayılan) davranış bugünkü gibidir.
          </span>
        </span>
      </label>

      {autoClosingReplyEnabled ? (
        <div className="ml-7">
          <label htmlFor="closing-text" className="block text-sm font-medium">
            Nezaket yanıtı metni (isteğe bağlı)
          </label>
          <p className="mb-1.5 text-xs text-muted-foreground">
            Boş bırakırsanız misafirin dilinde kısa hazır metin gider (Türkçe: &ldquo;Rica ederiz, iyi
            günler dileriz! 😊&rdquo;). Buraya yazarsanız <span className="font-medium">her dilde aynen
            bu metin</span> gönderilir; imzanız yine sonuna eklenir.
          </p>
          <textarea
            id="closing-text"
            value={closingReplyText}
            onChange={(e) => { setClosingText(e.target.value); setSaved(false); }}
            rows={2}
            maxLength={300}
            placeholder="Örn. Rica ederiz, keyifli konaklamalar!"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
      ) : null}

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={autoTaskFromMessageEnabled}
          onChange={(e) => { setTaskFromMessage(e.target.checked); setSaved(false); }}
          className="mt-0.5 size-4"
        />
        <span className="text-sm">
          <span className="font-medium">Mesajlardan otomatik görev oluştur</span>
          <span className="block text-xs text-muted-foreground">
            Açarsanız: bir misafir mesajı size &ldquo;Sorunlu&rdquo; olarak düştüğünde ve içinde fiziksel bir
            operasyon sinyali varsa (arıza/bozuk cihaz, eksik malzeme, temizlik şikayeti) otomatik
            olarak bir <span className="font-medium">görev</span> açılır — kategori, öncelik ve teslim
            süresiyle (SLA). Aynı mülkte aynı gün aynı konu için tek görev oluşur (mükerrer engellenir).
            Görev, Görevler (Kanban) ekranınıza düşer. Kapalıyken (varsayılan) davranış aynı kalır:
            sadece &ldquo;Sorunlu&rdquo; işareti + e-posta, görev açılmaz.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={autoSupplyRequestEnabled}
          onChange={(e) => { setSupplyRequest(e.target.checked); setSaved(false); }}
          className="mt-0.5 size-4"
        />
        <span className="text-sm">
          <span className="font-medium">Misafir mesajından ekstra malzeme talebi</span>
          <span className="block text-xs text-muted-foreground">
            Açarsanız: bir misafir <span className="font-medium">açıkça</span> ekstra havlu/çarşaf
            <span className="font-medium"> isterse</span> (ör. &ldquo;bir havlu daha alabilir miyiz&rdquo;), o dairenin
            Hazırlık planına <span className="font-medium">+1</span> eklenir. Soru (&ldquo;ekstra havlu var mı?&rdquo;),
            fiyat (&ldquo;ücretli mi?&rdquo;) ve ret (&ldquo;istemiyorum/getirmeyin&rdquo;) <span className="font-medium">tetiklemez</span>.
            Mesaj çözümlemesi kusursuz değildir; bu yüzden varsayılan KAPALI — açmak sizin tercihiniz.
          </span>
        </span>
      </label>

      <div className="rounded-md border border-dashed border-muted-foreground/30 p-3">
        <label htmlFor="late-checkout-offer" className="block text-sm font-medium">
          Geç çıkış / uzatma teklifi (isteğe bağlı)
        </label>
        <p className="mb-1.5 text-xs text-muted-foreground">
          Buraya kendi <span className="font-medium">geç çıkış / konaklama uzatma</span> teklifinizi
          (fiyat ve koşullar) yazarsanız, bir misafir geç çıkış veya kalışı uzatmayı sorduğunda AI
          bu teklifi <span className="font-medium">yalnızca o soruda</span> misafire iletir ve son
          onayı size bırakır (&ldquo;uygunluğu ev sahibimiz netleştirecek&rdquo;). Boş bırakırsanız
          (varsayılan) AI fiyat söylemez, konuyu doğrudan size yönlendirir. AI{" "}
          <span className="font-medium">ödeme yöntemine girmez</span> — nakit/elden ya da platform
          üzerinden demez; ödemeyi misafirle siz ayarlarsınız.
        </p>
        <textarea
          id="late-checkout-offer"
          value={lateCheckoutOfferText}
          onChange={(e) => { setLateCheckoutOffer(e.target.value); setSaved(false); }}
          rows={3}
          maxLength={400}
          placeholder="Örn. Geç çıkış (en geç 14:00) müsaitliğe göre 500 TL'dir. Bir gün uzatma için lütfen belirtin, birlikte ayarlayalım."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="hold-hours" className="block text-sm font-medium">
          İnsan devri bekleme süresi (saat)
        </label>
        <p className="mb-1.5 text-xs text-muted-foreground">
          Misafir “gerçek bir kişiyle / ev sahibiyle görüşmek istiyorum” dediğinde, AI bu konuşmada
          kaç saat sussun? (0–72) Bu sürede siz devralırsınız.
        </p>
        <Input
          id="hold-hours"
          type="number"
          min={0}
          max={72}
          value={handoffHoldHours}
          onChange={(e) => { setHoldHours(e.target.value); setSaved(false); }}
          className="w-28"
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !dirty}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Kaydet
        </Button>
        {saved && !dirty ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
            <Check className="size-4" /> Kaydedildi
          </span>
        ) : null}
      </div>
    </form>
  );
}
