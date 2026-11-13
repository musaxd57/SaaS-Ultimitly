import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { cn } from "@/lib/utils";
import { OVERALL_LABEL, type Factor, type FactorLink, type Overall } from "@/lib/readiness-list/evaluate";
import { CONNECT_CHANNEL_HREF } from "@/components/connect-channel-button";

// ---------------------------------------------------------------------------
// "Girişler" listesinin görünümü (salt-okuma, sunucu bileşeni — istemci durumu yok). Satır başına bir konaklama: genel durum +
// faktörler (durum cümlesi + eksik kalan şart). Bilinmeyen gri, engel kırmızı, temizlik hazır yeşil; v1'de "HAZIR" etiketi yok (H-2).
// ---------------------------------------------------------------------------

export interface ArrivalsListRow {
  reservationId: string;
  propertyId: string;
  propertyName: string;
  guestName: string | null;
  dayKey: string;
  dayLabel: string;
  checkInTime: string | null;
  conversationId: string | null;
  overall: Overall;
  factors: Factor[];
}

const OVERALL_TONE: Record<Overall, "destructive" | "muted" | "success"> = {
  not_ready: "destructive",
  unknown: "muted",
  cleaning_ready: "success",
};

const DOT: Record<Factor["state"], string> = {
  blocking: "bg-red-500",
  unknown: "bg-slate-400",
  ok: "bg-emerald-500",
  info: "bg-sky-500",
};

/** Satırın çözüldüğü ekran (UX-10 D2). Karar değerlendiricide (`Factor.link`); burada yalnız adres + metin. Yoksa `null`. */
export function factorLinkTarget(
  link: FactorLink | undefined,
  row: { propertyId: string; conversationId: string | null },
  canConnect: boolean,
): { href: string; label: string } | null {
  if (!link) return null;
  const pid = encodeURIComponent(row.propertyId);
  switch (link.to) {
    case "task":
      return {
        href: `/tasks?propertyId=${pid}${link.taskId ? `#task-${encodeURIComponent(link.taskId)}` : ""}`,
        label: link.note ? "Notu okuyun" : "Görevi açın",
      };
    case "tasks":
      return { href: `/tasks?propertyId=${pid}`, label: "Görevleri açın" };
    case "auto_message":
      return {
        href: `/properties/${pid}#otomatik-mesajlar`,
        label: link.reason === "fix" ? "Mesajı düzeltin" : link.reason === "check" ? "Mesajı kontrol edin" : "Giriş mesajını yazın",
      };
    case "conversation":
      return row.conversationId ? { href: `/inbox/${encodeURIComponent(row.conversationId)}`, label: link.need ? "Konuşmada görün" : "Konuşmayı açın" } : null;
    case "property_times":
      return { href: `/properties/${pid}`, label: "Çıkış saatini girin" };
    case "connection":
      // Bağlantıyı yalnız hesap sahibi / operatör kurar (tek kural `connect-channel-button.tsx`); yöneticiye düğme yok.
      return canConnect ? { href: CONNECT_CHANNEL_HREF, label: "Bağlantıyı kurun" } : null;
    case "calendar":
      return { href: `/calendar?property=${pid}`, label: "Takvimde görün" };
    case "refresh":
      return { href: "/arrivals", label: "Yenileyin" };
  }
}

function FactorLine({ f, row, canConnect }: { f: Factor; row: { propertyId: string; conversationId: string | null }; canConnect: boolean }) {
  const target = factorLinkTarget(f.link, row, canConnect);
  return (
    <li className="flex gap-2 text-sm" data-state={f.state}>
      <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[f.state])} />
      <span className="min-w-0">
        <span className="text-foreground">{f.label}</span>
        {f.missing && (f.state === "blocking" || f.state === "unknown") ? <span className="text-muted-foreground"> — eksik: {f.missing}</span> : null}
        {target ? (
          <>
            {" "}
            <Link
              href={target.href}
              data-factor-link={f.link?.to}
              className="inline-flex min-h-10 items-center font-medium text-primary hover:underline sm:min-h-0"
            >
              {target.label}
            </Link>
          </>
        ) : null}
      </span>
    </li>
  );
}

/**
 * Açılır "Ayrıntılar"a YALNIZ saf bağlam iner: önceki çıkış → giriş saati ve düşük öncelikli bakım. Geri kalan her satır HEP görünür
 * (Opus 11-06 N5): temizlikçinin notu (misafire giden otomatik erken giriş onayını durdurur), açık misafir ihtiyacı, söz ve ERİŞİM satırı —
 * H-2: erişim "kontrol edilmedi" satırı gizlenmez, gizlemek "her şey hazır" izlenimi verirdi. Codex'in sadeliği: açıklama kısa, bağlam kapalı.
 */
const isContextOnly = (f: Factor) => f.key === "timing" || (f.key === "issue" && f.state === "info");

/** Hep görünenler (sıra korunur). */
function primaryOf(factors: Factor[]): { f: Factor; i: number }[] {
  return factors.map((f, i) => ({ f, i })).filter(({ f }) => !isContextOnly(f));
}

/** Açılır "Ayrıntılar": yalnız bağlam satırları. */
function restOf(factors: Factor[]): { f: Factor; i: number }[] {
  return factors.map((f, i) => ({ f, i })).filter(({ f }) => isContextOnly(f));
}

/**
 * UX-10 D1 (kurucu 11-13; B066 / D050): üç gün HER ZAMAN başlığıyla görünür — boş gün başlıksız kaybolunca "liste eksik mi yüklendi?" sorusu
 * doğuyordu. Boş günün altında tek sönük satır "Giriş yok.". 🚨 Liste en çok `READINESS_LIST_MAX` giriş gösterir ve varış sırasıyla keser:
 * kesilmişse son gösterilen günden SONRAKİ günlere "Giriş yok." YAZILMAZ (yalan olurdu) — "Bu günün girişleri listeye sığmadı." yazar.
 * Hiç giriş yoksa tek sonraki adım: işletmede mülk yoksa mülk eklemeye, varsa takvime.
 */
export type ArrivalsEmptyNextStep = "add-property" | "calendar" | null;

export function ArrivalsList({
  rows,
  truncated,
  days: dayList,
  emptyNextStep = null,
  canConnect = false,
}: {
  rows: ArrivalsListRow[];
  truncated: number;
  /** Penceredeki günler (bugün + iki gün), sırayla. Verilmezse yalnız satırı olan günler (eski davranış). */
  days?: { key: string; label: string }[];
  emptyNextStep?: ArrivalsEmptyNextStep;
  /** Bağlantıyı kurabilecek kişi mi (hesap sahibi / operatör) — "Bağlantıyı kurun" yalnız ona. */
  canConnect?: boolean;
}) {
  if (rows.length === 0 && !dayList) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">Bugün ve sonraki iki günde giriş yok.</CardContent>
      </Card>
    );
  }
  const days: { key: string; label: string; rows: ArrivalsListRow[] }[] = dayList
    ? dayList.map((d) => ({ key: d.key, label: d.label, rows: rows.filter((r) => r.dayKey === d.key) }))
    : [];
  if (!dayList) {
    for (const r of rows) {
      const last = days.at(-1);
      if (last && last.key === r.dayKey) last.rows.push(r);
      else days.push({ key: r.dayKey, label: r.dayLabel, rows: [r] });
    }
  }
  const lastShownDay = rows.at(-1)?.dayKey ?? null;
  const cutOff = (dayKey: string) => truncated > 0 && lastShownDay !== null && dayKey > lastShownDay;
  return (
    <div className="space-y-6">
      {days.map((d) => (
        <section key={d.key} className="space-y-3" aria-label={d.label}>
          <h2 className="text-sm font-semibold text-muted-foreground">{d.label}</h2>
          {d.rows.length === 0 ? (
            <p data-empty-day className="text-sm text-muted-foreground">
              {cutOff(d.key) ? "Bu günün girişleri listeye sığmadı." : "Giriş yok."}
            </p>
          ) : null}
          {d.rows.map((r) => (
            <Card key={r.reservationId} data-testid="arrival-row" data-overall={r.overall}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground">
                      {r.propertyName}
                      {r.checkInTime ? <span className="font-normal text-muted-foreground"> · giriş {r.checkInTime}</span> : null}
                    </div>
                    {r.guestName ? <div className="truncate text-sm text-muted-foreground">{r.guestName}</div> : null}
                  </div>
                  <Badge tone={OVERALL_TONE[r.overall]}>{OVERALL_LABEL[r.overall]}</Badge>
                </div>
                {/* Codex 11-05 (görsel inceleme): önce ne eksik — engeller ve bilinmeyenler hep görünür; bilgi satırları açılır "Ayrıntılar"da. */}
                <ul className="space-y-1.5">
                  {primaryOf(r.factors).map(({ f, i }) => (
                    <FactorLine key={`${f.key}-${i}`} f={f} row={r} canConnect={canConnect} />
                  ))}
                </ul>
                {restOf(r.factors).length > 0 ? (
                  <details className="group">
                    <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
                      Ayrıntılar ({restOf(r.factors).length})
                    </summary>
                    <ul className="mt-1.5 space-y-1.5">
                      {restOf(r.factors).map(({ f, i }) => (
                        <FactorLine key={`${f.key}-${i}`} f={f} row={r} canConnect={canConnect} />
                      ))}
                    </ul>
                  </details>
                ) : null}
                <div className="flex flex-wrap gap-3 text-sm">
                  {r.conversationId ? (
                    <Link href={`/inbox/${r.conversationId}`} className="text-primary hover:underline">
                      Konuşma
                    </Link>
                  ) : null}
                  <Link href={`/properties/${r.propertyId}`} className="text-primary hover:underline">
                    Mülk
                  </Link>
                  {/* Bu dairenin görevleri (satırdaki görev dayanakları orada açılır). */}
                  <Link href={`/tasks?propertyId=${encodeURIComponent(r.propertyId)}`} className="text-primary hover:underline">
                    Görevler
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      ))}
      {truncated > 0 ? (
        <p className="text-sm text-muted-foreground">Ayrıca {truncated} giriş daha var; liste ilk {rows.length} girişi gösteriyor.</p>
      ) : null}
      {rows.length === 0 && emptyNextStep === "add-property" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">Girişleriniz burada görünür. Önce mülkünüzü ekleyin.</p>
          <LinkButton href="/properties/new" size="sm">
            Mülk ekleyin
          </LinkButton>
        </div>
      ) : rows.length === 0 && emptyNextStep === "calendar" ? (
        <LinkButton href="/calendar" size="sm" variant="outline">
          Takvimi açın
        </LinkButton>
      ) : null}
    </div>
  );
}
