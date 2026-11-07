#!/usr/bin/env node
/**
 * ESKI YEREL YUKLEME ENVANTERI — SALT OKUMA (P1 #5, 08-09 (2)).
 *
 * 🚨 BU SCRIPT HICBIR SEY SILMEZ, TASIMAZ, DEGISTIRMEZ. Kullanici direktifi:
 * "Legacy dosyalari silme veya tasima." Yalnizca SAYAR ve ozetler.
 *
 * NEDEN VAR: `STORAGE_ENABLED` acilmadan once yuklenen fotograflar
 * `public/uploads/{orgId}/` altinda duruyor ve o dizin STATIK servis edilir.
 * URL bir CAPABILITY'dir (48 bit rastgelelik, tahmin edilemez) ama SURESIZDIR,
 * oturum ISTEMEZ ve kiraci kontrolu YOKTUR. Bir gecis karari vermeden once
 * "kac dosya, hangi org, ne kadar yer" sorusunun cevabi lazim.
 *
 * ⚠️ URETIM KONTEYNERINDE KOSMASI ANLAMLI OLABILIR AMA DIKKAT: Railway diski
 * EFEMERDIR; bir redeploy'dan sonra sayilar SIFIR gorunebilir ve bu "dosya
 * yoktu" DEGIL "disk yenilendi" demektir. Sonucu o baglamda oku.
 *
 * Kosum: node scripts/inventory-legacy-uploads.mjs [--json]
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPLOADS = path.join(ROOT, "public", "uploads");
const asJson = process.argv.includes("--json");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push({ full, size: st.size, mtime: st.mtime });
  }
  return out;
}

function main() {
  if (!existsSync(UPLOADS)) {
    const empty = { exists: false, orgs: 0, files: 0, bytes: 0, byOrg: [] };
    console.log(asJson ? JSON.stringify(empty, null, 2) : "public/uploads dizini YOK — eski yerel dosya bulunmuyor.");
    return 0;
  }

  const byOrg = new Map();
  let files = 0;
  let bytes = 0;
  let oldest = null;
  let newest = null;

  for (const orgDir of readdirSync(UPLOADS)) {
    const full = path.join(UPLOADS, orgDir);
    if (!statSync(full).isDirectory()) continue;
    const entries = walk(full);
    const size = entries.reduce((a, e) => a + e.size, 0);
    byOrg.set(orgDir, { files: entries.length, bytes: size });
    files += entries.length;
    bytes += size;
    for (const e of entries) {
      if (!oldest || e.mtime < oldest) oldest = e.mtime;
      if (!newest || e.mtime > newest) newest = e.mtime;
    }
  }

  const report = {
    exists: true,
    orgs: byOrg.size,
    files,
    bytes,
    megabytes: Number((bytes / 1024 / 1024).toFixed(2)),
    oldest: oldest ? oldest.toISOString() : null,
    newest: newest ? newest.toISOString() : null,
    // ⚠️ ORG ID'LERI KISALTILIR: bu ciktinin bir bilet/log'a yapistirilmasi
    // muhtemel ve tam kiraci kimlikleri oraya gereksiz yere gitmemeli.
    byOrg: [...byOrg.entries()].map(([org, v]) => ({ org: org.slice(0, 8) + "…", ...v })),
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log("ESKI YEREL YUKLEME ENVANTERI (salt okuma — hicbir sey silinmedi)");
  console.log(`  org sayisi : ${report.orgs}`);
  console.log(`  dosya      : ${report.files}`);
  console.log(`  boyut      : ${report.megabytes} MB`);
  console.log(`  en eski    : ${report.oldest ?? "—"}`);
  console.log(`  en yeni    : ${report.newest ?? "—"}`);
  for (const o of report.byOrg) console.log(`    ${o.org.padEnd(10)} ${String(o.files).padStart(5)} dosya  ${(o.bytes / 1024).toFixed(0)} KB`);
  if (report.files === 0) {
    console.log("\n  Dosya YOK. ⚠️ Railway diski EFEMERDIR — bu 'hic olmadi' degil,");
    console.log("  'bu konteynerde yok' demektir. Redeploy sonrasi beklenen sonuctur.");
  }
  return 0;
}

process.exit(main());
