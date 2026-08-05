#!/usr/bin/env node
/**
 * BAGIMLILIK ZAFIYET KAPISI — `npm audit` sonucunu triaj kaydiyla karsilastirir.
 *
 * Kapi "sifir zafiyet" degil "sifir TRIAJ EDILMEMIS zafiyet" der. Gerekcesi
 * `security/audit-baseline.json` basinda yazili: bugun uretim bagimliliklarinda
 * duzeltmesi kirici major surum isteyen danismalar var, duz bir audit kapisi
 * CI'yi kalici kirmiziya cevirir ve kalici kirmizi bir kapi sinyal degerini
 * kaybeder.
 *
 * KIRMIZI YAPAN IKI DURUM (ikisi de gercek ve eyleme donuk):
 *   1. Baseline'da OLMAYAN yeni bir danisma  -> birinin bakmasi gerekiyor
 *   2. Baseline'da SURESI DOLMUS bir kabul   -> aylardir kimse bakmamis
 *
 * FAIL-OPEN YALNIZ ALTYAPI ICIN: `npm audit` hic kosamadi / ciktisi
 * ayristirilamadi ise cikis 0 + uyari. Kayit defteri hickirigi deploy'u
 * bloklamamali; bu, "sinyal bulundu" durumundan (fail-closed) bilincli olarak
 * ayrilmis bir daldir.
 *
 * KAPSAM: blokllayici tarama URETIM bagimliliklari (--omit=dev). Dev zinciri
 * (vitest/vite/eslint) yalnizca sayi olarak raporlanir — orada danismalar cok
 * sik ve musteri verisine ulasmiyorlar.
 *
 * Kosum: `node scripts/audit-check.mjs`  (CI'da ve elle ayni)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "security", "audit-baseline.json");

/** GitHub Actions anotasyonu (yerel kosumda da okunabilir duz metin). */
const annotate = (level, msg) => console.log(`::${level}::${msg}`);

/**
 * `npm audit --json` ciktisindan DISTINCT GHSA kimliklerini cikarir.
 *
 * ⚠️ Anahtar olarak PAKET ADI degil GHSA kimligi kullanilir: ayni paket birden
 * cok danisma tasiyabilir (postcss'te 4 tane var) ve paket bazli bir baseline
 * "postcss kabul edildi" deyip O PAKETE GELECEK YENI danismayi da sessizce
 * yutardi.
 */
function extractAdvisories(auditJson) {
  const found = new Map();
  for (const vuln of Object.values(auditJson.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      // string `via` = gecisli zincirin ust paketi, kendi danismasi yok.
      if (typeof via === "string") continue;
      const id = /GHSA-[0-9a-z-]+/.exec(via.url ?? "")?.[0];
      if (!id || found.has(id)) continue;
      found.set(id, { id, package: via.name, severity: via.severity, title: via.title ?? "" });
    }
  }
  return found;
}

/** `npm audit` calistirir. Bulgu varken sifir-disi cikar → ciktiyi HER halde al. */
function runAudit(omitDev) {
  const args = ["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])];
  try {
    return JSON.parse(execFileSync("npm", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  } catch (err) {
    // Bulgu varsa npm sifir-disi cikar ama stdout GECERLI JSON'dur.
    const out = err?.stdout;
    if (typeof out === "string" && out.trim().startsWith("{")) {
      try {
        return JSON.parse(out);
      } catch {
        /* asagidaki altyapi daline dus */
      }
    }
    return null;
  }
}

function main() {
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const accepted = new Map(baseline.accepted.map((a) => [a.id, a]));

  const audit = runAudit(true);
  if (!audit) {
    annotate("warning", "npm audit calistirilamadi veya ciktisi ayristirilamadi — kapi ATLANDI (altyapi dali, fail-open).");
    return 0;
  }

  const found = extractAdvisories(audit);
  const today = new Date().toISOString().slice(0, 10);
  let failed = false;

  // 1) Baseline'da olmayan YENI danisma → kirmizi.
  for (const [id, a] of found) {
    if (accepted.has(id)) continue;
    failed = true;
    annotate(
      "error",
      `YENI zafiyet (triaj edilmemis): ${id} [${a.severity}] ${a.package} — ${a.title}. ` +
        `Ya duzelt (npm audit fix / surum yukselt) ya da security/audit-baseline.json'a GEREKCE + EXPIRES ile ekle.`,
    );
  }

  // 2) Suresi dolmus kabul → kirmizi (bayat muafiyet = unutulmus acik).
  for (const a of accepted.values()) {
    if (!a.expires || a.expires >= today) continue;
    failed = true;
    annotate(
      "error",
      `Suresi DOLMUS zafiyet kabulu: ${a.id} (${a.package}) — expires ${a.expires}. ` +
        `Bulguya yeniden bak: hala ulasilamaz mi, duzeltme cikti mi? Sonra expires tarihini yenile.`,
    );
  }

  // 3) Artik gorunmeyen kabul → yalniz uyari (duzelmis olabilir; ama kayitta
  //    kalmasi, ayni danisma GERI GELIRSE sessizce kabul edilmesi demektir).
  for (const a of accepted.values()) {
    if (found.has(a.id)) continue;
    annotate("warning", `Baseline'daki ${a.id} (${a.package}) artik audit ciktisinda YOK — duzelmis olabilir, satiri kaldir.`);
  }

  // 4) Dev zinciri: yalniz gorunurluk, blokllamaz.
  const devAudit = runAudit(false);
  if (devAudit) {
    const m = devAudit.metadata?.vulnerabilities ?? {};
    const devOnly = extractAdvisories(devAudit).size - found.size;
    annotate(
      "notice",
      `Dev dahil toplam: critical=${m.critical ?? 0} high=${m.high ?? 0} moderate=${m.moderate ?? 0} ` +
        `(yalniz-dev danisma sayisi ~${Math.max(0, devOnly)}). Bu kapi dev zincirini BLOKLAMAZ.`,
    );
  }

  const m = audit.metadata?.vulnerabilities ?? {};
  console.log(
    `\nUretim bagimliliklari: ${found.size} distinct danisma ` +
      `(critical=${m.critical ?? 0} high=${m.high ?? 0} moderate=${m.moderate ?? 0}), ` +
      `${accepted.size} triaj kaydi. Sonuc: ${failed ? "KIRMIZI" : "yesil"}.`,
  );
  return failed ? 1 : 0;
}

process.exit(main());
