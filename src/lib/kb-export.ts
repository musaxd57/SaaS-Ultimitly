// ---------------------------------------------------------------------------
// BİLGİ TABANINI DOSYA OLARAK DIŞA AKTARMA (kurucu 10-28, §7-A (3): "dışarı aktarım … özellik olarak olsun, deneme sürümünde olmasın"; uç
// `api/kb/export`). Biçim içe aktarıcının okuduğu biçimdir → dışa aktarılan dosya yeniden yüklenebilir (yedek / düzenleme / taşıma):
//   # Daire adı          (daire ayracı — başlık olarak okunur, taslak olmaz)
//   ## Kalem başlığı     (başlık sayılabiliyorsa başlık; değilse kategori adı)
//   içerik (AYNEN, paragrafları korunur)
// Yalnız ETKİN kalemler (pasif kalem dosyaya girmez — yeniden yüklenince etkin olurdu). Metin değişmez; hiçbir sır süzülmez — ev sahibinin
// kendi verisidir, uç yalnız yönetici / sahip ve destek görünümü dışında açılır. Saf.
// ---------------------------------------------------------------------------
import { headingText } from "@/lib/kb-import/document";
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
/**
 * Başlık satırı: kalem başlığı, ANCAK içe aktarıcı "## başlık" satırını aynen başlık sayıyorsa (tek kaynak `headingText`: ≤ 60 karakter "##"
 * dahil, ≤ 5 sözcük, saat yok, cümle sonu / virgül yok); değilse kategori adı. Haiku 10-28: ayrı bir kural kopyası 58–60 karakterlik, virgülle
 * biten ya da saat taşıyan başlıkta içe aktarıcıyla ayrışıyor, "## …" satırı içeriğe giriyordu.
 */
function headingFor(item: KbExportItem): string {
  const title = item.title.replace(/\s+/g, " ").trim();
  const ok = title.length > 0 && !title.includes(":") && headingText(`## ${title}`) === title;
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
