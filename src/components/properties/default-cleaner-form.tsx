"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

// ---------------------------------------------------------------------------
// "Bu dairenin temizlikçisi" (kurucu 11-05 gece): bir kez seçilir, sonraki temizlikler kabul beklemeden o kişinin iş listesine düşer.
// Seçim AÇIK "Kaydet" ile yazılır (Opus 11-06 N11). Kişi değişirken eski kişide duran görevler için TEK toplu onay YOK (kurucu / Codex 11-06
// K-1): aktarılabilir (başlanmamış ya da "Yapılamıyor") görevler sayı + tarih aralığı + liste olarak gösterilir, ev sahibi SEÇER; başlanmış
// işler ayrı listelenir ve aktarılmaz (ev sahibi Görevler'den ayrıca değerlendirir); tamamlananlar hiç gösterilmez (geçmiş korunur).
// ---------------------------------------------------------------------------

export interface TransferItem {
  id: string;
  /** "7 Kas 2026" gibi gün (tek tarih kuralı — sunucuda hazırlanır). */
  dueLabel: string | null;
  title: string;
  statusLabel: string;
}

export function DefaultCleanerForm({
  propertyId,
  currentUserId,
  members,
  movable,
  started,
  listTruncated = false,
}: {
  propertyId: string;
  currentUserId: string | null;
  members: { id: string; name: string }[];
  /** Şu anki temizlikçide duran, AKTARILABİLİR gelecekteki temizlikler (eskiden yeniye). */
  movable: TransferItem[];
  /** Şu anki temizlikçide duran, başlanmış (aktarılmayan) gelecekteki temizlikler. */
  started: TransferItem[];
  /** Liste üst sınıra takıldı (sessiz kesme yok — Haiku 11-06). */
  listTruncated?: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(currentUserId ?? "");
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  /** Aktarma sorusu açıkken: seçili görevler. */
  const [selected, setSelected] = useState<Set<string> | null>(null);
  // Sayfa yenilenince sunucunun kaydı esastır (Haiku 11-06): başka bir yönetici kişiyi değiştirdiyse form ona döner ve açık soru kapanır —
  // yoksa eski kişi görünür, yeni kişinin işleri "aktarılacak" diye listelenirdi. (Durum değişikliği çizim sırasında: React'in önerdiği kalıp.)
  const [seenProp, setSeenProp] = useState(currentUserId ?? "");
  if ((currentUserId ?? "") !== seenProp) {
    setSeenProp(currentUserId ?? "");
    setSaved(currentUserId ?? "");
    setValue(currentUserId ?? "");
    setSelected(null);
  }
  // Seçim YALNIZ şu an listede olan işlerden sayılır ve gönderilir (liste yenilenip bir iş başlanmış tarafa geçtiyse sayı yalan söylemesin).
  const chosen = selected ? movable.filter((m) => selected.has(m.id)).map((m) => m.id) : [];
  const dirty = value !== saved;
  const nextName = members.find((m) => m.id === value)?.name ?? null;

  function onSave() {
    // Başka bir kişiye geçiliyor ve eski kişide aktarılabilir iş var → önce sor (varsayılan: hepsi seçili; ev sahibi çıkarır).
    if (saved && value && value !== saved && movable.length > 0) {
      setSelected(new Set(movable.map((m) => m.id)));
      return;
    }
    void submit(value, undefined);
  }

  async function submit(next: string, moveTaskIds: string[] | undefined) {
    setBusy(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/default-cleaner`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: next || null, ...(moveTaskIds ? { moveTaskIds } : {}) }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; fields?: { userId?: string }; moved?: number; skipped?: number }
        | null;
      if (!res.ok) {
        toast.error(data?.fields?.userId ?? data?.error ?? "Kaydedilemedi. Lütfen tekrar deneyin.");
        return;
      }
      setSaved(next);
      setSelected(null);
      const moved = data?.moved ?? 0;
      const skipped = data?.skipped ?? 0;
      const base = next ? "Kaydedildi. Sonraki temizlikler bu kişiye atanacak." : "Kaydedildi. Temizlikler atanmadan açılacak.";
      toast.success(moved > 0 ? `${base} ${moved} görev aktarıldı.` : base);
      if (skipped > 0) toast.error(`${skipped} görev aktarılamadı: bu arada başlanmış ya da değişmiş. Görevler'den bakın.`);
      router.refresh();
    } catch {
      toast.error("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  const range =
    movable.length > 0 && movable[0].dueLabel
      ? movable.length > 1 && movable[movable.length - 1].dueLabel && movable[movable.length - 1].dueLabel !== movable[0].dueLabel
        ? `${movable[0].dueLabel} – ${movable[movable.length - 1].dueLabel}`
        : movable[0].dueLabel
      : null;

  return (
    <div className="space-y-2">
      {/* Görünür etiket (gerçek uygulama ekranı 11-06). */}
      <label htmlFor={`default-cleaner-${propertyId}`} className="text-sm font-medium">
        Bu dairenin temizlikçisi
      </label>
      <Select
        id={`default-cleaner-${propertyId}`}
        value={value}
        disabled={busy || selected !== null}
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

      {dirty && selected === null ? (
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={onSave}>
            Kaydet
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setValue(saved)}>
            Vazgeç
          </Button>
        </div>
      ) : null}

      {selected !== null ? (
        <section aria-label="Mevcut görevleri aktarma" className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
          <p>
            <strong>{nextName ?? "Yeni kişi"}</strong> bundan sonraki temizliklerde kullanılacak. Ayrıca mevcut {movable.length} başlanmamış görevi
            de aktarmak ister misiniz?
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {movable.length} görev{range ? ` · ${range}` : ""}
            </span>
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
              disabled={busy}
              onClick={() => setSelected(chosen.length === movable.length ? new Set() : new Set(movable.map((m) => m.id)))}
            >
              {chosen.length === movable.length ? "Seçimi kaldır" : "Tümünü seç"}
            </button>
          </div>
          {listTruncated ? (
            <p className="text-xs text-muted-foreground">Listede ilk {movable.length} görev var; kalanları Görevler sayfasından değiştirin.</p>
          ) : null}
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {movable.map((m) => (
              <li key={m.id}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    disabled={busy}
                    checked={selected.has(m.id)}
                    onChange={(e) => {
                      const nextSel = new Set(selected);
                      if (e.target.checked) nextSel.add(m.id);
                      else nextSel.delete(m.id);
                      setSelected(nextSel);
                    }}
                  />
                  <span>
                    {m.dueLabel ? `${m.dueLabel} · ` : ""}
                    {m.title} · <span className="text-muted-foreground">{m.statusLabel}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {started.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              <p>Başlanmış işler aktarılmaz (gerekirse Görevler&apos;den değiştirin):</p>
              <ul className="list-disc pl-5">
                {started.map((s) => (
                  <li key={s.id}>
                    {s.dueLabel ? `${s.dueLabel} · ` : ""}
                    {s.title} · {s.statusLabel}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">Tamamlanan işler ve elle açtığınız görevler değişmez.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy || chosen.length === 0} onClick={() => void submit(value, chosen)}>
              Kaydet ve seçilenleri aktar ({chosen.length})
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void submit(value, [])}>
              Yalnız kaydet
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setSelected(null);
                setValue(saved);
              }}
            >
              Vazgeç
            </Button>
          </div>
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">Yeni rezervasyonun temizliği kabul beklemeden bu kişinin iş listesine düşer.</p>
    </div>
  );
}
