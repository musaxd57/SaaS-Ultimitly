// Mutasyon koşucusunun SAF karar fonksiyonları (09-24). Ağ yok, dosya sistemi yok, alt süreç yok —
// `scripts/mutation-run.mjs` bunları çağırır; korumalar betik ÇALIŞTIRILARAK değil bu fonksiyonlarla sınanır
// (CLAUDE.md: yıkıcı olabilecek bir betik "denemek" için çalıştırılmaz). Pin: tests/unit/mutation-runner-core.test.ts.

/** Spesifikasyonu doğrular; hata listesi döndürür (boş = geçerli). */
export function validateSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object") return ["spec bir nesne değil"];
  const isStrList = (xs) => Array.isArray(xs) && xs.length > 0 && xs.every((x) => typeof x === "string" && x.trim() !== "");
  if (!isStrList(spec.tests)) errors.push("tests: boş olmayan metin listesi olmalı");
  if (!Array.isArray(spec.mutants) || spec.mutants.length === 0) {
    errors.push("mutants: boş olmayan liste olmalı");
    return errors;
  }
  const ids = new Set();
  spec.mutants.forEach((m, i) => {
    const at = `mutants[${i}]`;
    if (!m || typeof m !== "object") return errors.push(`${at}: nesne değil`);
    if (typeof m.id !== "string" || !/^[A-Za-z0-9_.-]{1,40}$/.test(m.id)) errors.push(`${at}.id geçersiz`);
    else if (ids.has(m.id)) errors.push(`${at}.id tekrar ediyor: ${m.id}`);
    else ids.add(m.id);
    if (typeof m.file !== "string" || m.file.startsWith("/") || m.file.split(/[\\/]/).includes("..")) {
      errors.push(`${at}.file depo içi göreli yol olmalı`);
    }
    if (typeof m.old !== "string" || m.old === "") errors.push(`${at}.old boş olamaz`);
    if (typeof m.new !== "string") errors.push(`${at}.new metin olmalı`);
    if (m.old === m.new) errors.push(`${at}: old ile new aynı (mutasyon yok)`);
    if (m.tests !== undefined && !isStrList(m.tests)) errors.push(`${at}.tests verildiyse boş olmayan metin listesi olmalı`);
  });
  return errors;
}

/**
 * Çapayı TAM BİR KEZ değiştirir. 0 ya da ≥2 geçiş = hata (sahte "öldürüldü"/"yaşadı" üretmesin: çapa kaymışsa
 * mutasyon uygulanmamış olur ve testlerin yeşili hiçbir şey kanıtlamaz).
 */
export function applyMutant(src, oldText, newText) {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = src.indexOf(oldText, from);
    if (at === -1) break;
    count += 1;
    from = at + oldText.length;
  }
  if (count !== 1) return { ok: false, count };
  const at = src.indexOf(oldText);
  return { ok: true, count, out: src.slice(0, at) + newText + src.slice(at + oldText.length) };
}

/**
 * `ps -eo pid,args` çıktısında KENDİMİZ dışında çalışan bir vitest var mı? Test kurulumu PG 5433'ü her koşuda
 * `stop -m immediate` + `initdb` ile sıfırlar → eşzamanlı koşu diğerinin veritabanını öldürür (ölçüldü: 42–59 sahte
 * kırmızı dosya). Ana süreç `node (vitest …)` görünür; `vitest run` kabukları da sayılır.
 * Yalnız ÇALIŞTIRMA biçimi sayılır: `vitest` (ya da giriş dosyası `vitest.mjs`) boşluk / parantez / kabuk işareti / yol
 * ayırıcısından sonra gelir, ardından boşluk / kapanış parantezi / tırnak / satır sonu. Adı yalnız GEÇEN kabuk
 * (`vitest.config.ts` arayan grep, `"vitest"` deseni, `vitest-…` paketi) vitest değildir — 09-24'te böyle bir grep iki
 * koşuyu durdurdu.
 */
const VITEST_INVOCATION = /(?:^|[\s(/;&|])vitest(?:\.mjs)?(?=[\s)'"]|$)/;

export function concurrentVitest(psOutput, selfPids = []) {
  const skip = new Set(selfPids.map(String));
  return String(psOutput)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => {
      const m = /^(\d+)\s+(.*)$/.exec(l);
      if (!m || skip.has(m[1])) return false;
      const args = m[2];
      if (/\bmutation-run\.mjs\b/.test(args) || /^(?:grep|ps)\b/.test(args)) return false;
      return VITEST_INVOCATION.test(args);
    });
}

/**
 * Yazılacak hedef adanmış worktree'nin İÇİNDE mi? Koşucu ana çalışma ağacına hiçbir koşulda yazmaz — ana ağaç koşu
 * boyunca düzenlenebilir kalsın diye durum kıyası değil YAPISAL bir şart (her yazmadan önce).
 */
export function insideDir(dir, target) {
  const norm = (p) => String(p).replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  const d = norm(dir);
  const t = norm(target);
  if (d === "" || t.split("/").includes("..")) return false;
  return t.startsWith(`${d}/`);
}

/** Sonuç özeti: çıkış kodu sözleşmesi (0 hepsi öldürüldü · 1 yaşayan var). */
export function summarize(results) {
  const survived = results.filter((r) => r.outcome === "survived").map((r) => r.id);
  const killed = results.filter((r) => r.outcome === "killed").length;
  return { killed, total: results.length, survived, exitCode: survived.length > 0 ? 1 : 0 };
}
