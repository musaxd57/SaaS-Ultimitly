"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// GEÇ DÖNEN OKUMA YARDIMCISI (F-2; kurucu 11-20 sabah: "F-2 mevcut iki ekranla sınırlı başlasın").
//
// Bir düğme ağdan okuma başlatır; okuma dönmeden kullanıcı başka bir şey açar / kapatır. Geç dönen yanıt artık ekranı DEĞİŞTİRMEMELİ (yazılan
// kaybolur, form sessizce başka kayda döner, kapanmış panel kutuya yazar). İki ekranda aynı kuşak sayacı elle yazılmıştı (şablon formunun
// açılışı — `components/templates/template-manager.tsx`; seçicide tam metin — `components/inbox/conversation-thread.tsx`); bu modül onun
// tek biçimidir. Yalnız o iki yerde kullanılır (kurucu kararı) — başka ekrana yaymadan önce sorulur.
//
//  · `begin()` yeni okumayı başlatır, bileti döner; önceki bütün biletler geçersizleşir.
//  · `isCurrent(bilet)` — okuma döndüğünde: arada yeni okuma başlamadıysa ve geçersiz kılınmadıysa doğru.
//  · `invalidate()` — süren okumayı boşa düşürür (form başka kipte açıldı / kapandı, panel kapandı).
// İstek İPTAL EDİLMEZ (ağ okuması tamamlanır, yalnız sonucu yok sayılır); bilet bellekte, bileşen ömrü boyunca.
// ---------------------------------------------------------------------------

export interface LatestRequest {
  begin(): number;
  isCurrent(ticket: number): boolean;
  invalidate(): void;
}

/** Saf sayaç (bileşen dışı ve sınama için). */
export function createLatestRequest(): LatestRequest {
  let generation = 0;
  return {
    begin: () => ++generation,
    isCurrent: (ticket) => ticket === generation,
    invalidate: () => {
      generation++;
    },
  };
}

/** Bileşen ömrü boyunca AYNI sayaç (yeniden çizimde sıfırlanmaz; `useRef` gibi kararlı nesne). */
export function useLatestRequest(): LatestRequest {
  const [latest] = useState(createLatestRequest);
  return latest;
}
