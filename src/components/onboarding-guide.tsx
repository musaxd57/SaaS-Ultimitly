"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ArrowRight, Rocket, ChevronUp, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface OnboardingStep {
  done: boolean;
  title: string;
  desc: string;
  href: string;
  cta: string;
}

// Per-browser display state. Kept in localStorage so it needs no schema change
// / API call — it cannot affect the working product, and the server still hides
// the card outright once every step is done.
//
// 🚨 ANAHTAR ADI "dismissed" AMA ARTIK "KATLANMIŞ" DEMEK — ad KASTEN
// DEĞİŞTİRİLMEDİ: daha önce × ile gizlemiş hostların tarayıcısında bu değer
// duruyor ve yeni adla okunsaydı kart onlara sıfırdan AÇIK gelirdi. Aynı
// anahtarı okuyarak o hostlar sessizlik yerine ŞERİDİ görüyor — yani düzeltme
// geriye dönük de çalışıyor.
const DISMISS_KEY = "lixus_onboarding_dismissed";
// Son görülen tamamlanma sayısı. Sunucu bileşeni "az önce bir adım bitti"
// olayını göndermiyor; farkı istemcide burada saklayarak üretiyoruz.
const SEEN_COUNT_KEY = "lixus_onboarding_seen_count";
// 🚨 "BİR KEZ TAMAMLANDI" MÜHRÜ — kalıcı, geri dönüşü yok (kullanıcı kararı).
// Sorun: kart yalnız `allDone` iken gizleniyordu, yani host kurulumu bitirip
// SONRADAN otomatik yanıtı kapatınca 6/6 → 5/6'ya düşüyor ve kart GERİ GELİYORDU.
// Ama o adım artık bir "kurulum eksiği" değil, host'un bilinçli tercihi — kurulum
// rehberi onu azarlamamalı. Bir kez 6/6 görüldüyse rehber bir daha ASLA açılmaz.
// ⚠️ Tarayıcı başına: sunucuda saklamak `Organization`'a kolon = migration demek
// ve kullanıcı onayı ister. Yeni bir tarayıcıda kurulum ZATEN bitmiş olduğu için
// en fazla bir kez kutlama görünür, sonra o tarayıcıda da susar — kabul edilebilir.
const COMPLETED_KEY = "lixus_onboarding_completed";

/**
 * "Başlarken" checklist shown on the dashboard until the account is set up.
 *
 * 🚨 KAPATMA GERİ ALINABİLİR — "BİR DAHA GÖSTERME" YOK.
 * Eskiden × düğmesi kartı KALICI olarak yok ediyordu: uyarı yoktu, geri dönüş
 * yolu yoktu ve yanlışlıkla basan host kalan kurulum adımlarını bir daha
 * göremiyordu (kullanıcı bildirdi). Artık × yerine ChevronUp var ve kapatınca
 * `null` değil bir ŞERİT kalıyor — tek tıkla geri açılıyor.
 * ⚠️ Onay kutusu (`confirmDialog`) BİLİNÇLİ eklenmedi: o yardımcı kendi
 * dokümanında YIKICI işlemler için tanımlı (`lib/confirm.ts`), katlama ise
 * görünür ve tek tıkla geri alınabilir — modal, bedelsiz bir eylemin önüne
 * sürtünme koymak olurdu.
 */
export function OnboardingGuide({ steps }: { steps: OnboardingStep[] }) {
  // Start shown on both server and first client render (no hydration mismatch);
  // collapse after mount if the host previously collapsed it.
  const [collapsed, setCollapsed] = useState(false);
  // İlerleme çubuğunun BAŞLANGIÇ değeri: son görülen sayı. Mount'tan sonra
  // gerçek değere geçiyoruz ki `transition` gerçekten koşsun (eskiden değer
  // doğrudan yazılıyordu ve çubuk ZIPLIYORDU, animasyon hiç görünmüyordu).
  const [seenCount, setSeenCount] = useState<number | null>(null);
  const [barPct, setBarPct] = useState<number | null>(null);

  const doneCount = steps.filter((s) => s.done).length;

  // `null` = henüz bilinmiyor (SSR + ilk render). Üçüncü durum ŞART: sunucuda
  // localStorage yok, `false` ile başlasaydı mührü olan hostta kart bir an
  // görünüp kaybolurdu (flaş).
  const [completedBefore, setCompletedBefore] = useState<boolean | null>(null);

  useEffect(() => {
    let prev = 0;
    // 🚨 `completedBefore` HER HÂLDE AYARLANMALI — `try` İÇİNE ALMA.
    // Bu satır bir kez `try`'ın İÇİNDE ve `setItem`'dan SONRA duruyordu: gizli
    // sekmede / kota dolduğunda `setItem` atıyor, bu satıra hiç gelinmiyor ve
    // `completedBefore` sonsuza kadar `null` kalıyordu → aşağıdaki
    // `completedBefore === null` kapısı kartı KALICI OLARAK gizliyordu.
    // Yani aşağıdaki catch'in "kartı göstermeye düş" sözü TERSİNE dönmüştü:
    // depolama çalışmayan tarayıcıda kurulum rehberi HİÇ görünmüyordu.
    // Varsayılan `false` = "mühür yok" = kartı göster (güvenli yön).
    let completedSeal = false;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") setCollapsed(true);
      // Mührü ÖNCE oku: `setItem` atsa bile okunan değer elimizde kalsın.
      completedSeal = localStorage.getItem(COMPLETED_KEY) === "1";
      prev = Number(localStorage.getItem(SEEN_COUNT_KEY) ?? "0") || 0;
      localStorage.setItem(SEEN_COUNT_KEY, String(doneCount));
      // Mührü ŞİMDİ basma — bu render'da kutlamayı göstereceğiz. Damga aşağıdaki
      // ikinci effect'te, kutlama ekranda göründükten SONRA basılır.
    } catch {
      // localStorage can throw in private mode — fall back to showing the card.
    }
    setCompletedBefore(completedSeal);
    setSeenCount(prev);
    // Önce eski orana kur, SONRAKİ karede yenisine geç → geçiş tetiklenir.
    setBarPct((prev / steps.length) * 100);
    const raf = requestAnimationFrame(() => setBarPct((doneCount / steps.length) * 100));
    return () => cancelAnimationFrame(raf);
  }, [doneCount, steps.length]);

  // "Az önce ilerledi" — yalnız bu turda artmışsa efekt oynar, her yüklemede DEĞİL.
  const justAdvanced = seenCount !== null && doneCount > seenCount;

  // Mührü kutlama EKRANA GELDİKTEN sonra bas: ilk effect'te basılsaydı aynı
  // render'da `completedBefore` true olur ve host kutlamayı HİÇ göremezdi.
  useEffect(() => {
    if (completedBefore !== false || doneCount !== steps.length) return;
    try {
      localStorage.setItem(COMPLETED_KEY, "1");
    } catch {
      // Gizli sekmede atabilir — bir sonraki yüklemede kutlama tekrar görünür.
    }
  }, [completedBefore, doneCount, steps.length]);
  // The first not-yet-done step is the one we nudge them toward next.
  const nextIndex = steps.findIndex((s) => !s.done);

  const setStored = (collapse: boolean) => {
    try {
      if (collapse) localStorage.setItem(DISMISS_KEY, "1");
      else localStorage.removeItem(DISMISS_KEY);
    } catch {
      // Ignore — worst case the card reappears on next load.
    }
    setCollapsed(collapse);
  };

  // 🚨 6/6 KAPISI SUNUCUDAN İSTEMCİYE TAŞINDI — ama SSR'da yine HİÇBİR ŞEY
  // basılmıyor. Sebep: kutlama anı ancak "az önce bitti" bilgisiyle anlamlı ve
  // o bilgi (son görülen sayı) yalnız istemcide var. Sunucu kapısı dururken bu
  // dal ULAŞILAMAZDI; kapıyı komple kaldırsaydım da kurulumu ÇOKTAN bitmiş her
  // host sayfada bir kart görüp kapatmak zorunda kalırdı.
  // `seenCount === null` hem SSR'da hem ilk istemci render'ında geçerli → 6/6
  // durumunda çıktı BOŞ, yani "bir an görünüp kaybolma" (flash) da olmuyor.
  const allDone = doneCount === steps.length;
  // 🚨 MÜHÜR HER ŞEYDEN ÖNCE GELİR (kullanıcı kararı): bir kez 6/6 görüldüyse
  // rehber bir daha AÇILMAZ — host sonradan otomatik yanıtı kapatıp 5/6'ya
  // düşse bile. O adım artık eksik bir kurulum değil, bilinçli bir tercih.
  // `null` = henüz okunmadı (SSR/ilk render) → hiçbir şey basma, flaş olmasın.
  if (completedBefore === null || completedBefore) return null;
  if (allDone && !justAdvanced) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setStored(false)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-primary/30 bg-accent/30 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60"
      >
        <Rocket className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="font-medium">Kurulum rehberi</span>
        <span className="text-xs text-muted-foreground">
          {doneCount}/{steps.length} tamam
        </span>
        <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    );
  }

  return (
    <Card className="border-primary/30 bg-accent/30">
      <CardContent className="relative p-5">
        {/* ⚠️ İKON `X` DEĞİL `ChevronUp` — söz verdiği şey farklı. × "kaldır"
            der ve host haklı olarak kalıcı sanar; chevron "katla" der. */}
        <button
          type="button"
          onClick={() => setStored(true)}
          aria-label="Kurulum rehberini küçült"
          title="Küçült"
          className="absolute right-2.5 top-2.5 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronUp className="size-4" />
        </button>

        <div className="flex items-center gap-3 pr-8">
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              doneCount === steps.length
                ? "bg-success text-success-foreground"
                : "bg-primary text-primary-foreground",
              justAdvanced && (doneCount === steps.length ? "lxo-launch-box" : "lxo-boost"),
            )}
          >
            {/* 🚀 KUTLAMA: roket kutudan ÇIKIP uçar, yerine tik oturur.
                Kullanıcının tarifi: "yerinden çıkıp gidiyor gibi". Kutu yerinde
                kalır — uçsaydı başlıkta boşluk açılırdı.
                ⚠️ `justAdvanced` şart: kutlama YALNIZ 6/6'ya AZ ÖNCE ulaşıldığında
                oynar; kalıcı mühür sayesinde zaten bir daha görünmez. */}
            {justAdvanced && doneCount === steps.length ? (
              <>
                <Rocket className="lxo-launch absolute size-5" aria-hidden="true" />
                <CheckCircle2 className="lxo-check size-5" aria-hidden="true" />
              </>
            ) : (
              <Rocket className="size-5" aria-hidden="true" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">
              {doneCount === steps.length
                ? "Kurulum tamam — Lixus AI hazır"
                : `Başlarken — kurulumun ${doneCount}/${steps.length} tamam`}
            </p>
            <p className="text-xs text-muted-foreground">
              {doneCount === steps.length
                ? "Her şey yerinde. Bu rehberi kapatabilirsiniz."
                : "Birkaç adımda Lixus AI misafirlerinize yanıt vermeye başlasın."}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "lxo-bar h-full rounded-full",
              doneCount === steps.length ? "bg-success" : "bg-primary",
            )}
            // `barPct` mount'tan ÖNCE null: sunucu çıktısı gerçek oranı gösterir
            // (JS kapalıysa da doğru), mount sonrası geçiş devralır.
            style={{ width: `${barPct ?? (doneCount / steps.length) * 100}%` }}
          />
        </div>

        <ol className="mt-4 space-y-2">
          {steps.map((s, i) => {
            const isNext = i === nextIndex;
            return (
              <li
                key={s.title}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2.5",
                  s.done
                    ? "border-border bg-card/50"
                    : isNext
                      ? "border-primary/40 bg-card"
                      : "border-border bg-card/50",
                )}
              >
                <span className="shrink-0">
                  {s.done ? (
                    <CheckCircle2
                      className={cn(
                        "size-5 text-emerald-600 dark:text-emerald-400",
                        // Yalnız YENİ tamamlananlar patlar — hepsi değil.
                        justAdvanced && seenCount !== null && i >= seenCount && "lxo-pop",
                      )}
                    />
                  ) : (
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold",
                        isNext ? "border-primary text-primary" : "border-muted-foreground/40 text-muted-foreground",
                      )}
                    >
                      {i + 1}
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", s.done && "text-muted-foreground line-through")}>
                    {s.title}
                  </p>
                  {!s.done ? <p className="text-xs text-muted-foreground">{s.desc}</p> : null}
                </div>
                {!s.done ? (
                  <Link
                    href={s.href}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                      isNext
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "border border-border hover:bg-accent",
                    )}
                  >
                    {s.cta} <ArrowRight className="size-3.5" />
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
