import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// M-2 dilim 2 — `/api/health?strict=1` ÜYELİK YOKLAMASI (Opus S2).
//
// Uç herkese açık ve kimliksiz → kuyruk yoklamasıyla (`outbox/health.ts` `strictQueueState`, Codex 10-16 ölçümü: önbellek boşken 100 eşzamanlı
// istek 400 okuma başlatıyordu) AYNI desen: 30 sn bellek içi sonuç + süren yoklamaya katılma + sıfırlama kuşağı. Sorgu sayım DEĞİL varlık
// sorusu: eksik VARSA ilk eşleşmede durur; yoksa (olağan durum) kullanıcı tablosunu okur (Prisma `none` = `NOT IN (alt sorgu)`) — 30 sn
// önbellekle ölçekte önemsiz (Opus R10).
//
// "missing" = HİÇ üyelik satırı olmayan kullanıcı var: kayan dağıtımda eski kodun açtığı hesap; oturum üyelikten doğrulandığı için böyle biri
// giriş YAPAMAZ → sayfalar (onarım: `scripts/membership-backfill.ts`, önce salt-okuma). Yalnız ÇIKARILMIŞ üyeliği olan kişi meşrudur, sayılmaz.
// Okunamazsa "unknown" (sayfalamaz — DB arızasını yoklamanın kendisi görür); hata sonucu da süre boyunca önbellekte durur (kuyrukla aynı).
// 🚨 Ü-1 "askıda hesap" seçilirse (işletme silinince yalnız orada üyeliği olan kişi satırsız kalır) bu tanım o tasarımla birlikte değişir
// (Opus S11) — yoksa askıdaki hesap kalıcı 503 verir.
// ---------------------------------------------------------------------------

export type StrictMembershipState = "ok" | "missing" | "unknown";

const MEMBERSHIP_PROBE_TTL_MS = 30_000;
let membershipProbe: { at: number; state: StrictMembershipState } | null = null;
let membershipProbeInFlight: Promise<StrictMembershipState> | null = null;
/** Sıfırlama kuşağı: sıfırlamadan önce başlamış yoklamanın sonucu önbelleğe yazılmaz (yalnız test yardımcısı için). */
let membershipProbeGeneration = 0;

async function probeMembershipState(now: number): Promise<StrictMembershipState> {
  const generation = membershipProbeGeneration;
  let state: StrictMembershipState;
  try {
    const orphan = await prisma.user.findFirst({ where: { memberships: { none: {} } }, select: { id: true } });
    state = orphan ? "missing" : "ok";
  } catch {
    state = "unknown";
  }
  if (generation === membershipProbeGeneration) membershipProbe = { at: now, state };
  return state;
}

export async function strictMembershipState(): Promise<StrictMembershipState> {
  const now = Date.now();
  if (membershipProbe && now - membershipProbe.at < MEMBERSHIP_PROBE_TTL_MS) return membershipProbe.state;
  if (membershipProbeInFlight) return membershipProbeInFlight;
  const probe = probeMembershipState(now).finally(() => {
    if (membershipProbeInFlight === probe) membershipProbeInFlight = null;
  });
  membershipProbeInFlight = probe;
  return probe;
}

/** Test yardımcısı: üyelik yoklamasının bellek içi sonucunu sıfırla. */
export function __resetStrictMembershipState(): void {
  membershipProbe = null;
  membershipProbeInFlight = null;
  membershipProbeGeneration += 1;
}
