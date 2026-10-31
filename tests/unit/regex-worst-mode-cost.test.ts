import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// EN KÖTÜ DÜZENLİ İFADE KİPİ SÜRE PİNİ (10-30, ölçüldü). V8 bir kalıbı ilk çalıştırmada (ve bellek temizliğinde kodu atıldıktan sonra)
// YORUMLAYICIDA koşturur; derlenmiş kodda da konum atlatan hızlı denetimler her durumda devrede değildir (ölçüldü: uzun iki baytlık bir
// metinden sonra tek baytlık uzun metin — süzgeç cümle cümle veto çağırınca — çıktı vetosunun Türkçe söz kalıbı 16.000 karakterde 8 sn).
// Olağan süre pinleri (`*-cost.test.ts`) derlenmiş + iyileştirilmiş kipte ölçer ve gövdeden ÖNCE gelen sınırsız geriye bakışı kaçırır
// (09-28 ölçümü "yavaş değil" demişti). Bu pin aynı ölçümü V8'in iki kötü kipinde ayrı bir süreçte yapar:
//   · `--no-regexp-optimization` (konum atlatan hızlı denetim yok) · `--regexp-interpret-all` (yalnız yorumlayıcı)
// Ölçüm (4.000 karakter): v3 + eski veto → veto 1,0–25,7 sn, süzgeç 22–189 sn; v4 + gövde-önce veto → en çok 0,44 sn.
// ---------------------------------------------------------------------------

const MODES = ["--no-regexp-optimization", "--regexp-interpret-all"];

describe("düzenli ifade en kötü kipte — uzun boşluk dizisinde sınırlı süre", () => {
  it.each(MODES)(
    "%s: veto + dedektör + süzgeç + can güvenliği sınıfı + kişisel tehlike 4.000 karakterde 1,5 sn altında",
    (mode) => {
      const r = spawnSync(process.execPath, [mode, "--import", "tsx", "tests/fixtures/regex-worst-mode-probe.ts"], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 90_000,
      });
      // Zaman aşımı (status null) da kırmızıdır — karesel iş alt süreci 90 sn'de bitiremez.
      expect(r.status, `${r.error ?? ""} ${r.stderr}`).toBe(0);
      const line = r.stdout.trim().split("\n").pop() ?? "{}";
      const times = JSON.parse(line) as Record<string, number>;
      expect(Object.keys(times)).toHaveLength(14);
      for (const [name, t] of Object.entries(times)) expect(t, name).toBeLessThan(1_500);
    },
    120_000,
  );
});
