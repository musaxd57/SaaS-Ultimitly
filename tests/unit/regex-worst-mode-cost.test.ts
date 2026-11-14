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
    "%s: veto + dedektör + süzgeç + can güvenliği sınıfı + kişisel tehlike + evcil hayvan sızıntısı + tazminat sözü 4.000 karakterde 1,5 sn altında ya da doğrusal",
    (mode) => {
      const r = spawnSync(process.execPath, [mode, "--import", "tsx", "tests/fixtures/regex-worst-mode-probe.ts"], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 240_000,
      });
      // Sonuçlar satır satır gelir: zaman aşımında (status null) bile o ana kadarki ölçümler ve nerede kalındığı okunur.
      const rows = r.stdout
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .map((l) => JSON.parse(l) as { name?: string; ms?: number; ok?: boolean; note?: string; done?: boolean });
      const times = rows.filter((t) => t.name !== undefined);
      const last = times.length > 0 ? `son biten ölçüm: ${times[times.length - 1].name}` : "hiçbir ölçüm bitmedi";
      // Zaman aşımı da kırmızıdır — karesel iş alt süreci 240 sn'de bitiremez. (Eski tavan 90 sn idi; sınır aşılan her ölçüm artık
      // hakem için 5 tam + 5 küçük koşu harcar: yavaş makinede birkaç ölçüm hakeme giderse 90 sn yetmezdi — Opus incelemesi 11-12.)
      expect(r.status, `${r.error ?? ""} ${r.stderr} (${times.length} / 30 ölçüm; ${last})`).toBe(0);
      expect(rows[rows.length - 1]?.done).toBe(true);
      // 22 eski ölçüm + tutulan evcil hayvan isteği sızıntı denetiminin altı biçimi (S3, 11-12: en çok 31 ms).
      expect(times).toHaveLength(30);
      expect(new Set(times.map((t) => t.name)).size).toBe(30);
      // Hüküm alt süreçte verilir (`tests/helpers/linear-cost.ts`): 1,5 sn altında ya da — yavaş makinede aşıldıysa — doğrusal.
      for (const t of times) expect(t.ok, `${t.name}: ${t.note}`).toBe(true);
    },
    300_000,
  );
});
