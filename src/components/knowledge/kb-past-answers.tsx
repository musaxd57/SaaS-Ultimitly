"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KB_CATEGORY } from "@/lib/constants";
import { toast } from "@/lib/toast";

// ---------------------------------------------------------------------------
// KNOWLEDGE HUB BACAK B — "Kendi cevaplarınızdan öneriler".
//
// Kurucu (09-11): *"geçmiş host cevaplarını da kaynak yapalım"*. Host aynı soruyu
// defalarca elle cevaplamışsa ürün bunu ÖĞRENMELİ — yoksa her seferinde yeniden
// devrediyor ve *"AI sus pus"* kalıyor.
//
// 🚨 BU KART, ŞABLON KARTININ ZITTIDIR. "Şablonla doldur" host'a içinde
// `[ŞİFRE]` boşlukları olan bir paragraf verip DOLDURMASINI istiyor — kurucunun
// ölçülü şikâyeti: *"adam 0'dan yazsa daha iyi"*. Burada doldurulacak HİÇBİR ŞEY
// YOK: metin host'un KENDİ yazdığı, TAMAMLANMIŞ cevabıdır. Tek tık = ekle.
//
// ⚠️ HİÇBİR ŞEY OTOMATİK KAYDEDİLMEZ. "Ekle" mevcut `POST /api/kb` yolundan
// gider ve orada `host_manual`/`approved` damgalanır (A1 onay sözleşmesi).
// ---------------------------------------------------------------------------

export interface PastAnswerSuggestion {
  propertyId: string;
  propertyName: string | null;
  category: string;
  answer: string;
  occurrences: number;
  exampleQuestion: string;
}

const TITLE_BY_CATEGORY: Record<string, string> = {
  wifi: "Wi-Fi bilgisi",
  parking: "Otopark",
  location: "Konum ve ulaşım",
  cleaning: "Temizlik",
};

export function KbPastAnswers() {
  const router = useRouter();
  const [items, setItems] = useState<PastAnswerSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const keyOf = (s: PastAnswerSuggestion) => `${s.propertyId}|${s.category}`;

  async function scan() {
    setLoading(true);
    try {
      const res = await fetch("/api/kb/suggestions");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { suggestions: PastAnswerSuggestion[] };
      setItems(data.suggestions);
      if (data.suggestions.length === 0) {
        toast.info("Tekrar eden bir cevap bulunamadı — aynı konuyu en az iki kez yanıtladığınızda burada görünür.");
      }
    } catch {
      toast.error("Geçmiş cevaplar okunamadı.");
    } finally {
      setLoading(false);
    }
  }

  async function add(s: PastAnswerSuggestion) {
    setBusy(keyOf(s));
    try {
      const res = await fetch("/api/kb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyId: s.propertyId,
          category: s.category,
          title: TITLE_BY_CATEGORY[s.category] ?? "Bilgi",
          content: s.answer,
          language: "tr",
          isActive: true,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setAdded((prev) => new Set(prev).add(keyOf(s)));
      toast.success("Bilgi tabanına eklendi.");
      router.refresh();
    } catch {
      toast.error("Eklenemedi.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" aria-hidden />
          Kendi cevaplarınızdan öneriler
        </CardTitle>
        <Button variant="outline" size="sm" onClick={scan} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
          {items === null ? "Tara" : "Yeniden tara"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Misafirlere <strong>kendi yazdığınız</strong> cevaplardan, birden çok kez tekrarladıklarınızı buluruz.
          Doldurmanız gereken bir şey yok — metin sizin cümlenizdir, beğenirseniz tek tıkla eklenir.
        </p>

        {items !== null && items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tekrar eden bir cevap bulunamadı. Aynı konuyu en az iki kez yanıtladığınızda burada görünür.
          </p>
        ) : null}

        {items?.map((s) => {
          const k = keyOf(s);
          const isAdded = added.has(k);
          return (
            <div key={k} className="rounded-lg border p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={KB_CATEGORY.tone(s.category)}>{KB_CATEGORY.label(s.category)}</Badge>
                {s.propertyName ? <Badge tone="secondary">{s.propertyName}</Badge> : null}
                <span className="text-xs text-muted-foreground">{s.occurrences} kez cevapladınız</span>
              </div>
              <p className="mb-1 text-xs text-muted-foreground">
                Örnek soru: <span className="italic">“{s.exampleQuestion}”</span>
              </p>
              <p className="whitespace-pre-wrap text-sm">{s.answer}</p>
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
