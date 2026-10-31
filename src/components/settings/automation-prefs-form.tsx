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
  closingReply,
  closingText,
  lateCheckoutOffer,
  taskFromMessage,
  commitmentsAuto,
  supplyRequest,
}: {
  disclosure: boolean;
  holdHours: number;
  closingReply: boolean;
  closingText: string;
  lateCheckoutOffer: string;
  taskFromMessage: boolean;
  /** Söz → görev otomatik (kurucu 10-17 gece); null / verilmedi = anahtar kapalı, seçenek gösterilmez ve gönderilmez. */
  commitmentsAuto?: boolean | null;
  supplyRequest: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [autoReplyDisclosure, setDisclosure] = useState(disclosure);
  const [handoffHoldHours, setHoldHours] = useState(String(holdHours));
  const [autoClosingReplyEnabled, setClosingReply] = useState(closingReply);
  const [closingReplyText, setClosingText] = useState(closingText);
  const [lateCheckoutOfferText, setLateCheckoutOffer] = useState(lateCheckoutOffer);
  const [autoTaskFromMessageEnabled, setTaskFromMessage] = useState(taskFromMessage);
  const showCommitments = commitmentsAuto != null;
  const [autoCommitmentsEnabled, setCommitmentsAuto] = useState(commitmentsAuto ?? true);
  const [autoSupplyRequestEnabled, setSupplyRequest] = useState(supplyRequest);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Baseline of every field as last persisted; the Kaydet button stays disabled
  // until at least one field differs from it. Refreshed after a successful save.
  const [baseline, setBaseline] = useState({
    autoReplyDisclosure: disclosure,
    handoffHoldHours: String(holdHours),
    autoClosingReplyEnabled: closingReply,
    closingReplyText: closingText,
    lateCheckoutOfferText: lateCheckoutOffer,
    autoTaskFromMessageEnabled: taskFromMessage,
    autoCommitmentsEnabled: commitmentsAuto ?? true,
    autoSupplyRequestEnabled: supplyRequest,
  });
  const dirty =
    autoReplyDisclosure !== baseline.autoReplyDisclosure ||
    handoffHoldHours !== baseline.handoffHoldHours ||
    autoClosingReplyEnabled !== baseline.autoClosingReplyEnabled ||
    closingReplyText !== baseline.closingReplyText ||
    lateCheckoutOfferText !== baseline.lateCheckoutOfferText ||
    autoTaskFromMessageEnabled !== baseline.autoTaskFromMessageEnabled ||
    (showCommitments && autoCommitmentsEnabled !== baseline.autoCommitmentsEnabled) ||
    autoSupplyRequestEnabled !== baseline.autoSupplyRequestEnabled;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // Guard BEFORE sending: Number("") === 0, so a cleared hold-hours box would
    // silently persist a 0-hour hold (AI resumes immediately after a human-handoff
    // request). Blank is a mistake, not a choice — an explicit "0" still works.
    if (handoffHoldHours.trim() === "") {
      setSaved(false);
      setError("Bekleme süresi boş olamaz — 0 ile 72 arasında bir saat girin.");
      return;
    }
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
          autoClosingReplyEnabled,
          closingReplyText,
          lateCheckoutOfferText,
          autoTaskFromMessageEnabled,
          ...(showCommitments ? { autoCommitmentsEnabled } : {}),
          autoSupplyRequestEnabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSaved(true);
        // Mirror the server's normalization (trim; empty→null is displayed as "")
        // so the on-screen value matches what was stored and whitespace-only
        // edits can't re-enable Kaydet as a phantom "unsaved change".
        const normClosing = closingReplyText.trim();
        const normOffer = lateCheckoutOfferText.trim();
        setClosingText(normClosing);
        setLateCheckoutOffer(normOffer);
        setBaseline({
          autoReplyDisclosure,
          handoffHoldHours,
          autoClosingReplyEnabled,
          closingReplyText: normClosing,
          lateCheckoutOfferText: normOffer,
          autoTaskFromMessageEnabled,
          autoCommitmentsEnabled,
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
      setError("İnternet bağlantınızda sorun var gibi görünüyor. Kontrol edip tekrar deneyin.");
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
          checked={autoClosingReplyEnabled}
          onChange={(e) => { setClosingReply(e.target.checked); setSaved(false); }}
          className="mt-0.5 size-4"
        />
        <span className="text-sm">
          <span className="font-medium">Teşekkür ve övgü mesajına nezaket yanıtı</span>
          <span className="block text-xs text-muted-foreground">
            Açarsanız: misafir &ldquo;teşekkürler / tamam / 👍&rdquo; gibi kısa bir kapanışla ya da yalnız
            övgüyle (&ldquo;her şey harikaydı!&rdquo;) yazdığında, kendi dilinde tek satırlık kibar bir yanıt
            otomatik gider; imzanız eklenir. İçinde soru, talep ya da şikâyet olan mesaja bu yanıt
            <span className="font-medium"> gitmez</span>. Aynı mesaja yalnız bir kez yanıt verilir. Kapalıyken
            nezaket yanıtı gitmez.
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
            Açarsanız: &ldquo;Sorunlu&rdquo; olan bir misafir mesajında arıza, eksik malzeme ya da temizlik
            şikâyeti varsa Görevler ekranınızda otomatik bir <span className="font-medium">görev</span> açılır
            (aynı daire, aynı gün, aynı konu için tek görev). Kapalıyken yalnız &ldquo;Sorunlu&rdquo; işareti ve
            e-posta olur, görev açılmaz.
          </span>
        </span>
      </label>

      {showCommitments && (
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={autoCommitmentsEnabled}
            onChange={(e) => { setCommitmentsAuto(e.target.checked); setSaved(false); }}
            className="mt-0.5 size-4"
            data-testid="auto-commitments-toggle"
          />
          <span className="text-sm">
            <span className="font-medium">Misafire verdiğiniz sözleri görev olarak kaydet</span>
            <span className="block text-xs text-muted-foreground">
              Misafire yazdığınız mesajda bir söz verirseniz (&ldquo;Yarın 10&apos;da teknisyen gelecek&rdquo;, &ldquo;Akşam havlu
              getireceğim&rdquo;) söz ve görev kendiliğinden kaydedilir. Saat yazmadıysanız saat eklenmez; gün ya da &ldquo;akşam&rdquo;
              olarak kaydedilir. Günde en çok 20 söz kaydedilir. Kapatırsanız mesajlarınızdan görev oluşturulmaz.
            </span>
          </span>
        </label>
      )}

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
          bu teklifi <span className="font-medium">yalnızca o soruda</span> misafire iletir; kesin söz vermez ve
          konuyu size bırakır (misafire &ldquo;size döneceğiz&rdquo; gibi bir söz gitmez — cevabı siz verin). Boş bırakırsanız
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
          Misafir sizinle görüşmek isteyince yapay zekânın beklemesi (saat)
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
          <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="size-4" /> Kaydedildi
          </span>
        ) : null}
      </div>
    </form>
  );
}
