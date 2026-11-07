import { describe, it, expect } from "vitest";
import { rotateFrom } from "@/lib/sync-fairness";

// F17 (Codex 09-05): geçiş bütçesi bitince atlanan org'lar sonraki geçişte ÖNCE gelir. Davranışsal pin:
// `tests/integration/scheduled-sync-fairness.test.ts`.

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join(",");
const orgs = ["a", "b", "c", "d"].map((id) => ({ id }));

describe("rotateFrom", () => {
  it("imleç yoksa taban sıra aynen (girdi değişmez)", () => {
    expect(ids(rotateFrom(orgs, null))).toBe("a,b,c,d");
    expect(rotateFrom(orgs, null)).not.toBe(orgs);
  });

  it("🚨 imleçteki org'dan başlar, listenin başına döner", () => {
    expect(ids(rotateFrom(orgs, "c"))).toBe("c,d,a,b");
    expect(ids(rotateFrom(orgs, "a"))).toBe("a,b,c,d");
  });

  it("imleçteki org artık yoksa (silinmiş/boşta) ondan SONRAKİ ilk org'dan başlar", () => {
    expect(ids(rotateFrom(orgs, "bb"))).toBe("c,d,a,b");
  });

  it("imleç tüm kimliklerden büyükse baştan", () => {
    expect(ids(rotateFrom(orgs, "z"))).toBe("a,b,c,d");
  });

  it("boş liste boş döner", () => {
    expect(rotateFrom([], "a")).toEqual([]);
  });
});
