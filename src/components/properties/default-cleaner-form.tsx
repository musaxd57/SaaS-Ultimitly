"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { confirmDialog } from "@/lib/confirm";

// ---------------------------------------------------------------------------
// "Bu dairenin temizlikçisi" (kurucu 11-05 gece): bir kez seçilir, sonraki temizlikler kabul beklemeden o kişinin iş listesine düşer.
// Kişi değişince ESKİ kişide duran başlanmamış gelecekteki temizlikler için AÇIK soru sorulur (gizli toplu değişiklik yok).
// Seçim AÇIK "Kaydet" ile yazılır (Opus 11-06 N11: seçim anında kaydediliyordu — taşıma sorusunu Esc ile kapatmak da "Hayır" sayılıp YENİ
// kişiyi kaydediyordu; yanlış seçimi geri almanın yolu yoktu). "Vazgeç" seçimi eski hâline döndürür, hiçbir şey yazılmaz.
// ---------------------------------------------------------------------------

export function DefaultCleanerForm({
  propertyId,
  propertyName,
  currentUserId,
  members,
  openFutureCount,
}: {
  propertyId: string;
  propertyName: string;
  currentUserId: string | null;
  members: { id: string; name: string }[];
  /** Şu anki temizlikçide duran başlanmamış gelecekteki temizlik sayısı. */
  openFutureCount: number;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(currentUserId ?? "");
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const dirty = value !== saved;

  async function save(next: string) {
    const nextName = members.find((m) => m.id === next)?.name ?? null;
    let moveOpen = false;
    if (currentUserId && next && next !== currentUserId && openFutureCount > 0) {
      moveOpen = await confirmDialog({
        // İsme ek GETİRİLMEZ (ünlü uyumu kodla doğru çekilemez: "Lale'in" — Opus 11-06 N9). Gövde DÜRÜST: elle atama iz bırakmadığından
        // "otomatik atanan" ile "ev sahibinin elle verdiği" ayırt edilemez → ikisi de geçer (Opus 11-06 N7); elle AÇILMIŞ görev geçmez.
        title: `${propertyName}: gelecekteki ${openFutureCount} açık temizlik de ${nextName ?? "yeni kişi"} adına geçsin mi?`,
        body: "Başlanmamış temizlikler geçer (“Yapılamıyor” denmiş ve elle atanmış olanlar dahil). Başlanmış işlere ve elle açtığınız görevlere dokunulmaz.",
        confirmLabel: "Evet, geçsin",
        cancelLabel: "Hayır, yalnız yeniler",
      });
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/default-cleaner`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: next || null, moveOpen }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string; fields?: { userId?: string } } | null;
        toast.error(data?.fields?.userId ?? data?.error ?? "Kaydedilemedi. Lütfen tekrar deneyin.");
        return;
      }
      setSaved(next);
      toast.success(next ? "Kaydedildi. Sonraki temizlikler bu kişiye atanacak." : "Kaydedildi. Temizlikler atanmadan açılacak.");
      router.refresh();
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {/* Görünür etiket (gerçek uygulama ekranı 11-06: kutu yalnız ekran okuyucu etiketiyle duruyordu — ne seçildiği belli değildi). */}
      <label htmlFor={`default-cleaner-${propertyId}`} className="text-sm font-medium">
        Bu dairenin temizlikçisi
      </label>
      <Select
        id={`default-cleaner-${propertyId}`}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        className="h-9 text-sm"
      >
        <option value="">Kimse (görevler atanmadan açılır)</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
      {dirty ? (
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => void save(value)}>
            Kaydet
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setValue(saved)}>
            Vazgeç
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Yeni rezervasyonun temizliği kabul beklemeden bu kişinin iş listesine düşer.</p>
    </div>
  );
}
