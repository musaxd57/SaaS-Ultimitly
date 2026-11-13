// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// UX-5 (kurucu 11-13: "dediklerin iyi tamamen dediğin gibi yap") — ana sayfadaki kurulum animasyonu (`public/kurulum.html`, iframe).
//  · Başlık / alt satır geliştirici dilindeydi ("API bağlama anlatımı", "token'ı yapıştır"); aynı sayfa "kod yok" diyor.
//  · Örnek cevap kendi içinde çelişiyordu ("müsait" + "ev sahibine soracağım") ve üçüncü şahıstı ("the host") — ürün erken girişe
//    doğrulamadan "evet" demez; örnek, ürünün bugün gerçekten verdiği türden tek anlamlı bir cevap oldu.
//  · İçindeki "14 gün ücretsiz dene" gerçek düğme gibi duruyor ama tıklanmıyordu → artık gerçekten kayıt sayfasına gider (üst pencerede).
//  · Animasyondaki anahtar adı ayarlar kartıyla aynı ("bağlantı anahtarı", UX-7); "biz bile göremeyiz" iddiası kalktı (sunucu anahtarı
//    kullanmak için çözer — doğru değildi).
// Statik dosya: tarayıcı altyapısı yok, DOMParser ile yapı okunur; betik içindeki metinler kaynaktan.
// ---------------------------------------------------------------------------

const html = readFileSync("public/kurulum.html", "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const text = (sel: string) => (doc.querySelector(sel)?.textContent ?? "").replace(/\s+/g, " ").trim();
const visibleMarkup = (doc.body.cloneNode(true) as HTMLElement);
visibleMarkup.querySelectorAll("script, style").forEach((n) => n.remove());
const shown = (visibleMarkup.textContent ?? "").replace(/\s+/g, " ");
const script = [...doc.querySelectorAll("script")].map((s) => s.textContent ?? "").join("\n");

describe("UX-5 — kurulum animasyonu sade dil", () => {
  it("başlık ve adımlar ev sahibinin anlayacağı dilde", () => {
    expect(doc.title).toBe("Lixus AI — Kurulum nasıl yapılır?");
    expect(text(".head h1")).toBe("Kurulum nasıl yapılır?");
    expect(text(".head p")).toBe("Ücretsiz deneyin → hesabınızı açın → e-postanızı onaylayın → Airbnb / Booking'i bağlayın");
  });

  it("örnek konuşma: tek anlamlı, üçüncü şahıs yok", () => {
    const bubbles = [...doc.querySelectorAll("#s1 .bubble")].map((b) => {
      const c = b.cloneNode(true) as HTMLElement;
      c.querySelector(".lang")?.remove();
      return (c.textContent ?? "").trim();
    });
    expect(bubbles).toEqual(["What time is check-out?", "Check-out is at 11:00."]);
    expect(html).not.toMatch(/the host/i);
  });

  it("🚨 görünen metinde ve animasyon yazılarında 'API' / 'token' / 'biz bile göremeyiz' yok", () => {
    for (const gone of [/\bAPI\b/, /token/i, /biz bile göremeyiz/i, /Personal Access/i]) expect(shown).not.toMatch(gone);
    // Betikteki ekrana yazılan metinler (adım çipi, ipucu balonu, kilit satırı, adım etiketi).
    for (const gone of ["API anahtarını", "API yapıştır", "Token'ı buraya", "Token şifreli", "biz bile göremeyiz", "hospitable_pat_…"]) {
      expect(script).not.toContain(gone);
    }
    expect(script).toContain("setChip(5,'Bağlantı anahtarını yapıştır')");
    expect(text(".tokenLabel")).toBe("Hospitable bağlantı anahtarı");
    expect(text("#tokenHint")).toBe("Bağlantı anahtarı şifreli saklanır ve bir daha görüntülenmez.");
  });

  it("animasyondaki 'ücretsiz dene' düğmeleri gerçek bağlantı: üst pencerede kayıt sayfası", () => {
    const free = doc.getElementById("freeBtn") as HTMLAnchorElement;
    expect(free.tagName).toBe("A");
    expect(free.getAttribute("href")).toBe("/register");
    expect(free.getAttribute("target")).toBe("_top");
    expect(free.textContent).toBe("14 gün ücretsiz dene");
    const nav = doc.querySelector("a.free")!;
    expect(nav.getAttribute("href")).toBe("/register");
    expect(nav.getAttribute("target")).toBe("_top");
    const how = doc.querySelector("a.btn-ghost")!;
    expect(how.getAttribute("href")).toBe("/#nasil");
    expect(how.getAttribute("target")).toBe("_top");
    // Ana sayfada çapa gerçekten var.
    expect(readFileSync("src/components/marketing/landing-page.tsx", "utf8")).toContain('id="nasil"');
    // Animasyon imleci aynı öğeyi hedeflemeye devam eder.
    expect(script).toContain("aim($('freeBtn'))");
  });
});

describe("UX-5 — oynatıcı düğmesi (iki animasyon)", () => {
  it.each(["public/kurulum.html", "public/urun.html"])("%s: etiketli, 40 px, etiketi duruma göre değişir", (file) => {
    const src = readFileSync(file, "utf8");
    const d = new DOMParser().parseFromString(src, "text/html");
    const btn = d.getElementById("playBtn")!;
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.getAttribute("aria-label")).toBe("Oynat");
    expect(src).toContain(".pbtn{width:40px;height:40px;");
    expect(src).toMatch(/playBtn\.setAttribute\('aria-label', ?paused\?'Oynat':'Duraklat'\)/);
  });
});
