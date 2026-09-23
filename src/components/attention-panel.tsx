import Link from "next/link";
import { AlertTriangle, CalendarRange, CalendarX2, Clock, LogOut, Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { signalCategoryLabel } from "@/modules/intelligence/labels";
import type { AttentionItem, AttentionKind } from "@/modules/intelligence/incidents/attention";

// ---------------------------------------------------------------------------
// V2.1 — "Dikkat Gerektirenler" kartı.
//
// 🚨 SAKİN GÜNDE HİÇ BASMAZ (`null` döner). Boş durum metni, "şu an sorun yok"
// rozeti, gri bir kutu YOK: her gün orada duran bir uyarı kartı üç günde duvar
// kâğıdına döner ve gerçekten bir şey olduğunda da görülmez. Panelin kendi
// notunun şartı buydu.
//
// 🚨 SÖZ, KESİNLİK DERECESİNE GÖRE KURULUR. `certainty: "inferred"` satırlar
// (tekrar eden arıza) kelime ağıyla sınıflandırılmış sinyallerden türüyor —
// Türkçe olumsuz fiil boşluğu ÖLÇÜLMÜŞ bir açık. O yüzden bu satırlar açıkça
// "otomatik sınıflandırma" diye işaretlenir ve emir kipi kullanılmaz.
// ---------------------------------------------------------------------------

const ICONS: Record<AttentionKind, typeof AlertTriangle> = {
  feed_broken: CalendarX2,
  departing_unanswered: LogOut,
  unanswered_aging: Clock,
  recurring_issue: Repeat,
  calendar_conflict: CalendarRange,
};

/** "5 Eki" — takvim günü; saat dilimi kaydırması olmasın diye UTC okunur (anahtar zaten gün). */
function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });
}

function headline(item: AttentionItem): string {
  switch (item.kind) {
    case "feed_broken":
      return `${item.sourceLabel ?? "Takvim"} bağlantısı güncellenemiyor`;
    case "departing_unanswered":
      return `Çıkışı yaklaşan misafir ${item.hoursWaiting ?? 0} saattir cevap bekliyor`;
    case "unanswered_aging":
      return `${item.hoursWaiting ?? 0} saattir cevapsız misafir mesajı`;
    case "recurring_issue":
      return `${signalCategoryLabel(item.category ?? "")} tekrar ediyor`;
    case "calendar_conflict":
      return item.possibleDuplicate ? "Aynı rezervasyon iki kez görünüyor olabilir" : "Aynı gecelere iki rezervasyon var";
  }
}

function detail(item: AttentionItem): string {
  switch (item.kind) {
    case "feed_broken":
      // Ne olduğunu DEĞİL, host için ne anlama geldiğini söyler.
      return `${item.propertyName} · bu kanaldan yeni rezervasyon gelmiyor olabilir`;
    case "departing_unanswered":
    case "unanswered_aging":
      return item.propertyName;
    case "recurring_issue":
      return `${item.propertyName} · ${item.evidenceCount ?? 0} sinyal`;
    case "calendar_conflict": {
      const range = item.nights ? `${dayLabel(item.nights.from)} – ${dayLabel(item.nights.to)}` : "";
      return `${item.propertyName} · ${range} · takvimi kontrol edin`;
    }
  }
}

export function AttentionPanel({ items }: { items: AttentionItem[] }) {
  // 🚨 Sessiz gün = hiç render yok.
  if (items.length === 0) return null;

  return (
    <Card className="border-amber-300 dark:border-amber-700/60">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-500" />
          Dikkat Gerektirenler
        </CardTitle>
        <Badge tone="warning">{items.length}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => {
          const Icon = ICONS[item.kind];
          return (
            <Link
              key={`${item.kind}:${item.href}:${item.occurredAt.getTime()}`}
              href={item.href}
              className="flex items-start gap-3 rounded-lg border border-border px-3 py-2 hover:bg-accent"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{headline(item)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {detail(item)}
                  {item.certainty === "inferred" ? (
                    // Kesin tespit DEĞİL — host'un doğrulaması gerekiyor.
                    <span className="ml-1 text-amber-700 dark:text-amber-500">
                      · otomatik sınıflandırma, doğrulayın
                    </span>
                  ) : null}
                </p>
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
