/* Gerçek mesaj eval betiklerinin ortak G/Ç parçası (09-24): git'in bir yolu yok sayıp saymadığı. */
import { execFileSync } from "node:child_process";

/** `git check-ignore -q` — yok sayılıyorsa true; git yoksa / hata varsa false (kapı reddeder: fail-closed). */
export function gitIgnoredIn(repo: string): (relToRepo: string) => boolean {
  return (rel) => {
    try {
      execFileSync("git", ["-C", repo, "-c", `safe.directory=${repo}`, "check-ignore", "-q", rel], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
}
