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
 *   3. Denetim HIC KOSAMADI (registry erisilemez / cikti ayristirilamadi /
 *      lockfile yok)                        -> kapi HICBIR SEY dogrulamadi
 *
 * 🚨 FAIL-CLOSED (P1 #4, 08-09 (2)): 3. durum eskiden `exit 0 + uyari` idi.
 * Gerekce "kayit defteri hickirigi deploy'u bloklamasin"di ve YANLISTI: bir
 * tedarik zinciri kapisi, KOSMADIGINI "yesil" diye raporlarsa kapi degil
 * TIYATRODUR — CI yesil, kimse bakmiyor, yeni bir critical danisma sessizce
 * iceri giriyor. Ayni dosya 08-07 (5)'te tam bu sinifta bir arizayla
 * duzeltilmisti (sekil dogrulamasi); o zaman fail-open dali BIRAKILMISTI.
 *
 * FLAKINESS DENGESI: registry gercekten titreyebilir. Cozum fail-open degil
 * YENIDEN DENEME (AUDIT_RETRIES, artan bekleme). Uc denemede de kosamiyorsa
 * bu bir hickirik degil, bir arizadir ve gorunmesi gerekir.
 *
 * KAPSAM: blokllayici tarama URETIM bagimliliklari (--omit=dev). Dev zinciri
 * (vitest/vite/eslint) yalnizca sayi olarak raporlanir — orada danismalar cok
 * sik ve musteri verisine ulasmiyorlar.
 *
 * Kosum: `node scripts/audit-check.mjs`  (CI'da ve elle ayni)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
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
export function extractAdvisories(auditJson) {
  const found = new Map();
  for (const vuln of Object.values(auditJson.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      // string `via` = gecisli zincirin ust paketi, kendi danismasi yok.
      if (typeof via === "string") continue;
      // 🚨 GHSA'SIZ DANISMA SESSIZCE ATLANMAZ (09-23, denetim ajani): eskiden URL'sinde GHSA
      // kimligi olmayan (npm'in eski /advisories/<no> bicimi, url alani eksik) bir danisma
      // `continue` ile DUSUYORDU -> npm audit zafiyet raporlarken kapi YESIL kaliyordu
      // (fail-open). Artik kararli bir yedek kimlikle sayilir; triaj edilmemisse KIRMIZI,
      // gerekirse baseline'a bu kimlikle yazilir.
      const id =
        /GHSA-[0-9a-z-]+/.exec(via.url ?? "")?.[0] ??
        `NO-GHSA:${via.source ?? via.url ?? `${via.name ?? "?"}:${via.title ?? "?"}`}`;
      if (found.has(id)) continue;
      found.set(id, { id, package: via.name, severity: via.severity, title: via.title ?? "" });
    }
  }
  return found;
}

/** Kac kez denenecek (registry titremesi fail-closed'i flaky yapmasin). */
const AUDIT_RETRIES = Number(process.env.AUDIT_RETRIES ?? 3);
/** Denemeler arasi bekleme. Testte 0 verilir; uretimde artan bekleme. */
const AUDIT_RETRY_DELAY_MS = Number(process.env.AUDIT_RETRY_DELAY_MS ?? 2000);

function sleepSync(ms) {
  // Senkron bekleme: bu script tek atimlik bir CI adimi, olay dongusu yok.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Tek deneme. Sekil dogrulamasindan gecen rapor ya da null. */
function runAuditOnce(omitDev) {
  const args = ["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])];
  try {
    return asAuditReport(
      JSON.parse(execFileSync("npm", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })),
    );
  } catch (err) {
    // Bulgu varsa npm sifir-disi cikar ama stdout GECERLI JSON'dur.
    const out = err?.stdout;
    if (typeof out === "string" && out.trim().startsWith("{")) {
      try {
        return asAuditReport(JSON.parse(out));
      } catch {
        /* altyapi daline dus */
      }
    }
    return null;
  }
}

/**
 * `npm audit` calistirir; gecici bir arizada YENIDEN DENER.
 *
 * Yeniden deneme, fail-closed'in bedelini oderken guvenceyi korumanin yoludur:
 * gercek bir registry hickirigi ikinci denemede gecer, gercek bir ariza ucunde
 * de gecmez ve KIRMIZI olur.
 */
function runAudit(omitDev) {
  for (let i = 0; i < Math.max(1, AUDIT_RETRIES); i++) {
    const r = runAuditOnce(omitDev);
    if (r) return r;
    if (i < AUDIT_RETRIES - 1) {
      annotate("warning", `npm audit denemesi ${i + 1}/${AUDIT_RETRIES} basarisiz — yeniden deneniyor.`);
      if (AUDIT_RETRY_DELAY_MS > 0) sleepSync(AUDIT_RETRY_DELAY_MS * (i + 1));
    }
  }
  return null;
}

/**
 * LOCKFILE DENETIMI (P1 #4). `npm audit` lockfile'dan calisir; lockfile yoksa
 * npm `ENOLOCK` basar ve o cikti sekil dogrulamasindan GECMEZ — ama hata mesaji
 * "registry erisilemiyor" ile ayni kovaya duserdi. Ayri ve NET soylemek, arizayi
 * dogru yere yonlendirir.
 *
 * ⚠️ Bu, deponun KENDI yasadigi bir riskin karsiligi: varsayilan dal `main`de
 * `package-lock.json` YOK (olculdu, 08-09 (2)). Lockfile'siz bir agacta bu kapi
 * hicbir sey denetleyemez ve bunu SOYLEMELIDIR.
 */
function lockfilePresent() {
  return existsSync(path.join(ROOT, "package-lock.json"));
}

/**
 * 🚨 SEKIL DOGRULAMASI — "JSON ayristirilabildi" YETMEZ (denetim 08-07 (5)).
 *
 * npm audit ALTYAPI hatasinda da `{` ile baslayan gecerli JSON basar:
 *   registry erisilemez  -> {"message":"request to … ECONNREFUSED","error":{}}
 *   lock dosyasi yok     -> {"error":{"code":"ENOLOCK", …}}
 * Ikisi de JSON.parse'i gecer ve `vulnerabilities` ANAHTARI YOKTUR → eski kod
 * bunu "sifir bulgu" sanip kapiyi YESIL basiyordu. Yani tedarik zinciri kapisi
 * HICBIR SEY denetlemeden "yesil" diyordu; belgelenmis fail-open dalindan
 * (en azindan UYARI basar) DAHA KOTU bir arıza modu.
 *
 * Rapor sekli dogrulanamiyorsa null → cagiran altyapi dalina duser: uyari + exit 0.
 * Fail-open YALNIZ altyapi icin; BULGU bulundugunda kapi fail-closed kalir.
 */
function asAuditReport(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  // npm 7+ `vulnerabilities` (obje) + `metadata.vulnerabilities` (sayaclar) basar.
  // Bos bir denetim bile ikisini de ICERIR (bos obje / sifirlar), yani varliklari
  // "gercekten denetim kostu" kanitidir.
  const hasAdvisoryMap = parsed.vulnerabilities && typeof parsed.vulnerabilities === "object";
  const hasCounters =
    parsed.metadata &&
    typeof parsed.metadata === "object" &&
    parsed.metadata.vulnerabilities &&
    typeof parsed.metadata.vulnerabilities === "object";
  if (!hasAdvisoryMap || !hasCounters) return null;
  return parsed;
}

function main() {
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const accepted = new Map(baseline.accepted.map((a) => [a.id, a]));

  // LOCKFILE once: yoksa denetimin kosmasi zaten anlamsiz ve sebebi NET soylenir.
  if (!lockfilePresent()) {
    annotate(
      "error",
      "package-lock.json YOK — `npm audit` lockfile'dan calisir, yani bu agacta zafiyet " +
        "kapisi HICBIR SEY dogrulayamaz. (Varsayilan dal `main`de lockfile bulunmuyor; " +
        "bu kapi yalnizca lockfile TASIYAN bir agacta anlamlidir.)",
    );
    return 1;
  }

  const audit = runAudit(true);
  if (!audit) {
    // 🚨 FAIL-CLOSED. Eskiden burasi `exit 0 + uyari` idi: kapi KOSMADIGINI
    // "yesil" diye raporluyordu. Bir tedarik zinciri kapisinin en kotu arıza
    // modu budur — CI yesil, kimse bakmiyor, yeni critical sessizce iceri girer.
    annotate(
      "error",
      `npm audit ${AUDIT_RETRIES} denemede de calistirilamadi veya ciktisi sekil ` +
        "dogrulamasindan gecmedi — kapi HICBIR SEY denetleyemedi. Bu bir ALTYAPI " +
        "arizasidir ve sessizce yesil GECILMEZ. (Gercekten gecici ise: adimi yeniden calistirin.)",
    );
    return 1;
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

// Dogrudan calistirildiginda kos (npm run audit:check / CI). Test ICE AKTARINCA kosmaz.
// ⚠️ Karsilastirma DOSYA ADIYLA, import.meta.url ile DEGIL: sembolik bagli bir yolda
// url esitligi tutmayabilir ve kapi SESSIZCE hic kosmadan 0 ile cikardi (fail-open).
// Dosya adi eslesmesi dogrudan calistirmanin her bicimini yakalar.
if (path.basename(process.argv[1] ?? "") === "audit-check.mjs") process.exit(main());
