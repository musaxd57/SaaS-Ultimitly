"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListChecks, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

export interface ConversationItemRow {
  id: string;
  kindLabel: string;
  /** Kısa konu etiketi (migration 84; misafir kaynaklı, kod süzdü — "sauna"). Yoksa yalnız tür adı görünür. */
  topic?: string | null;
  statusLabel: string;
  tone: "destructive" | "warning" | "secondary" | "success" | "muted";
  /** Ev sahibinin işi mi (açık / size bırakıldı) — yalnız bunlarda "Tamamlandı" düğmesi. */
  open: boolean;
  /** Mesajın yazıldığı an (ev sahibinin saatinde, sunucu biçimledi). */
  at: string;
}

/**
 * KONUŞMA ÖĞELERİ — konuşma sayfasındaki "Açık işler" kartı (kurucu kararı 09-26: "Liste + konuşma + Dikkat"). Misafirin
 * cevapsız mesajlarındaki istekler: açık olanlar üstte; ev sahibi "Tamamlandı" ile kapatır. Kartı yalnız öğe varsa
 * gösteririz (bayrak kapalıyken öğe yazılmadığı için kart da yok). Satır kuralı `itemRowsForCard` (açıkların hepsi; rozet `openTotal`).
 * Okuma düştüyse (`loadFailed`, Codex 11-17 H8) kart KAYBOLMAZ: "açık iş yok" ile "okunamadı" ayırt edilsin. Bu durumun ev sahibi metni
 * için YENİ metin yazılmadı: üründe zaten kullanılan genel cümle gösterilir (`history-learn-panel` ile aynı); karta özgü metin kurucu
 * onayında.
 */
/** Okuma düştüğünde gösterilen cümle — üründe var olan genel metin (yeni metin değil; `history-learn-panel` aynı cümleyi kullanır). */
const LOAD_FAILED_TEXT = "Durum okunamadı. Sayfayı yenileyin.";

export function ConversationItemsCard({
  conversationId,
  items,
  openTotal,
  loadFailed = false,
  canManage,
}: {
  conversationId: string;
  items: ConversationItemRow[];
  /** Ev sahibinde açık öğelerin TOPLAMI (görünen satırlardan sayılmaz). */
  openTotal: number;
  /** Öğeler okunamadı (sayfa ayakta; kart boş görünmesin). */
  loadFailed?: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (items.length === 0 && !loadFailed) return null;

  async function done(itemId: string) {
    setBusy(itemId);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "done" }),
      });
      if (res.ok) router.refresh();
      else toast.error("İşaretlenemedi. Lütfen tekrar deneyin.");
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(null);
    }
  }

  if (loadFailed) {
    return (
      <Card data-testid="conversation-items" data-load-failed="true">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="size-4 text-muted-foreground" /> Açık işler
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p role="status" className="text-sm text-muted-foreground">
            {LOAD_FAILED_TEXT}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="conversation-items">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="size-4 text-muted-foreground" /> Açık işler
          {openTotal > 0 ? <Badge tone="warning">{openTotal}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {i.kindLabel}
                {i.topic ? <span className="text-muted-foreground"> · {i.topic}</span> : null}
              </p>
              <p className="text-xs text-muted-foreground">{i.at}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={i.tone}>{i.statusLabel}</Badge>
              {i.open && canManage ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => done(i.id)}
                  disabled={busy !== null}
                  aria-label={`Bitti olarak işaretle: ${i.kindLabel}${i.topic ? ` · ${i.topic}` : ""}`}
                >
                  {busy === i.id ? <Loader2 className="size-4 animate-spin" /> : null}
                  Bitti olarak işaretle
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
