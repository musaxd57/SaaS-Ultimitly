import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// TELEFONDA DOKUNMA HEDEFİ — YEREL EZMELERİN PİNİ (UX denetimi 11-13).
//
// Ürünün kendi ölçüsü (10-21, `src/components/ui/button.tsx`): telefonda düğme / giriş kutusu / seçici 40 px, sm ve üstünde sıkı ölçü
// (`h-10 sm:h-8`). Denetim, ortak bileşenlerin bu ölçüye uyduğunu ama bazı ekranların onu YEREL sınıfla ezdiğini gösterdi (kodda doğrulandı):
// üst çubuktaki tema düğmesi 32 px, menü düğmesi 36 px, gelen kutusu süzgeçleri ve arama 32 px, konuşmadaki Durum / Öncelik / Ton seçicileri
// 32 px, abonelik plan düğmeleri 32 px, görev seçicileri 36 px, takvim ay okları 32 px…
//
// Düzeltme yalnız telefon genişliğini (sm altı) büyütür; masaüstü görünümü ve hiçbir yazı değişmedi.
//
// ⚠️ BU DOSYA BİR KAYNAK TARAMASIDIR — ölçü ölçmez (jsdom düzen hesaplamaz). Gerçek kanıt tarayıcı ölçümüdür
// (`scripts/claude-work/screenshots.ts` her sayfada 40 px'ten küçük etkileşimli öğeleri sayar; önce / sonra tablosu
// `docs/INCELEME-2026-11-13-ux-denetimi.md`). Burada yapılan iş, o ölçümü üreten sınıfların sessizce geri alınmasını engellemektir.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** [dosya, o denetimin sınıf dizesinde BİRLİKTE bulunması gereken parçalar (dize iki yanından boşlukla sarılıp aranır), kaç denetim]. */
const PINS: [file: string, tokens: string[], count: number, what: string][] = [
  ["src/components/shell/panel-theme.tsx", ["inline-flex size-10 ", " sm:size-8"], 1, "tema düğmesi"],
  // Menüyü aç + menüyü kapat (ikisi de yalnız lg altında); kapat düğmesi `-my-1` ile logo satırının 32 px yüksekliğini korur.
  ["src/components/shell/app-shell.tsx", ["inline-flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent lg:hidden"], 2, "menü aç / kapat düğmeleri"],
  ["src/components/shell/app-shell.tsx", [" -my-1 inline-flex size-10 "], 1, "menü kapat düğmesi (satır yüksekliği korunur)"],
  ["src/app/(app)/inbox/page.tsx", ["inline-flex h-10 items-center rounded-md border px-3 text-xs font-medium transition-colors sm:h-8"], 1, "gelen kutusu süzgeçleri"],
  ["src/app/(app)/inbox/page.tsx", [" h-10 w-40 rounded-md border border-border bg-card pl-8 pr-2 text-xs", " sm:h-8 "], 1, "gelen kutusu araması"],
  ["src/components/inbox/conversation-thread.tsx", ["h-10 w-36 py-0 text-xs sm:h-8"], 1, "konuşma: Durum"],
  ["src/components/inbox/conversation-thread.tsx", ["h-10 w-28 py-0 text-xs sm:h-8"], 1, "konuşma: Öncelik"],
  ["src/components/inbox/conversation-thread.tsx", ["h-10 w-full py-0 text-xs sm:h-8"], 1, "konuşma: Ton"],
  ["src/components/templates/template-manager.tsx", ["inline-flex min-h-10 shrink-0 items-center", " sm:min-h-0"], 1, "şablon: Kendime uyarla"],
  ["src/app/(app)/calendar/page.tsx", ["inline-flex size-10 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent sm:size-8"], 2, "takvim: ay okları"],
  ["src/app/(app)/calendar/page.tsx", ["rounded-full border px-3 py-3 text-xs font-medium transition-colors sm:py-1"], 1, "takvim: daire süzgeçleri"],
  ["src/components/settings/paddle-plans.tsx", ["inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground", " sm:h-8"], 3, "abonelik: plan düğmeleri"],
  ["src/components/tasks/task-board.tsx", [" mt-2 h-10 text-xs sm:h-9 "], 2, "görev: durum + atanan seçicisi"],
  ["src/components/guest-chats/reply-box.tsx", ["inline-flex h-10 shrink-0 items-center rounded-md bg-primary", " sm:h-9"], 1, "QR sohbeti: Yanıtla"],
  ["src/components/guest-chats/reply-box.tsx", ["max-h-28 min-h-10 flex-1 resize-none", " sm:min-h-[38px]"], 1, "QR sohbeti: yanıt kutusu"],
  ["src/components/onboarding-guide.tsx", ["inline-flex size-10 items-center justify-center rounded-md", " sm:size-8"], 1, "kurulum kartı: daralt"],
];

/** Dosyadaki `className="…"` / sınıf dizelerini (tek satırlık tırnak içi parçalar) verir. */
function classStrings(src: string): string[] {
  return [...src.matchAll(/"([^"\n]{12,})"/g)].map((m) => m[1]!);
}

describe("telefonda dokunma hedefi — yerel ezmeler 40 px'e çekildi", () => {
  for (const [file, tokens, count, what] of PINS) {
    it(`${what} (${file})`, () => {
      const hits = classStrings(read(file)).filter((cls) => tokens.every((t) => ` ${cls} `.includes(t)));
      expect(hits.length, `beklenen ${count} denetim; bulunan sınıflar: ${JSON.stringify(hits)}`).toBe(count);
    });
  }

  it("ortak bileşenlerin ölçüsü yerinde: düğme / giriş / seçici telefonda 40 px", () => {
    const button = read("src/components/ui/button.tsx");
    expect(button).toContain('sm: "h-10');
    expect(button).toContain("sm:h-8");
    expect(button).toContain('icon: "size-10 sm:size-9"');
    expect(read("src/components/ui/input.tsx")).toMatch(/\bh-10\b/);
    expect(read("src/components/ui/select.tsx")).toMatch(/\bh-10\b/);
  });

  it("bu dosyalarda telefonda 40 px'in altına düşüren eski sınıflar geri gelmedi", () => {
    // Aynı denetimlerin eski hâlleri (sm öneki olmadan sabit küçük ölçü).
    expect(read("src/components/shell/panel-theme.tsx")).not.toContain('"inline-flex size-8 ');
    expect(read("src/components/shell/app-shell.tsx")).not.toContain('"rounded-md p-2 text-muted-foreground hover:bg-accent lg:hidden"');
    expect(read("src/components/shell/app-shell.tsx")).not.toContain('"rounded-md p-1 text-muted-foreground hover:bg-accent lg:hidden"');
    expect(read("src/app/(app)/inbox/page.tsx")).not.toMatch(/"(?:inline-flex )?h-8 /);
    expect(read("src/components/inbox/conversation-thread.tsx")).not.toMatch(/className="h-8 w-/);
    expect(read("src/components/settings/paddle-plans.tsx")).not.toContain("inline-flex h-8 w-full");
    expect(read("src/components/tasks/task-board.tsx")).not.toContain('className="mt-2 h-9 text-xs"');
    expect(read("src/app/(app)/calendar/page.tsx")).not.toContain('"inline-flex size-8 items-center justify-center rounded-md border');
  });

  it("misafir sohbetinde 12 px'in altında yazı yok (saat, kapı kodu notu, alt bilgi)", () => {
    for (const f of ["src/components/guest-chat/guest-chat.tsx", "src/components/guest-chat/guest-chat-thread.tsx"]) {
      expect(read(f), f).not.toMatch(/text-\[(?:9|10|11)px\]/);
    }
  });
});
