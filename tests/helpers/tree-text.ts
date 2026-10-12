import React from "react";

/**
 * Sunucu bileşeninin DÖNDÜRDÜĞÜ React ağacından görünen metni toplar.
 *
 * Bu yardımcı DÖRT test dosyasında birebir kopyalanmıştı ve kopyalardan yalnız
 * biri düzeltilince diğer üçü sessizce eski davranışta kaldı — tek kaynağa
 * çıkarılmasının sebebi bu.
 *
 * 🚨 METİN TAŞIYAN PROP'LAR DA TOPLANIR, yalnız `children` DEĞİL.
 * Ortak bileşenler (`EmptyState`, `Pager`, `PageHeader`) metni `children`
 * olarak değil `title`/`description`/`summary` PROP'u olarak alıyor. Yalnız
 * `children` gezilirse, bir metin bir bileşene taşındığı anda testler onu
 * SESSİZCE bulamaz hale gelir ve "metin ekranda yok" diye yorumlanır — tam
 * olarak bu oldu (takvim boş durumu `EmptyState`'e, sayfalama özeti `Pager`'a
 * taşındığında altı test birden kırmızıya döndü).
 *
 * ⚠️ Bitişik metin düğümleri ARADA BOŞLUK OLMADAN birleşir: JSX'te parçalı
 * yazılan metinler ("+", 7, " diğer") aksi hâlde aranamaz hale gelirdi.
 */
export function treeText(root: unknown): string {
  const parts: string[] = [];
  // 🚨 BÜTÜN METİN PROP'LARI (DENETIM 08-09 #36, 10-12 gece): eskiden yalnız altı ad (title/description/summary/label/value/placeholder)
  // toplanıyordu → başka bir prop'tan (`guestName`, `aria-label`, `subtitle`…) ekrana / istemciye giden kişisel veri `not.toContain`
  // iddialarına GÖRÜNMEZDİ. Artık her dize prop'u toplanır; yalnız metin taşımayan öznitelikler (sınıf, bağlantı, kimlik, tür…) dışarıda.
  // Açılamayan (hook'lu / istemci) bileşenin nesne prop'larındaki dizeler de toplanır: o veri istemciye serileştirilir.
  const NON_TEXT_PROPS = new Set([
    "children", "className", "href", "src", "id", "key", "type", "role", "rel", "target", "method", "action", "htmlFor", "name",
    "autoComplete", "inputMode", "pattern", "d", "viewBox", "fill", "stroke", "xmlns", "strokeWidth", "strokeLinecap",
    "strokeLinejoin", "encType", "dir", "lang", "form", "as", "prefetch", "scroll", "replace", "loading", "decoding",
  ]);
  const deepStrings = (v: unknown, depth: number): void => {
    if (depth > 6 || v == null) return;
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) for (const x of v) deepStrings(x, depth + 1);
    else if (typeof v === "object" && !React.isValidElement(v) && Object.getPrototypeOf(v) === Object.prototype) {
      for (const x of Object.values(v as Record<string, unknown>)) deepStrings(x, depth + 1);
    }
  };
  const collect = (node: unknown): void => {
    if (node == null || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") {
      parts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) collect(n);
      return;
    }
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      // 🚨 SAF FONKSİYON BİLEŞENLERİ AÇILIR. Bir metin ortak bir bileşene
      // taşındığı anda (`Pager`, `EmptyState`) ağaç gezicisi için OPAK hale
      // geliyor ve içindeki bağlantılar/metinler kaybolmuş görünüyordu — yani
      // testler "ekranda yok" diye rapor ediyordu, oysa vardı.
      // ⚠️ `try/catch` ŞART: hook kullanan ya da async olan bir bileşen burada
      // patlar; o durumda AÇMADAN devam ediyoruz (eski davranış), yani bu
      // ekleme hiçbir testi bozamaz — yalnız görebildiğini genişletir.
      let expanded = false;
      if (typeof node.type === "function") {
        try {
          const out = (node.type as (p: unknown) => unknown)(props);
          // Async sunucu bileşeni bir Promise döner — açılamaz, atla.
          if (out && typeof (out as { then?: unknown }).then !== "function") {
            collect(out);
            expanded = true;
          }
        } catch {
          /* hook'lu/renderer gerektiren bileşen — prop'larla yetin */
        }
      }
      collect(props.children);
      for (const [key, v] of Object.entries(props)) {
        if (NON_TEXT_PROPS.has(key)) continue;
        if (typeof v === "string") parts.push(v);
        // Açılamayan bileşenin veri prop'ları (nesne / dizi) istemciye gider → içindeki dizeler de sayfadadır.
        else if (!expanded && typeof node.type === "function" && v && typeof v === "object") deepStrings(v, 0);
      }
    }
  };
  collect(root);
  return parts.join("");
}
