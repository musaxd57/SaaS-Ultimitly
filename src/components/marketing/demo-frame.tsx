"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Embeds the static animated setup walkthrough (public/kurulum.html) in an
 * isolated iframe. The HTML posts its real content height to us so the iframe
 * has no empty gap / scrollbar at any width.
 */
export function DemoFrame({
  src = "/kurulum.html",
  title = "Lixus AI demo",
}: {
  src?: string;
  title?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(680);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      // Only trust height messages from our own demo iframe.
      if (e.source !== ref.current?.contentWindow) return;
      const h = (e.data as { lixusDemo?: number } | null)?.lixusDemo;
      if (typeof h === "number" && h > 200 && h < 2000) setHeight(Math.ceil(h));
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  /**
   * Yükleme BAŞARISIZ mı? (denetim 08-07)
   *
   * Yedek yokken dosya herhangi bir sebeple gelmezse ziyaretçi 680px'lik BOŞ
   * bir çerçeve görüyordu — ürün turu bölümü sessizce kayboluyor, geriye
   * açıklamasız bir kutu kalıyordu.
   *
   * ⚠️ Sinyal olarak ZAMAN AŞIMI KULLANILMIYOR — bilinçli. `loading="lazy"`
   * yüzünden iframe görünür olana kadar yüklenmez, mount'ta başlayan bir sayaç
   * ÇALIŞAN içeriği yanlışlıkla eler; landing en önemli sayfa, yanlış-pozitif
   * bir yedek gerçek bir gerileme olurdu. `onError` de yetmez: 404 bile
   * "yüklendi" sayılır ve olay hiç ateşlenmez.
   * Doğru sinyal: dosya AYNI ORIGIN'de olduğu için yüklenince belgesini
   * doğrudan okuyabiliyoruz. Gövde boşsa (veya erişim atarsa) yükleme
   * gerçekten başarısızdır — tahmin değil, ölçüm.
   */
  function checkLoaded() {
    try {
      const doc = ref.current?.contentDocument;
      // `!doc` = aynı-origin okuması engellendi; içeriği doğrulayamıyorsak
      // ELEMİYORUZ (varsayılan: çalışıyor kabul et, yanlış-pozitif üretme).
      if (doc && doc.body && doc.body.childElementCount === 0) setFailed(true);
    } catch {
      /* okunamadı → dokunma; boş yedek göstermektense iframe'i bırak */
    }
  }

  if (failed) {
    return (
      <div className="w-full rounded-2xl border border-border bg-card p-8 text-center">
        <p className="text-sm font-medium">Ürün turu şu anda yüklenemedi.</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Bağlantınızı kontrol edip sayfayı yenileyebilir ya da doğrudan{" "}
          <a href={src} className="font-medium text-primary underline underline-offset-2">
            bu bağlantıdan
          </a>{" "}
          açabilirsiniz.
        </p>
      </div>
    );
  }

  return (
    <iframe
      ref={ref}
      src={src}
      title={title}
      loading="lazy"
      onLoad={checkLoaded}
      className="w-full rounded-2xl border border-border bg-card"
      style={{ height }}
    />
  );
}
