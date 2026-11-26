#!/usr/bin/env node
// NEDEN DEFTERİ — komut satırı (saf parçalar `scripts/neden-defteri-core.mjs`; tasarım `docs/TASARIM-2026-11-26-neden-defteri.md`).
//
//   node scripts/neden-defteri.mjs ekle <ayrıntı.json> [<ayrıntı.json> …] [--etiket <koşu etiketi>] [--defter <yol>]
//       Canlı hat ölçerinin ayrıntı dosyasından ihtiyaç başına bir satır üretir, deftere EKLER. Aynı koşu + senaryo + ihtiyaç ikinci kez
//       eklenmez. `--etiket` yalnız TEK dosyayla (koşu etiketi dosya adından okunur; ad değiştiyse aynı koşu iki kez girmesin diye).
//   node scripts/neden-defteri.mjs ozet [--defter <yol>] [--cikti <yol>]
//       Defterin tamamından insan için özet üretir (her çalıştırmada yeniden yazılır).
//
// Ağ, model, veritabanı YOK. Defter yalnız eklenir; var olan satır değiştirilmez.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defteriAyristir, dosyadanSatirlar, ozetMetni, yeniSatirlar } from "./neden-defteri-core.mjs";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_DEFTER = path.join(REPO, "docs", "olcum", "neden-defteri.jsonl");
const DEFAULT_OZET = path.join(REPO, "docs", "olcum", "neden-defteri-ozet.md");

function arg(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) throw new Error(`${name} bir değer ister`);
  args.splice(i, 2);
  return v;
}

function readDefter(p) {
  return existsSync(p) ? defteriAyristir(readFileSync(p, "utf8")) : [];
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const args = [...rest];
  const defter = path.resolve(arg(args, "--defter") ?? DEFAULT_DEFTER);
  if (cmd === "ekle") {
    const etiket = arg(args, "--etiket");
    if (args.length === 0) throw new Error("en az bir ayrıntı dosyası verin");
    if (etiket && args.length !== 1) throw new Error("--etiket yalnız tek dosyayla kullanılır");
    const adaylar = args.flatMap((f) => dosyadanSatirlar(JSON.parse(readFileSync(f, "utf8")), path.basename(f), etiket));
    const { eklenecek, yutulan } = yeniSatirlar(readDefter(defter), adaylar);
    if (eklenecek.length > 0) appendFileSync(defter, eklenecek.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");
    console.log(`[neden-defteri] eklendi ${eklenecek.length} · zaten defterde ${yutulan} · defter ${path.relative(REPO, defter)}`);
    console.log("[neden-defteri] özeti yenilemek için: node scripts/neden-defteri.mjs ozet");
    return 0;
  }
  if (cmd === "ozet") {
    const cikti = path.resolve(arg(args, "--cikti") ?? DEFAULT_OZET);
    const satirlar = readDefter(defter);
    writeFileSync(cikti, ozetMetni(satirlar), "utf8");
    console.log(`[neden-defteri] özet yazıldı: ${path.relative(REPO, cikti)} (${satirlar.length} satır)`);
    return 0;
  }
  console.error("kullanım: node scripts/neden-defteri.mjs ekle <ayrıntı.json…> [--etiket X] [--defter yol] | ozet [--defter yol] [--cikti yol]");
  return 2;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`[neden-defteri] HATA: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
