// ---------------------------------------------------------------------------
// KİLİT SINAMASI (Opus 10-15 B8): kilitli bölgedeki test kancasına bağlanır. Her çağrı bölgeye girince öteki çağrıyı `waitMs` kadar
// BEKLER — kilit yoksa ikinci çağrı da "var mı?" okumasını geçip buraya gelir (ikisi aynı anda içeride: `maxInside() === 2`, çift yazma);
// kilit varsa ikinci çağrı kilitte bekler, burada hiç buluşma olmaz (`maxInside() === 1`). Böylece eşzamanlılık testi `Promise.all`
// zamanlamasına değil, kilidin kendisine bağlı olur: kilit kaldırılan mutant HER koşuda kırmızı.
// ---------------------------------------------------------------------------
// Bekleme 1 sn (Haiku 10-15): tam suit yükünde kilitsiz ikinci çağrının kancaya varması 300 ms'yi aşabilir → kilit kaldırılan mutant
// yanlışlıkla yeşil kalırdı. Kilit VARKEN her çağrı bu süre kadar bekler (3 çağrı ≈ 3 sn) — bedel bilinçli.
export function lockProbe(waitMs = 1_000) {
  let inside = 0;
  let maxInside = 0;
  let entries = 0;
  let wake: () => void = () => {};
  let partner = new Promise<void>((r) => (wake = r));
  return {
    entries: () => entries,
    maxInside: () => maxInside,
    async hook(): Promise<void> {
      entries += 1;
      inside += 1;
      maxInside = Math.max(maxInside, inside);
      if (inside >= 2) wake();
      await Promise.race([partner, new Promise<void>((r) => setTimeout(r, waitMs).unref?.())]);
      inside -= 1;
      if (inside === 0) partner = new Promise<void>((r) => (wake = r));
    },
  };
}
