"use client";

import { useEffect, useRef } from "react";

/**
 * QR sohbet detayında mesaj kutusunu EN SON mesaja konumlandırır.
 *
 * 🚨 NEDEN GEREKLİ (ölçüldü, 09-11): detay sayfası varsayılan olarak EN YENİ
 * 200 mesajı basıyor ve hiçbir kaydırma kabı yoktu — host sayfayı açtığında
 * penceredeki EN ESKİ mesajın başında duruyor, son mesajı ve yazma kutusunu
 * görmek için 200 balon aşağı kaydırmak zorunda kalıyordu. Kıyas: gelen kutusu
 * mesaj listesi kendi kabında ve composer daima görünür.
 *
 * 🚨 YENİ MESAJ GELİNCE YALNIZ ZATEN DİPTEYKEN kaydırır. Sayfa 30 sn'de bir
 * `router.refresh()` ile tazeleniyor (`AutoRefresh`); host eski mesajları
 * okurken her tazelemede zorla dibe atmak, okuduğu yeri KAYBETTİRİR. Eşik
 * kabın kendi yüksekliğinin yarısı — mutlak piksel değil, çünkü kutu yüksekliği
 * `52vh`/`flex-1` ile ekrana göre değişiyor.
 *
 * Hiçbir şey çizmez.
 */
export function ScrollToLatest({
  /** Kaptan sorumlu id — `document.getElementById` ile bulunur (server component'ten ref geçirilemez). */
  targetId,
  /** Değişince "yeni mesaj geldi" sayılır (mesaj sayısı + son mesaj id'si gibi). */
  signature,
}: {
  targetId: string;
  signature: string;
}) {
  const mounted = useRef(false);

  useEffect(() => {
    const box = document.getElementById(targetId);
    if (!box) return;
    const distanceFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    // İlk çizimde KOŞULSUZ dibe; sonraki tazelemelerde yalnız host zaten dipteyse.
    const stick = !mounted.current || distanceFromBottom <= box.clientHeight / 2;
    mounted.current = true;
    if (!stick) return;
    box.scrollTop = box.scrollHeight;
  }, [targetId, signature]);

  return null;
}
