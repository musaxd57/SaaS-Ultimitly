// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// FORM HATA BANDI KAPSAMI — yapısal pin.
//
// Tur-6'da alan-bazlı hata çözüldü ama FORM-bazlı hata (gönderim başarısız)
// her ekranda elle basılıyordu ve hiçbirinde canlı bölge yoktu: hata sunucudan
// döndüğünde ekran okuyucu kullanıcısı HİÇBİR ŞEY duymuyor, form gönderilmiş
// gibi görünüyordu.
//
// Bu test tek bir şeyi pinler: o ÇIPLAK desen geri gelmesin. Yeni bir ekran
// aynı <p className="rounded-md bg-destructive/10 …">{error}</p> kalıbını
// kopyalarsa test kırmızıya döner ve yazan kişi FormError'a yönlendirilir.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(full));
    else if (e.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const BARE_BANNER =
  /<p className="(?:[\w-]+ )*rounded-md bg-destructive\/10 px-3 py-2 text-sm text-destructive"/;

describe("form hata bandı — çıplak desen geri gelmesin", () => {
  it("hiçbir ekran kendi hata bandını elle basmaz (FormError kullanılır)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
      if (file.endsWith(path.join("components", "form-error.tsx"))) continue;
      const src = fs.readFileSync(file, "utf-8");
      if (BARE_BANNER.test(src)) offenders.push(path.relative(process.cwd(), file));
    }
    expect(offenders).toEqual([]);
  });

  it("FormError gerçekten DUYURUR ve boş içerikte hiç render etmez", async () => {
    const { render, screen, cleanup } = await import("@testing-library/react");
    const { FormError } = await import("@/components/form-error");

    cleanup();
    const { container } = render(<FormError>{null}</FormError>);
    expect(container.innerHTML).toBe(""); // boş hata için gürültü yok

    cleanup();
    render(<FormError>Kaydedilemedi.</FormError>);
    expect(screen.getByRole("alert").textContent).toContain("Kaydedilemedi.");
  });
});
