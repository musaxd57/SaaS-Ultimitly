"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KB_CATEGORY } from "@/lib/constants";
import { toast } from "@/lib/toast";
import type { TemplateSuggestion } from "@/components/knowledge/kb-past-answers";

// ---------------------------------------------------------------------------
// ŞABLONLARINIZDAN — kurucu kararı 09-11.
//
// 🚨 NEDEN AYRI BİR BİLEŞEN: bu bacak ÖNCE `KbPastAnswers` kartının içinde
// yaşıyordu; o kart (geçmiş host cevaplarından öneri) ÖLÇÜLEN bir kusur yüzünden
// kaldırıldı ve ŞABLON bacağı da onunla birlikte ÖLÜ KODA döndü — yani kurucunun
// açıkça istediği özellik ("şablondan bilgilerden veri alsın") aynı push içinde
// erişilemez oldu. İnceleme ajanı yakaladı. İki bacak artık AYRI: tehlikeli olan
// kapalı, çalışan olan canlı. Bir daha aynı sepette taşınmayacaklar.
//
// Kapatılan bacağın gerekçesi ve geri açma ön koşulları `kb-past-answers.tsx`
// başlığında ve CLAUDE.md'de duruyor.
//
// ⚠️ HİÇBİR ŞEY OTOMATİK KAYDEDİLMEZ. "Ekle" mevcut `POST /api/kb` yolundan
// gider ve orada `host_manual`/`approved` damgalanır (A1 onay sözleşmesi).
// ---------------------------------------------------------------------------

export function KbTemplateSuggestions() {
  const router = useRouter();
  const [items, setItems] = useState<TemplateSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  // 🚨 BOŞ SONUÇ EKRANI İŞGAL ETMEZ (kurucu 09-11, canlı ekran görüntüsü):
  // "tara" dedikten sonra sonuç yoksa kart TAM BOY kalıp yer kaplıyordu.
  // Artık tek satıra iner; host isterse tamamen kapatır.
  // ⚠️ Kapatma OTURUMLUKTUR, kalıcı değil — AI öneri panelinin aynı kararı
  // (CLAUDE.md): kalıcı tercih ayrı bir karardır, sessizce icat edilmez.
  const [dismissed, setDismissed] = useState(false);
  const empty = items !== null && items.length === 0;

  /** Aynı şablon iki mülke önerilebilir → anahtar MÜLKÜ de taşır. */
  const keyOf = (s: TemplateSuggestion) => `${s.sourceTemplateId}|${s.propertyId}`;

  async function scan() {
    setLoading(true);
    try {
      const res = await fetch("/api/kb/suggestions");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { fromTemplates?: TemplateSuggestion[] };
      const rows = data.fromTemplates ?? [];
      setItems(rows);
      if (rows.length === 0) {
        toast.info("Şablonlarınızda bilgi tabanına eklenebilecek yeni bir metin bulunamadı.");
      }
    } catch {
      toast.error("Şablonlar okunamadı.");
    } finally {
      setLoading(false);
    }
  }

  async function add(s: TemplateSuggestion) {
    const k = keyOf(s);
    setBusy(k);
    try {
      const res = await fetch("/api/kb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyId: s.propertyId,
          category: s.category,
          title: s.title,
          content: s.content,
          language: s.language,
          isActive: true,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setAdded((prev) => new Set(prev).add(k));
      toast.success("Bilgi tabanına eklendi.");
      router.refresh();
    } catch {
      toast.error("Eklenemedi.");
    } finally {
      setBusy(null);
    }
  }

  if (dismissed) return null;

  // Sonuç YOK → tek satır. Açıklama paragrafı burada GEREKSİZ: host zaten
  // "Tara"ya bastı, cevabı aldı; uzun metin yalnız yer kaplar.
  if (empty) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <FileText className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0">
          Şablonlarınızda eklenebilecek yeni metin yok.{" "}
          <span className="hidden sm:inline">
            (Giriş/çıkış saati gibi mülk alanları ve içinde <code>{"{{...}}"}</code> gibi doldurulmamış alan
            bulunan şablonlar bilerek dışarıda kalır.)
          </span>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={scan} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Yeniden tara
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDismissed(true)} aria-label="Bu kartı kapat">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" aria-hidden />
          Şablonlarınızdan
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={scan} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            {items === null ? "Tara" : "Yeniden tara"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDismissed(true)} aria-label="Bu kartı kapat">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Şablonlarınızdaki metinler misafire <strong>aynen</strong> gider ama asistan onları göremez. Buradan
          eklerseniz görür — metin sizin cümlenizdir, doldurmanız gereken bir şey yok.
        </p>

        {items?.map((s) => {
          const k = keyOf(s);
          const isAdded = added.has(k);
          return (
            <div key={k} className="rounded-lg border p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={KB_CATEGORY.tone(s.category)}>{KB_CATEGORY.label(s.category)}</Badge>
                <Badge tone="secondary">{s.propertyName}</Badge>
                {s.fromOrgWide ? (
                  <span className="text-xs text-muted-foreground">tüm daireler için yazdığınız şablon</span>
                ) : null}
              </div>
              <p className="mb-1 text-xs text-muted-foreground">{s.title}</p>
              <p className="whitespace-pre-wrap text-sm">{s.content}</p>
              <div className="mt-3">
                <Button size="sm" onClick={() => add(s)} disabled={isAdded || busy === k}>
                  {busy === k ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  {isAdded ? "Eklendi" : "Bilgi tabanına ekle"}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
