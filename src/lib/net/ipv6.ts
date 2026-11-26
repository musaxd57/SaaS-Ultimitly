/**
 * `isIP(...) === 6` doğrulanmış adresi 8 sayılık gruba açar (`::` ve sondaki gömülü IPv4 dahil). YAPRAK modül (hiçbir şey import etmez): hız
 * sınırı kovası (`rate-limit.ts`) ve kayıt ağı izinin saf çekirdeği (`billing/signup-network-core.ts`) ortak kullanır.
 */
export function expandIpv6(addr: string): number[] | null {
  let s = addr;
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const o = tail.split(".").map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s = `${s.slice(0, lastColon + 1)}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || head.length + rest.length + fill !== 8) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest].map((h) => parseInt(h, 16));
  return groups.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? groups : null;
}
