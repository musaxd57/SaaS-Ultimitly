"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { CHECKIN_LEAD_DAYS } from "@/lib/lifecycle-window";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import {
  AUTO_MESSAGE_ISSUE_TEXT,
  AUTO_MESSAGE_LABEL,
  AUTO_MESSAGE_MAX_CHARS,
  type AutoMessageIssue,
  type AutoMessageKind,
} from "@/lib/auto-messages/render";

/**
 * OTOMATİK MESAJLAR (kurucu T4, 10-21): misafire otomatik giden karşılama / giriş / çıkış metni, bilgi tabanından AYRI. Kurucu kuralları:
 * kaydetmeden önce misafire gidecek metnin önizlemesi gösterilir (önizlenmemiş taslak kaydedilemez) · boş ya da doldurulamayan alan taşıyan
 * mesaj gönderilmez, ev sahibi burada uyarı görür. Müşteri metni sade (kurucu 09-23).
 */
interface Preview {
  text: string;
  issue: AutoMessageIssue | null;
  unfilledTokens: string[];
}
export interface AutoMessageCardItem {
  kind: AutoMessageKind;
  body: string;
  revision: number;
  needsReview: boolean;
  lastSkipReason: string | null;
  kbChangedAfter: boolean;
  preview: Preview;
}

const HINT: Record<AutoMessageKind, string> = {
  welcome: "Rezervasyon yapılınca gider.",
  checkin: `Girişe ${CHECKIN_LEAD_DAYS} gün kala gider (adres, kapı kodu, Wi-Fi gibi bilgiler için).`,
  checkout: "Çıkış günü sabah gider.",
};

function IssueNote({ preview }: { preview: Preview }) {
  if (!preview.issue) return null;
  const tokens = preview.issue === "unfilled" && preview.unfilledTokens.length > 0 ? ` (${preview.unfilledTokens.join(", ")})` : "";
  return (
    <p className="text-xs text-amber-700 dark:text-amber-500" data-testid="auto-message-issue">
      {AUTO_MESSAGE_ISSUE_TEXT[preview.issue]}
      {tokens}
    </p>
  );
}

function AutoMessageEditor({ propertyId, item, canEdit }: { propertyId: string; item: AutoMessageCardItem; canEdit: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState(item.body);
  const [revision, setRevision] = useState(item.revision);
  const [saved, setSaved] = useState(item.body);
  // Önizlenen metin + sonucu: kaydet düğmesi YALNIZ şu anki taslak önizlendiyse açılır.
  const [preview, setPreview] = useState<{ forText: string; result: Preview } | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft !== saved;
  const previewed = preview?.forText === draft;

  async function showPreview() {
    setError(null);
    setBusy("preview");
    try {
      const res = await fetch(`/api/properties/${propertyId}/auto-messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: item.kind, body: draft }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.preview) {
        setError(data?.fields?.body ?? "Önizleme gösterilemedi. Tekrar deneyin.");
        return;
      }
      setPreview({ forText: draft, result: data.preview });
    } catch {
      // UX inceleme 10-21 (H): bağlantı koparsa dönen simge kayboluyor, hiçbir şey yazmıyordu.
      setError("Bağlantı koptu. İnternetinizi kontrol edip tekrar deneyin.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setError(null);
    setBusy("save");
    try {
      const res = await fetch(`/api/properties/${propertyId}/auto-messages`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: item.kind, body: draft, expectedRevision: revision }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? data?.fields?.body ?? "Kaydedilemedi. Tekrar deneyin.");
        return;
      }
      setRevision(data.revision);
      setSaved(draft);
      setPreview({ forText: draft, result: data.preview });
      toast.success(`${AUTO_MESSAGE_LABEL[item.kind]} kaydedildi.`);
      router.refresh();
    } catch {
      setError("Bağlantı koptu. İnternetinizi kontrol edip tekrar deneyin.");
    } finally {
      setBusy(null);
    }
  }

  const current = previewed ? preview!.result : !dirty ? item.preview : null;
  const id = `auto-message-${item.kind}`;
  return (
    <div className="space-y-2" data-testid={id}>
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {AUTO_MESSAGE_LABEL[item.kind]}
        </label>
        <p className="text-xs text-muted-foreground">{HINT[item.kind]}</p>
      </div>
      {item.needsReview ? (
        <p className="text-xs text-amber-700 dark:text-amber-500">
          Bu daire için birden fazla kayıt vardı; en son eklenen seçildi. Metni kontrol edip kaydedin.
        </p>
      ) : null}
      {item.lastSkipReason && !dirty && current?.issue ? (
        <p className="text-xs text-amber-700 dark:text-amber-500">Bu mesaj son denemede gönderilmedi.</p>
      ) : null}
      {item.kbChangedAfter ? (
        <p className="text-xs text-muted-foreground">
          Bilgi tabanındaki ilgili kayıt bu mesajdan sonra değişti. Otomatik mesaj kendiliğinden değişmez; gerekiyorsa burada da güncelleyin.
        </p>
      ) : null}
      <Textarea
        id={id}
        rows={6}
        value={draft}
        maxLength={AUTO_MESSAGE_MAX_CHARS}
        disabled={!canEdit}
        placeholder="Bu mesaj boşsa gönderilmez."
        onChange={(e) => setDraft(e.target.value)}
      />
      {current ? (
        <div className="space-y-1 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">Misafire böyle gider (örnek ad: Ayşe)</p>
          {current.text ? <p className="whitespace-pre-wrap break-words text-sm">{current.text}</p> : null}
          <IssueNote preview={current} />
        </div>
      ) : dirty ? (
        <p className="text-xs text-muted-foreground">Kaydetmeden önce önizleyin.</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {canEdit && dirty ? (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy !== null} onClick={showPreview}>
            {busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : null}
            Önizle
          </Button>
          <Button type="button" disabled={busy !== null || !previewed} onClick={save}>
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null}
            Kaydet
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function AutoMessagesCard({ propertyId, items, canEdit }: { propertyId: string; items: AutoMessageCardItem[]; canEdit: boolean }) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Misafire otomatik giden mesajlar. Bilgi tabanındaki değişiklikler bu mesajları değiştirmez; burada kaydettiğiniz metin gider. Mesajda
        &#123;isim&#125; misafirin adıyla, &#123;daire&#125; daire numarasıyla doldurulur. Gönderimi açıp kapatmak Ayarlar&apos;dadır.
      </p>
      {items.map((item) => (
        <AutoMessageEditor key={item.kind} propertyId={propertyId} item={item} canEdit={canEdit} />
      ))}
    </div>
  );
}
