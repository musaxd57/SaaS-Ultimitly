import { DEMO_ORG_ID, DEMO_PASSWORD_MIN_LENGTH } from "./constants";

// ---------------------------------------------------------------------------
// DEMO HESABI — betiğin KARAR fonksiyonu (saf). Betik yıkıcı bir işlem yaptığı için korumaları
// betiği "deneyerek" değil bu fonksiyonla sınanır (CLAUDE.md: yıkıcı betik denemek için ÇALIŞTIRILMAZ).
//
// Varsayılan KURU KOŞU. Yazmak için üç şart birden: DEMO_TENANT_APPLY=1 · DEMO_TENANT_EXPECT_ORG
// demo org kimliğiyle birebir · yerel olmayan veritabanında DEMO_TENANT_REMOTE_HOST adresin sunucu
// adıyla birebir. İlk kurulumda şifre DEMO_TENANT_PASSWORD'dan (en az 20 karakter; koda/loga yazılmaz).
// ---------------------------------------------------------------------------

export type DemoCliDecision =
  | { mode: "dry_run"; password: string | null }
  | { mode: "apply"; password: string | null; rotatePassword: boolean; resetSecurity: boolean }
  | { mode: "refuse"; reason: "expect_org_mismatch" | "remote_host_unconfirmed" | "bad_database_url" | "password_too_short" | "rotate_without_password" };

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function decideDemoRun(env: Readonly<Record<string, string | undefined>>): DemoCliDecision {
  let host: string;
  try {
    host = new URL(env.DATABASE_URL ?? "").hostname;
  } catch {
    return { mode: "refuse", reason: "bad_database_url" };
  }
  if (!host) return { mode: "refuse", reason: "bad_database_url" };

  const password = env.DEMO_TENANT_PASSWORD ? env.DEMO_TENANT_PASSWORD : null;
  if (password !== null && password.length < DEMO_PASSWORD_MIN_LENGTH) return { mode: "refuse", reason: "password_too_short" };

  if (env.DEMO_TENANT_APPLY !== "1") return { mode: "dry_run", password };

  if (env.DEMO_TENANT_EXPECT_ORG !== DEMO_ORG_ID) return { mode: "refuse", reason: "expect_org_mismatch" };
  if (!isLoopback(host) && env.DEMO_TENANT_REMOTE_HOST !== host) return { mode: "refuse", reason: "remote_host_unconfirmed" };
  const rotatePassword = env.DEMO_TENANT_ROTATE_PASSWORD === "1";
  if (rotatePassword && password === null) return { mode: "refuse", reason: "rotate_without_password" };
  return { mode: "apply", password, rotatePassword, resetSecurity: env.DEMO_TENANT_RESET_SECURITY === "1" };
}
