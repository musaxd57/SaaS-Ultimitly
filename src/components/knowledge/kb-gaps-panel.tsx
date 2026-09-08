"use client";

import { ClipboardList, MessageCircleQuestion, ShieldQuestion, Wand2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KB_CATEGORY } from "@/lib/constants";

// ---------------------------------------------------------------------------
// "KURULUM VE EKSİKLER" — host'un tamamlaması gereken işler (A3 + A4, 09-08).
//
// İki kaynak, TEK liste:
//  · KURULUM  — temel kategorilerde hiç kayıt yok (misafir sormamış olsa da).
//  · SORULDU  — misafirler o konuyu GERÇEKTEN sordu ama onaylı cevap yok.
// Sorulanlar üstte: ürünün kendi ölçtüğü boşluk, tahminî kontrol listesinden
// daha değerlidir.
//
// 🚨 HİÇBİRİ KESİN TESPİT DEĞİL. Başlıkta da yazıyor: bunlar İNCELEME ADAYI.
// Niyet sınıflandırması bir kelime ağıdır ve Türkçe olumsuz fiil boşluğu
// ÖLÇÜLMÜŞ bir açıktır (`docs/ACIK-2026-09-08-turkce-sikayet-siniflandirma-eksigi.md`),
// yani "bu kategori eksik" demek misafirin sorduğu şeyin eksik olduğunu
// kanıtlamaz. Metin bu yüzden "eklemelisiniz" değil "bakmak isteyebilirsiniz" der.
//
// 🚨 İKİ SINIFTA EKLEME DÜĞMESİ YOK — bilinçli:
//  · `ungrounded`        — kayıt VAR ve modele GİTTİ ama cevap ona dayanmadı.
//    Yeni kayıt eklemek burada YANLIŞ CEVAPTIR; sorun bilgi değil temellendirme.
//  · `awaiting_approval` — kayıt yazılmış, host onayı bekliyor. "Ekle" demek
//    host'a zaten yazdığı şeyi yeniden yazdırmak olurdu.
// ---------------------------------------------------------------------------

export interface KbGapView {
  propertyId: string;
  propertyName: string;
  kind: "asked" | "setup";
  category: string;
  questionCount: number;
  label: "absent" | "awaiting_approval" | "ungrounded";
  reviewCandidate: boolean;
}

/** Kaç satır çizilir — liste bir "iş yığını" değil, bir başlangıç noktası. */
const MAX_ROWS = 8;

function reasonText(g: KbGapView): string {
  if (g.label === "awaiting_approval") {
    return "Bu konuda bir kayıt yazılmış ama onayınızı bekliyor — yapay zekâ onu kullanmıyor.";
  }
  if (g.label === "ungrounded") {
    return `Kayıt var ve yanıtlarken okundu, ama son ${g.questionCount} soruda cevap ona dayanmadı. Yeni kayıt eklemek bunu çözmeyebilir; mevcut kaydın soruyu gerçekten karşılayıp karşılamadığına bakın.`;
  }
  if (g.kind === "asked") {
    return `Misafirler bu konuyu son 90 günde ${g.questionCount} kez sordu; bu dairede onaylı bir kayıt yok.`;
  }
  return "Bu dairede bu konuda henüz kayıt yok.";
}

export function KbGapsPanel({
  gaps,
  onFill,
}: {
  gaps: KbGapView[];
  /** Formu bu mülk + kategori için doldurur (şablon varsa metniyle birlikte). */
  onFill: (propertyId: string, category: string) => void;
}) {
  if (gaps.length === 0) return null;
  const rows = gaps.slice(0, MAX_ROWS);
  const hidden = gaps.length - rows.length;

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="size-4 text-muted-foreground" /> Kurulum ve eksikler
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          İnceleme adayları — kesin tespit değil. Yapay zekâ yalnız buradaki kayıtlardan cevap verir;
          eksik konularda soruyu ev sahibine devreder.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((g) => {
          const Icon = g.kind === "asked" ? MessageCircleQuestion : ShieldQuestion;
          return (
            <div
              key={`${g.propertyId}:${g.category}`}
              className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium">{KB_CATEGORY.label(g.category)}</span>
                  <Badge tone="muted">{g.propertyName}</Badge>
                  {g.kind === "asked" ? <Badge tone="warning">{g.questionCount} soru</Badge> : null}
                </div>
                <p className="text-xs leading-snug text-muted-foreground">{reasonText(g)}</p>
              </div>
              {g.reviewCandidate ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => onFill(g.propertyId, g.category)}
                >
                  <Wand2 className="mr-1.5 size-3.5" /> Şablonla doldur
                </Button>
              ) : null}
            </div>
          );
        })}
        {hidden > 0 ? (
          <p className="text-xs text-muted-foreground">
            +{hidden} konu daha. Yukarıdakileri tamamladıkça liste kendiliğinden kısalır.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
