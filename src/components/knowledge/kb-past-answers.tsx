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

export interface TemplateSuggestion {
  propertyId: string;
  propertyName: string;
  category: string;
  title: string;
  content: string;
  language: string;
  sourceTemplateId: string;
  fromOrgWide: boolean;
}

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
  const [tpls, setTpls] = useState<TemplateSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  // 🚨 İKİ LİSTE, İKİ ANAHTAR UZAYI. Eskiden ikisi de `propertyId|category`
  // kullanıyordu: bir şablon önerisini eklemek AYNI mülk+kategorideki geçmiş
  // cevap kartını da "Eklendi" yapıp kilitliyordu (ve tersi). Aynı şablon iki
  // mülke önerilebildiği için şablon anahtarı MÜLKÜ de taşır.
  const keyOf = (s: PastAnswerSuggestion) => `p:${s.propertyId}|${s.category}`;
  const templateKeyOf = (s: TemplateSuggestion) => `t:${s.sourceTemplateId}|${s.propertyId}`;

  async function scan() {
    setLoading(true);
    try {
      const res = await fetch("/api/kb/suggestions");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        suggestions: PastAnswerSuggestion[];
        fromTemplates: TemplateSuggestion[];
      };
      setItems(data.suggestions);
      setTpls(data.fromTemplates ?? []);
      if (data.suggestions.length === 0 && (data.fromTemplates ?? []).length === 0) {
        toast.info("Tekrar eden bir cevap bulunamadı — aynı konuyu en az iki kez yanıtladığınızda burada görünür.");
      }
    } catch {
      toast.error("Geçmiş cevaplar okunamadı.");
    } finally {
      setLoading(false);
    }
  }

  /** Hem geçmiş cevap hem şablon önerisi aynı yoldan eklenir (tek yazma kapısı). */
  async function add(
    s: { propertyId: string; category: string; title?: string; content: string; language?: string },
    uiKey: string,
  ) {
    setBusy(uiKey);
    try {
      const res = await fetch("/api/kb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyId: s.propertyId,
          category: s.category,
          title: s.title || TITLE_BY_CATEGORY[s.category] || "Bilgi",
          content: s.content,
          language: s.language || "tr",
          isActive: true,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setAdded((prev) => new Set(prev).add(uiKey));
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

        {tpls && tpls.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">
              Şablonlarınızdan{" "}
              <span className="font-normal text-muted-foreground">
                — bu metinleri zaten yazmışsınız, ama asistan şablonları göremiyor. Eklerseniz görür.
              </span>
            </p>
            {tpls.map((s) => {
              const k = templateKeyOf(s);
              const isAdded = added.has(k);
              return (
                <div key={`t-${s.sourceTemplateId}-${s.propertyId}`} className="rounded-lg border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge tone={KB_CATEGORY.tone(s.category)}>{KB_CATEGORY.label(s.category)}</Badge>
                    {s.propertyName ? <Badge tone="secondary">{s.propertyName}</Badge> : null}
                    {s.fromOrgWide ? (
                      <span className="text-xs text-muted-foreground">tüm daireler için yazdığınız şablon</span>
                    ) : null}
                  </div>
                  <p className="mb-1 text-xs text-muted-foreground">{s.title}</p>
                  <p className="whitespace-pre-wrap text-sm">{s.content}</p>
                  <div className="mt-3">
                    <Button size="sm" onClick={() => add(s, k)} disabled={isAdded || busy === k}>
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
          </div>
        ) : null}

        {items && items.length > 0 ? (
          <p className="text-sm font-medium">
            Kendi cevaplarınızdan{" "}
            <span className="font-normal text-muted-foreground">— misafirlere tekrar tekrar yazdıklarınız.</span>
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
                <Button size="sm" onClick={() => add({ ...s, content: s.answer }, k)} disabled={isAdded || busy === k}>
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
