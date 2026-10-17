import Link from "next/link";
import { AlertTriangle, ClipboardList, HelpCircle, Sparkles } from "lucide-react";
import { riskTypeLabel } from "@/lib/ui-labels";
import { fromNow } from "@/lib/utils";

// ---------------------------------------------------------------------------
// m48 — "Açık sorunlar · triyaj" paneli.
//
// 🚨 BURADA MODEL ÇAĞRISI YOK ve OLMAYACAK. Panel yalnız escalation ANINDA
// yazılmış analizi okuyor. İkinci bir çağrı KIRPILMIŞ metinden, bilgi tabanı ve
// rezervasyon GÖRMEDEN koşardı — yani birincisinden DAHA KÖTÜ bir analiz üretip
// günlük AI kotasını harcardı.
//
// ⚠️ Neden `/inbox`, neden ayrı sayfa/panel DEĞİL:
//   · Host sorunu okuyup CEVAP YAZACAK; cevap gelen kutusunda yazılıyor.
//   · Kenar çubuğu 14 satır ve 803 CSS px; bütçe 808.4 (`app-shell` ölçümü).
//     15. satır 768px'te kaydırma çubuğu doğurur.
//   · `/reports`'taki "AI Risk Görünümü" 30 GÜNLÜK GEÇMİŞ sayıyor; "şu an açık"
//     kavramı yok. Yan yana koymak tekrar üretirdi.
//
// ⚠️ TEMİZLEME YOK (kullanıcı+Codex kararı): kolonlar konuşma "problem"den
// çıkarken SİLİNMİYOR, tarihsel kayıt olarak kalıyor. Görünürlüğü sağlayan şey
// çağıranın `status: "problem"` filtresi — panel kendi başına filtrelemez.
// ---------------------------------------------------------------------------

export interface TriageRow {
  id: string;
  propertyName: string;
  lastMessageAt: Date;
  riskType: string | null;
  actionSuggestion: string | null;
  missingInfo: string[];
  source: string | null;
  /** Tetikleyici mesajdan sonra yeni mesaj geldi mi (↓rozet). */
  stale: boolean;
}

export function ProblemTriagePanel({ rows, timeZone }: { rows: TriageRow[]; timeZone: string }) {
  if (rows.length === 0) return null;

  // Gruplama `lastRiskType` (11'lik kapalı set); etiketler `ui-labels.ts`'ten.
  // Etiketsiz/None satırlar tek bir "Diğer" kovasında toplanır — kaybolmazlar.
  const groups = new Map<string, TriageRow[]>();
  for (const r of rows) {
    const key = riskTypeLabel(r.riskType) || "Diğer";
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  return (
    <section
      aria-labelledby="triage-heading"
      className="space-y-3 rounded-lg border border-orange-200 bg-orange-50/60 p-4 dark:border-orange-500/25 dark:bg-orange-500/5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="triage-heading" className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="size-4 text-orange-600 dark:text-orange-400" />
          Açık sorunlar — triyaj
        </h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length} konuşma
        </span>
      </div>

      {[...groups.entries()].map(([label, list]) => (
        <div key={label} className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {label} · {list.length} konuşma
          </p>
          {list.map((r) => (
            <div key={r.id} className="rounded-md border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/inbox/${r.id}`} className="text-sm font-medium hover:underline">
                  {r.propertyName}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {fromNow(r.lastMessageAt, timeZone)} bekliyor
                </span>
                {/* 🚨 YANLIŞ-POZİTİF İŞARETİ. Ölçülmüş gerçek vaka:
                    "Can you send location link. Its not working" → intent
                    `complaint`, çünkü "not working" düz bir kelime eşleşmesi.
                    O yol model çapraz-kontrolü OLMADAN escalate ediyor ve
                    host'a "acil misafir mesajı" maili atıyor. Kaynak kolonu
                    bunu GÖRÜNÜR kılar — NULL'dan çıkarım yapılmaz. */}
                {r.source === "keyword" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                    <Sparkles className="size-3" />
                    Yalnız kelime eşleşmesi — AI doğrulaması yok
                  </span>
                ) : null}
                {/* Bayat: analiz BİR mesaja ait; sonrasında yeni mesaj geldiyse
                    öneri yanlış olabilir. SİLMEK yerine SÖYLEMEK — silmek
                    host'un faydalanabileceği bilgiyi yok etmek olurdu. */}
                {r.stale ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    Bu analizden sonra yeni mesaj geldi
                  </span>
                ) : null}
              </div>

              {r.actionSuggestion ? (
                <p className="mt-2 flex items-start gap-2 text-sm">
                  <ClipboardList className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="font-medium">Önerilen adım:</span> {r.actionSuggestion}
                  </span>
                </p>
              ) : null}

              {r.missingInfo.length > 0 ? (
                <p className="mt-1.5 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                  <HelpCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <span className="font-medium">Eksik bilgi:</span> {r.missingInfo.join(" · ")}
                  </span>
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
