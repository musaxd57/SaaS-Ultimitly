import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

/**
 * KOD KÖKENİ (Haiku 10-15): kollar yamalı ama commit edilmemiş ağaçlarda koşabilir — rapor HEAD'i, ağacın kirli olup olmadığını ve
 * `src/` yerel farkının özetini yazar (kol kimliği ayrıca istemden ölçülür, ↓`armOf`).
 */
export function codeProvenance(cwd: string): { head: string; dirty: boolean; srcDiff: string } {
  try {
    const run = (c: string) => execSync(c, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const head = run("git rev-parse --short HEAD").trim();
    const diff = run("git diff HEAD -- src");
    return { head, dirty: diff.length > 0, srcDiff: diff.length ? createHash("sha256").update(diff).digest("hex").slice(0, 12) : "-" };
  } catch {
    return { head: "?", dirty: false, srcDiff: "?" };
  }
}

