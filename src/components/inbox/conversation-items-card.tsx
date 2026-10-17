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
 * gösteririz (bayrak kapalıyken öğe yazılmadığı için kart da yok).
 */
export function ConversationItemsCard({
  conversationId,
  items,
  canManage,
}: {
  conversationId: string;
  items: ConversationItemRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (items.length === 0) return null;

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

  const openCount = items.filter((i) => i.open).length;
  return (
    <Card data-testid="conversation-items">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="size-4 text-muted-foreground" /> Açık işler
          {openCount > 0 ? <Badge tone="warning">{openCount}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{i.kindLabel}</p>
              <p className="text-xs text-muted-foreground">{i.at}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={i.tone}>{i.statusLabel}</Badge>
              {i.open && canManage ? (
                <Button variant="outline" size="sm" onClick={() => done(i.id)} disabled={busy !== null}>
                  {busy === i.id ? <Loader2 className="size-4 animate-spin" /> : null}
                  Tamamlandı
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
