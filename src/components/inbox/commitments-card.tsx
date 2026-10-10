"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HandHeart, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { COMMITMENT_KINDS, COMMITMENT_KIND_LABELS, commitmentDurationLabel, type CommitmentKind } from "@/lib/guest-commitments-core";

export interface CommitmentRow {
  id: string;
  kind: CommitmentKind;
  /** Son an, ev sahibinin saatiyle (sunucu biçimledi). */
  dueLabel: string;
  /** Sayfa açıldığında son ana kalan dakika (eksi = gecikti). */
  minutesLeft: number;
}

/**
 * AÇIK TAAHHÜT HAFIZASI A (kurucu kararı 10-10) — konuşma sayfasında "Misafire verilen sözler" kartı. Ev sahibi misafire bir söz verdiğinde
 * (ör. "havlular 18:00'e kadar") burada işaretler: söz + bağlı görev açılır; görev tamamlanınca söz kapanır. Misafire HİÇBİR ŞEY gönderilmez;
 * söz metni saklanmaz (yalnız tür + saat).
 */
export function CommitmentsCard({
  conversationId,
  commitments,
  readOnly,
}: {
  conversationId: string;
  commitments: CommitmentRow[];
  /** Bürünme (salt-okunur destek görünümü): liste görünür, işlem yok. */
  readOnly: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<CommitmentKind>("towels");
  const [day, setDay] = useState<"today" | "tomorrow">("today");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function add() {
    if (!/^\d{2}:\d{2}$/.test(time)) {
      toast.error("Saati seçin.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/commitments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, day, time }),
      });
      if (res.ok) {
        toast.success("Söz kaydedildi, görev açıldı.");
        setTime("");
        router.refresh();
      } else {
        const body = (await res.json().catch(() => null)) as { fields?: Record<string, string> } | null;
        toast.error(body?.fields ? Object.values(body.fields).join(" ") : "Kaydedilemedi. Lütfen tekrar deneyin.");
      }
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setSaving(false);
    }
  }

  async function cancel(id: string) {
    if (!window.confirm("Bu söz iptal edilsin mi? Bağlı görev silinmez.")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/commitments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      if (res.ok) router.refresh();
      else toast.error("İptal edilemedi. Lütfen tekrar deneyin.");
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card data-testid="guest-commitments">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HandHeart className="size-4 text-muted-foreground" /> Misafire verilen sözler
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {commitments.length === 0 ? (
          <p className="text-muted-foreground">Açık söz yok.</p>
        ) : (
          <ul className="space-y-2">
            {commitments.map((c) => {
              const late = c.minutesLeft < 0;
              return (
                <li key={c.id} className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{COMMITMENT_KIND_LABELS[c.kind]}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.dueLabel} ·{" "}
                      <Badge tone={late ? "destructive" : "secondary"} className="align-middle">
                        {late ? `${commitmentDurationLabel(c.minutesLeft)} gecikti` : `${commitmentDurationLabel(c.minutesLeft)} kaldı`}
                      </Badge>
                    </div>
                  </div>
                  {readOnly ? null : (
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={busy === c.id} onClick={() => void cancel(c.id)}>
                      {busy === c.id ? <Loader2 className="size-3 animate-spin" /> : null}
                      İptal
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {readOnly ? null : (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              Misafire bir şey için saat verdiyseniz işaretleyin: görev açılır, görev tamamlanınca söz kapanır. Misafire mesaj gitmez.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="Söz türü"
                className="col-span-2 h-8 rounded-md border bg-background px-2 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as CommitmentKind)}
              >
                {COMMITMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {COMMITMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Gün"
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={day}
                onChange={(e) => setDay(e.target.value === "tomorrow" ? "tomorrow" : "today")}
              >
                <option value="today">Bugün</option>
                <option value="tomorrow">Yarın</option>
              </select>
              <input
                aria-label="Saat"
                type="time"
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
            <Button type="button" size="sm" className="w-full" disabled={saving} onClick={() => void add()}>
              {saving ? <Loader2 className="size-3 animate-spin" /> : null}
              Söz ekle
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
