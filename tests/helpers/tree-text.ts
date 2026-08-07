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
  const TEXT_PROPS = ["title", "description", "summary", "label", "value", "placeholder"];
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
      if (typeof node.type === "function") {
        try {
          const out = (node.type as (p: unknown) => unknown)(props);
          // Async sunucu bileşeni bir Promise döner — açılamaz, atla.
          if (out && typeof (out as { then?: unknown }).then !== "function") {
            collect(out);
          }
        } catch {
          /* hook'lu/renderer gerektiren bileşen — prop'larla yetin */
        }
      }
      collect(props.children);
      for (const key of TEXT_PROPS) {
        if (typeof props[key] === "string") parts.push(props[key] as string);
      }
    }
  };
  collect(root);
  return parts.join("");
}
