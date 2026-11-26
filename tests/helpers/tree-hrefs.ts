import React from "react";

/**
 * Sunucu bileşeninin DÖNDÜRDÜĞÜ React ağacındaki bağlantı adresleri (`href`). Saf (hook'suz, eşzamanlı) alt bileşenler açılır —
 * `LinkButton`, `EmptyState`, `ConnectChannelButton` gibi; açılamayan (hook'lu / istemci / async) bileşen olduğu gibi bırakılır.
 * Kaynak: `list-pagination-pages.test.ts` içindeki yerel kopya (aynı yürüyüş).
 */
export function treeHrefs(root: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (React.isValidElement(node)) {
      // Açılabilen saf bileşende YALNIZ çıktısı yürünür: kendi `href` / `children` prop'ları çıktıya zaten taşınır — ikisini de saymak aynı
      // bağlantıyı birden çok kez sayardı (LinkButton → Link → a). Açılamayan (hook'lu / istemci) bileşende prop'ları okunur.
      if (typeof node.type === "function") {
        try {
          const out = (node.type as (p: unknown) => unknown)(node.props);
          if (out && typeof (out as { then?: unknown }).then !== "function") {
            walk(out);
            return;
          }
        } catch {
          /* açılamadı → prop'lardan oku */
        }
      }
      const props = node.props as { href?: unknown; children?: unknown };
      if (typeof props.href === "string") found.push(props.href);
      walk(props.children);
    }
  };
  walk(root);
  return found;
}

/** Bir adresin ağaçta kaç kez geçtiği (aynı eylemin iki kez çizilmesini yakalamak için). */
export function countHref(root: unknown, href: string): number {
  return treeHrefs(root).filter((h) => h === href).length;
}
