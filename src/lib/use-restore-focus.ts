"use client";

import { useEffect, useRef } from "react";

/**
 * "İstek biterken odağı geri ver" kancası.
 *
 * NEDEN GEREKLİ: bir kontrol `disabled` olduğunda tarayıcı odağı `<body>`'ye
 * atar ve kontrol yeniden etkinleştiğinde odak KENDİLİĞİNDEN geri gelmez.
 * Klavye/ekran-okuyucu kullanıcısı bir düğmeye basıp isteğin bitmesini
 * bekledikten sonra sayfanın başında bulur kendini — özellikle hata dalında
 * kötü, çünkü tam da yeniden denemesi gereken düğmeye ulaşmak için baştan
 * Tab'lamak zorunda kalır. Odak geri geldiğinde ekran okuyucu düğmeyi (varsa
 * `aria-pressed` durumuyla birlikte) yeniden okur, yani sonuç da duyulmuş olur.
 *
 * NEDEN EFFECT, NEDEN `finally` DEĞİL: odaklamayı isteğin `finally`'sinde
 * yapmak ÇALIŞMAZ. `setBusy(false)` o anda henüz işlenmemiştir, öğe hâlâ
 * `disabled`'dır ve `.focus()` sessizce hiçbir şey yapmaz. Bu tuzak gerçek bir
 * hata ayıklama turuna mal oldu; bilgi burada, tek yerde duruyor.
 *
 * `arm()` ÇAĞRILMADAN odak alınmaz: ilk mount'ta ya da kullanıcının başlatmadığı
 * bir yeniden render'da odağı ÇALMAK, kullanıcıyı okuduğu yerden koparırdı.
 *
 * Kullanım:
 *   const { ref, arm } = useRestoreFocusOnIdle<HTMLButtonElement>(busy);
 *   async function run() { arm(); setBusy(true); … }
 *   <button ref={ref} disabled={busy} onClick={run} />
 */
export function useRestoreFocusOnIdle<T extends HTMLElement>(busy: boolean) {
  const ref = useRef<T | null>(null);
  const armed = useRef(false);

  useEffect(() => {
    if (busy || !armed.current) return;
    armed.current = false;
    const el = ref.current;
    // `isConnected`: satır/kart bu arada DOM'dan kalkmış olabilir (silme
    // başarılıysa öyle olur) — kaybolmuş bir öğeyi odaklamaya çalışmak yok.
    if (el?.isConnected && !(el as HTMLElement & { disabled?: boolean }).disabled) el.focus();
  }, [busy]);

  return { ref, arm: () => (armed.current = true) };
}
