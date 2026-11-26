// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderHook } from "@testing-library/react";
import { createLatestRequest, useLatestRequest } from "@/lib/use-latest-request";

// ---------------------------------------------------------------------------
// GEÇ DÖNEN OKUMA YARDIMCISI (F-2; kurucu 11-20 sabah: "F-2 mevcut iki ekranla sınırlı başlasın"). İki ekranda elle yazılmış kuşak sayacının
// (şablon formu açılışı, seçicide tam metin) ortak biçimi: başlat → bilet; bilet hâlâ geçerli mi; geçersiz kıl. Ekran davranışı kendi
// testlerinde (`template-manager-stale-edit`, `template-picker-paged`); burada yalnız sözleşme.
// ---------------------------------------------------------------------------

describe("createLatestRequest — sözleşme", () => {
  it("başlatılan bilet geçerlidir; yeni başlatma öncekini geçersiz kılar (yalnız son bilet geçerli)", () => {
    const r = createLatestRequest();
    const a = r.begin();
    expect(r.isCurrent(a)).toBe(true);
    const b = r.begin();
    expect(r.isCurrent(a)).toBe(false);
    expect(r.isCurrent(b)).toBe(true);
  });

  it("🚨 geçersiz kılma süren bileti boşa düşürür; sonra başlatılan yeni bilet geçerli", () => {
    const r = createLatestRequest();
    const a = r.begin();
    r.invalidate();
    expect(r.isCurrent(a)).toBe(false);
    const b = r.begin();
    expect(r.isCurrent(b)).toBe(true);
    expect(r.isCurrent(a)).toBe(false);
  });

  it("art arda geçersiz kılma ve hiç başlatılmamış bilet de güvenli (eski bilet bir daha geçerli olmaz)", () => {
    const r = createLatestRequest();
    const a = r.begin();
    r.invalidate();
    r.invalidate();
    expect(r.isCurrent(a)).toBe(false);
    const b = r.begin();
    expect(b).not.toBe(a);
    expect(r.isCurrent(b)).toBe(true);
  });

  it("iki ayrı yardımcı birbirini etkilemez", () => {
    const r1 = createLatestRequest();
    const r2 = createLatestRequest();
    const a = r1.begin();
    r2.invalidate();
    r2.begin();
    expect(r1.isCurrent(a)).toBe(true);
  });
});

describe("useLatestRequest — bileşen ömrü boyunca aynı sayaç", () => {
  it("yeniden çizimde aynı nesne döner; önceki çizimde alınan bilet sonraki çizimde de doğru okunur", () => {
    const { result, rerender } = renderHook(() => useLatestRequest());
    const first = result.current;
    const ticket = first.begin();
    rerender();
    expect(result.current).toBe(first);
    expect(result.current.isCurrent(ticket)).toBe(true);
    result.current.invalidate();
    rerender();
    expect(result.current.isCurrent(ticket)).toBe(false);
  });
});

// Kurucu 11-20 sabah: "F-2 mevcut iki ekranla sınırlı başlasın". Yardımcıyı kullanan dosyalar KAPALI listede (eşitlik): üçüncü bir ekran
// eklemek bilinçli karar ister — önce kurucuya sorulur, sonra bu liste güncellenir.
describe("useLatestRequest — yalnız iki ekranda", () => {
  const SRC = path.resolve(__dirname, "../../src");
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : [],
    );
  const users = files(SRC)
    .filter((f) => /from "@\/lib\/use-latest-request"/.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
    .sort();

  it("yardımcıyı yalnız şablon formu ve konuşma ekranındaki şablon seçici kullanır", () => {
    expect(users).toEqual(["components/inbox/conversation-thread.tsx", "components/templates/template-manager.tsx"]);
  });
});
