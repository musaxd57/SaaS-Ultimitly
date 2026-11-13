// ---------------------------------------------------------------------------
// KESİK MODEL ÇIKTISINDAN KURTARMA (11-13; saf — dosya / ağ okumaz). Pin: `tests/unit/claude-work-salvage.test.ts`.
//
// Olay (istek 4, istem denetimi): dört mercek çıktı sınırına (`max_tokens`) çarptı; JSON yarıda kesildiği için `JSON.parse` düştü ve o
// merceklerin BÜTÜN bulguları (çağrı başına 48.000 çıktı belirteci, toplam ≈ 7,7 dolar) atıldı — oysa kesilen yalnız SON bulguydu.
// Şemalı çıktıda model öğeleri sırayla yazar: kesilme noktasından önceki her öğe tamdır ve şemaya uygundur.
//
// Bu dosya üst düzey nesnedeki bir dizinin TAMAMLANMIŞ nesne öğelerini ve tamamlanmış metin alanlarını geri verir. Tahmin YOK: yarım kalan
// öğe / metin atılır; onarılmaya çalışılmaz. Tarama doğrusaldır (tek geçiş, geri dönüş yok).
// ---------------------------------------------------------------------------

/** `start` konumundaki `"` ile açılan JSON metninin kapanış tırnağının konumu; kapanmadıysa -1. */
function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i += 1;
    else if (c === '"') return i;
  }
  return -1;
}

/** `start` konumundaki `{` ya da `[` ile açılan değerin kapanış konumu (metinlerin içi sayılmaz); kapanmadıysa -1. */
function valueEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const e = stringEnd(text, i);
      if (e < 0) return -1;
      i = e;
    } else if (c === "{" || c === "[") depth += 1;
    else if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const skipSpace = (text: string, i: number): number => {
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
};

/** Üst düzey nesnenin anahtarlarını sırayla gezer; `visit` değerin başladığı konumu alır, `false` dönerse gezme biter. */
function walkTopLevel(text: string, visit: (key: string, valueStart: number) => boolean): void {
  let i = text.indexOf("{");
  if (i < 0) return;
  i += 1;
  while (i < text.length) {
    i = skipSpace(text, i);
    if (text[i] === ",") {
      i += 1;
      continue;
    }
    if (text[i] !== '"') return;
    const keyEnd = stringEnd(text, i);
    if (keyEnd < 0) return;
    let key: string;
    try {
      key = JSON.parse(text.slice(i, keyEnd + 1)) as string;
    } catch {
      return;
    }
    i = skipSpace(text, keyEnd + 1);
    if (text[i] !== ":") return;
    const valueStart = skipSpace(text, i + 1);
    if (valueStart >= text.length) return;
    if (!visit(key, valueStart)) return;
    // Değeri atla (bir sonraki anahtara geç); değer yarımsa gezme biter.
    const c = text[valueStart];
    if (c === '"') {
      const e = stringEnd(text, valueStart);
      if (e < 0) return;
      i = e + 1;
    } else if (c === "{" || c === "[") {
      const e = valueEnd(text, valueStart);
      if (e < 0) return;
      i = e + 1;
    } else {
      // Sayı / true / false / null: bir sonraki virgüle ya da kapanışa kadar.
      let j = valueStart;
      while (j < text.length && text[j] !== "," && text[j] !== "}") j += 1;
      if (j >= text.length) return;
      i = j;
      if (text[i] === "}") return;
    }
  }
}

/**
 * Üst düzey `key` dizisinin tamamlanmış NESNE öğeleri (sırayla). Dizi yoksa, hiç öğe tamamlanmadıysa ya da öğe nesne değilse boş liste.
 * Yarım kalan son öğe atılır.
 */
export function salvageArrayItems(text: string, key: string): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  walkTopLevel(text, (k, valueStart) => {
    if (k !== key) return true;
    if (text[valueStart] !== "[") return false;
    let i = valueStart + 1;
    while (i < text.length) {
      i = skipSpace(text, i);
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      if (text[i] !== "{") break;
      const end = valueEnd(text, i);
      if (end < 0) break;
      try {
        items.push(JSON.parse(text.slice(i, end + 1)) as Record<string, unknown>);
      } catch {
        break;
      }
      i = end + 1;
    }
    return false;
  });
  return items;
}

/** Üst düzey `key` metin alanı TAMAMLANMIŞSA değeri; yoksa / yarımsa / metin değilse null. */
export function salvageStringField(text: string, key: string): string | null {
  let out: string | null = null;
  walkTopLevel(text, (k, valueStart) => {
    if (k !== key) return true;
    if (text[valueStart] !== '"') return false;
    const end = stringEnd(text, valueStart);
    if (end < 0) return false;
    try {
      out = JSON.parse(text.slice(valueStart, end + 1)) as string;
    } catch {
      out = null;
    }
    return false;
  });
  return out;
}

export interface Salvaged {
  /** Çıktı eksiksiz okunabildi mi (false → kesikti; `items` kurtarılanlardır). */
  complete: boolean;
  items: Record<string, unknown>[];
  /** İstenen metin alanları (tamamlanmamışsa null). */
  strings: Record<string, string | null>;
}

/**
 * Önce bütün JSON'u okur; okunamazsa (kesik çıktı) `arrayKey` dizisinin tamamlanmış öğelerini ve `stringKeys` alanlarını kurtarır.
 * Eksiksiz JSON'da sonuç `JSON.parse` ile birebir aynıdır.
 */
export function parseOrSalvage(text: string, arrayKey: string, stringKeys: readonly string[] = []): Salvaged {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const arr = v[arrayKey];
      return {
        complete: true,
        items: Array.isArray(arr) ? (arr.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[]) : [],
        strings: Object.fromEntries(stringKeys.map((k) => [k, typeof v[k] === "string" ? (v[k] as string) : null])),
      };
    }
  } catch {
    // kesik / bozuk → kurtarma
  }
  return {
    complete: false,
    items: salvageArrayItems(text, arrayKey),
    strings: Object.fromEntries(stringKeys.map((k) => [k, salvageStringField(text, k)])),
  };
}
