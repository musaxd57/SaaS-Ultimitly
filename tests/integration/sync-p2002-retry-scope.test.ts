import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/hospitable", () => ({
  listProperties: vi.fn(),
  listReservations: vi.fn(),
  listMessages: vi.fn(),
}));
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn().mockResolvedValue("test-token"),
}));

import { listProperties, listReservations, listMessages } from "@/lib/hospitable";
import { syncHospitable, __importThreadHooks } from "@/lib/hospitable-sync";

const mockProperties = vi.mocked(listProperties);
const mockReservations = vi.mocked(listReservations);
const mockMessages = vi.mocked(listMessages);

// ---------------------------------------------------------------------------
// P2002 RETRY KAPSAM TESTİ (Codex şart #1).
//
// Faz A'nın çağıran tarafındaki tek-seferlik retry'ı YALNIZ beklenen
// Conversation bileşik kısıtı için çalışmalıdır. Message'tan (ya da başka bir
// modelden) gelen ilgisiz bir P2002 sessizce yeniden denenirse:
//   · gerçek bir bug retry'ın arkasında gizlenir,
//   · aynı iş iki kez koşar (mesaj yazımı, supply türetme, model çağrısı),
//   · ve hata hiç görünmez.
// Gözlem noktası: `__importThreadHooks.afterCanonicalRead` her importThread
// çağrısında bir kez ateşlenir → çağrı sayısı retry'ın ateşlenip
// ateşlenmediğini birebir söyler.
// ---------------------------------------------------------------------------

function p2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: Prisma.prismaVersion.client,
    meta: { target },
  });
}

/** Tek rezervasyonluk, tek mesajlık en küçük sync senaryosu. */
function seedProviderFixtures() {
  mockProperties.mockResolvedValue([{ id: "hosp-prop-1", name: "Test Property" }]);
  mockReservations.mockResolvedValue([
    {
      id: "res-retry-1",
      code: "HMRTY",
      platform: "airbnb",
      conversation_id: "conv-retry-1",
      last_message_at: "2026-05-30T10:00:00Z",
    },
  ]);
  mockMessages.mockResolvedValue([
    {
      id: 9001,
      body: "Merhaba",
      sender_type: "guest",
      sender_role: "guest",
      sender: { full_name: "Test Misafir" },
      created_at: "2026-05-30T09:00:00Z",
    },
  ]);
}

describe("sync — P2002 retry KAPSAMI", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    __importThreadHooks.afterCanonicalRead = null;
    seedProviderFixtures();
  });

  afterEach(() => {
    __importThreadHooks.afterCanonicalRead = null;
  });

  it("NEGATİF: Message kısıtından gelen P2002 retry ETMEZ — yukarı fırlar", async () => {
    const { orgId } = await makeOrgWithProperty();
    let calls = 0;
    __importThreadHooks.afterCanonicalRead = async () => {
      calls++;
      throw p2002(["conversationId", "externalId"]); // ilgisiz kısıt
    };

    await syncHospitable(orgId);

    // TEK çağrı: retry ateşlenmedi. (İki olsaydı ilgisiz bir bug sessizce
    // yeniden denenmiş, iş iki kez koşmuş olurdu.)
    expect(calls).toBe(1);
    // Ve iş yarıda kaldığı için thread yazılmadı — hata yutulmadı, sonuç dürüst.
    expect(await prisma.conversation.count()).toBe(0);
  });

  it("NEGATİF: P2002 olmayan hata da retry ETMEZ", async () => {
    const { orgId } = await makeOrgWithProperty();
    let calls = 0;
    __importThreadHooks.afterCanonicalRead = async () => {
      calls++;
      throw new Error("gecici DB hatasi");
    };

    await syncHospitable(orgId);
    expect(calls).toBe(1);
  });

  it("POZİTİF: Conversation kimlik kısıtından gelen P2002 TAM BİR KEZ retry eder", async () => {
    const { orgId } = await makeOrgWithProperty();
    let calls = 0;
    __importThreadHooks.afterCanonicalRead = async () => {
      calls++;
      throw p2002(["propertyId", "externalReservationId"]);
    };

    await syncHospitable(orgId);

    // İki çağrı = ilk deneme + TEK retry. Üç olsaydı sınırsız döngü riski
    // olurdu; bir olsaydı migration sonrası yarış kurtarılamazdı.
    expect(calls).toBe(2);
  });

  it("POZİTİF: retry başarılı olursa thread normal şekilde yazılır", async () => {
    const { orgId } = await makeOrgWithProperty();
    let calls = 0;
    __importThreadHooks.afterCanonicalRead = async () => {
      calls++;
      if (calls === 1) throw p2002(["propertyId", "externalReservationId"]);
    };

    await syncHospitable(orgId);

    expect(calls).toBe(2);
    expect(await prisma.conversation.count()).toBe(1);
    expect(await prisma.message.count()).toBe(1);
  });
});
