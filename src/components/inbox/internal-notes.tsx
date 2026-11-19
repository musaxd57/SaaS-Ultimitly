"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, NotebookPen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { newKbRequestId } from "@/lib/kb/request-id";
import { INTERNAL_NOTE_MAX_CHARS } from "@/lib/internal-notes/core";

export interface InternalNoteRow {
  id: string;
  body: string;
  authorName: string;
  /** Yazılma anı, ev sahibinin saatiyle (sunucu biçimledi). */
  createdLabel: string;
  /** Bu kişi silebilir mi (yazan ya da sahip — sunucu karar verdi). */
  canDelete: boolean;
}

/**
 * İÇ NOTLAR (dilim D1, tasarım `docs/TASARIM-2026-11-18-gercek-konusma-ve-ic-not.md` §3.1) — konuşma sayfasının yan sütununda, mesaj
 * akışının DIŞINDA. Ekibin kendi kaydı (telefon görüşmesi, kapıda söylenen, hatırlatma): misafire gitmez, cevap sayılmaz, hiçbir işi
 * kapatmaz. Bilerek mesaj balonu gibi GÖRÜNMEZ (sade liste). Not konuşmanın konaklamasına bağlanır (bağ sunucuda çözülür).
 */
export function InternalNotesCard({
  conversationId,
  notes,
  readOnly,
}: {
  conversationId: string;
  notes: InternalNoteRow[];
  /** Bürünme (salt-okunur destek görünümü): liste görünür, ekleme / silme yok. */
  readOnly: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // İK-3 (kurucu 11-19): not KALICI silinir → satırdaki "Sil" önce AYNI satırda kısa onay açar, istek yalnız onaydaki "Sil" ile gider.
  // Tek durum = aynı anda tek satırda onay açık (başka satırın "Sil"i onayı oraya taşır). Odak düzeni öteki satır içi onaylarla aynı
  // (erişilebilirlik 10-22): onay açılınca odak "Vazgeç"e iner; kapanınca açan "Sil"e döner — yoksa açan düğme kalkıp odak sayfanın
  // başına düşüyordu.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const deleteTriggers = useRef(new Map<string, HTMLButtonElement>());
  const focusTriggerLater = (id: string) => requestAnimationFrame(() => deleteTriggers.current.get(id)?.focus());
  // İstek kimliği METİN başına: çift tık / kopan bağlantıdan sonra aynı metinle yeniden deneme AYNI kimliği taşır (sunucu var olan notu
  // döndürür, ikinci not açılmaz); metin değişince ya da kayıt kesinleşince yeni kimlik.
  const requestId = useRef<string>(newKbRequestId());

  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/internal-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, body: text, requestId: requestId.current }),
      });
      if (res.ok) {
        requestId.current = newKbRequestId();
        setText("");
        router.refresh();
      } else {
        const body = (await res.json().catch(() => null)) as { fields?: Record<string, string>; error?: string } | null;
        // 409 (aynı kimlik başka bir notla): kimlik yenilenir — sonraki basış bilinçli yeni kayıttır.
        if (res.status === 409) requestId.current = newKbRequestId();
        toast.error(body?.fields ? Object.values(body.fields).join(" ") : (body?.error ?? "Kaydedilemedi. Lütfen tekrar deneyin."));
      }
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/internal-notes/${encodeURIComponent(id)}`, { method: "DELETE" });
      // 404 = not zaten silinmiş (başka sekmede) → hata değil, liste yenilenir.
      if (res.ok || res.status === 404) router.refresh();
      else {
        toast.error("Silinemedi. Sayfayı yenileyip tekrar deneyin.");
        focusTriggerLater(id);
      }
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
      focusTriggerLater(id);
    } finally {
      setBusy(null);
      // Yalnız BU notun onayı kapanır: istek sürerken başka satırda açılan onay yerinde kalır.
      setConfirmId((cur) => (cur === id ? null : cur));
    }
  }

  return (
    <Card data-testid="internal-notes">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <NotebookPen className="size-4 text-muted-foreground" /> İç notlar
        </CardTitle>
        <p className="text-xs text-muted-foreground">Misafire gitmez.</p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {notes.length === 0 ? (
          <p className="text-muted-foreground">Henüz not yok.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="border-b pb-2 last:border-b-0 last:pb-0" data-testid="internal-note">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-xs text-muted-foreground">
                    {n.authorName} · {n.createdLabel}
                  </div>
                  {readOnly || !n.canDelete ? null : confirmId === n.id ? (
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs">
                      <span>Bu not silinsin mi?</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs text-destructive"
                        disabled={busy === n.id}
                        onClick={() => void remove(n.id)}
                      >
                        {busy === n.id ? <Loader2 className="size-3 animate-spin" /> : null}
                        Sil
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        autoFocus
                        disabled={busy === n.id}
                        onClick={() => {
                          setConfirmId(null);
                          focusTriggerLater(n.id);
                        }}
                      >
                        Vazgeç
                      </Button>
                    </span>
                  ) : (
                    <Button
                      ref={(el) => {
                        if (el) deleteTriggers.current.set(n.id, el);
                        else deleteTriggers.current.delete(n.id);
                      }}
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2 text-xs"
                      disabled={busy === n.id}
                      onClick={() => setConfirmId(n.id)}
                    >
                      Sil
                    </Button>
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
        {readOnly ? null : (
          <div className="space-y-2 border-t pt-3">
            <label htmlFor="internal-note-text" className="text-xs font-medium">
              İç not ekle
            </label>
            <Textarea
              id="internal-note-text"
              value={text}
              maxLength={INTERNAL_NOTE_MAX_CHARS}
              placeholder="Telefon görüşmesi, kapıda söylenen, hatırlatma…"
              className="min-h-[64px]"
              onChange={(e) => {
                if (e.target.value !== text) requestId.current = newKbRequestId();
                setText(e.target.value);
              }}
            />
            <Button type="button" size="sm" className="w-full" disabled={saving || !text.trim()} onClick={() => void save()}>
              {saving ? <Loader2 className="size-3 animate-spin" /> : null}
              Kaydet
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
