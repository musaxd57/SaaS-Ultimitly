import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { GUEST_NAME_SOURCES } from "@/lib/guest-name-source";

// ---------------------------------------------------------------------------
// MİSAFİR ADININ KÖKENİ — YAZMA YERLERİ TİPLİ (migration 57; 09-28 inceleme ajanı notu). Veritabanı sütunu serbest metin: "chanel"
// gibi bir yazım hatası derlenip kapalı kümenin dışında bir köken yazardı. Her yazma `satisfies GuestNameSource` taşır → yanlış değer
// DERLENMEZ. Bu pin, `satisfies` taşımayan YENİ bir yazma yerini yakalar (seçim `guestNameSource: true` ve alan adı karşılaştırması hariç).
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, "../../src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = path.join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(e) ? [full] : [];
  });
}

/** `guestNameSource: <değer>` / `guestNameSource = <değer>` — sütuna değer yazan ifadeler. */
const WRITE = /guestNameSource\s*(?::|=(?!=))\s*([^,\n}]+)/g;

describe("misafir adı kökeni yazmaları", () => {
  it("🚨 her yazma kapalı kümeye tip denetimiyle bağlı (`satisfies GuestNameSource`)", () => {
    const offenders: string[] = [];
    let writes = 0;
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (rel === "lib/guest-name-source.ts") continue;
      for (const m of readFileSync(file, "utf8").matchAll(WRITE)) {
        const value = m[1].trim();
        if (value === "true") continue; // Prisma seçimi
        writes += 1;
        if (!/satisfies GuestNameSource\b/.test(value)) offenders.push(`${rel}: ${m[0].trim()}`);
      }
    }
    expect(writes).toBeGreaterThanOrEqual(7); // anti-vakum: tarama gerçek yazmaları buluyor
    expect(offenders).toEqual([]);
  });

  it("kapalı küme değişmedi", () => {
    expect([...GUEST_NAME_SOURCES]).toEqual(["channel", "calendar", "file", "host", "placeholder"]);
  });
});
