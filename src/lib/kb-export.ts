// ---------------------------------------------------------------------------
// BİLGİ TABANINI DOSYA OLARAK DIŞA AKTARMA (kurucu 10-28, §7-A (3): "dışarı aktarım … özellik olarak olsun, deneme sürümünde olmasın"; uç
// `api/kb/export`). Biçim içe aktarıcının okuduğu biçimdir → dışa aktarılan dosya yeniden yüklenebilir (yedek / düzenleme / taşıma):
//   # Daire adı          (daire ayracı — başlık olarak okunur, taslak olmaz)
//   ## Kalem başlığı     (başlık sayılabiliyorsa başlık; değilse kategori adı)
//   içerik (AYNEN, paragrafları korunur)
// Yalnız ETKİN kalemler (pasif kalem dosyaya girmez — yeniden yüklenince etkin olurdu). Metin değişmez; hiçbir sır süzülmez — ev sahibinin
// kendi verisidir, uç yalnız yönetici / sahip ve destek görünümü dışında açılır. Saf.
// ---------------------------------------------------------------------------
import { KB_CATEGORY } from "@/lib/constants";

export interface KbExportItem {
  category: string;
  title: string;
  content: string;
}
export interface KbExportProperty {
  name: string;
  items: readonly KbExportItem[];
}

const LABELS: Readonly<Record<string, string>> = Object.fromEntries(KB_CATEGORY.options.map((o) => [o.value, o.label]));
const TERMINAL_PUNCT = /[.!?…;]$/u;

/** Başlık satırı: içe aktarıcının başlık sayacağı biçimde (≤ 5 sözcük, ≤ 60 karakter, cümle sonu işareti yok); değilse kategori adı. */
function headingFor(item: KbExportItem): string {
  const title = item.title.replace(/\s+/g, " ").trim();
  const ok = title.length > 0 && title.length <= 60 && title.split(" ").length <= 5 && !TERMINAL_PUNCT.test(title) && !title.includes(":");
  return ok ? title : (LABELS[item.category] ?? "Genel");
}

/** Dosya metni. Daire ve kalem sırası çağıranın verdiği sıradır (uç: daire adı, kategori, başlık). */
export function renderKbExport(properties: readonly KbExportProperty[]): string {
  const blocks: string[] = [];
  for (const p of properties) {
    if (p.items.length === 0) continue;
    blocks.push(`# ${p.name.replace(/\s+/g, " ").trim() || "Daire"}`);
    for (const it of p.items) {
      const content = it.content.replace(/\r\n?/g, "\n").trim();
      if (!content) continue;
      blocks.push(`## ${headingFor(it)}`, content);
    }
  }
  return blocks.length > 0 ? `${blocks.join("\n\n")}\n` : "";
}

/** İndirilen dosyanın adı (ASCII, tarihli). */
export function kbExportFilename(at: Date): string {
  return `bilgi-tabani-${at.toISOString().slice(0, 10)}.txt`;
}
