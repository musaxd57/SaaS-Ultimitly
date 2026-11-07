import { describe, it, expect } from "vitest";
import { resolveGuestChat } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// QR sohbet belirteci biçimi sorgudan ÖNCE (10-01, 15 ajan incelemesi A04): "/c/%00…" gibi NUL taşıyan yol PostgreSQL'de sorgu hatasına
// (500 + alarm e-postası) dönüşüyordu. `generateChatToken` yalnız [0-9a-f] üretir; biçim dışı = bulunamadı.
// ---------------------------------------------------------------------------

describe("QR sohbet belirteci — biçim dışı belirteç sorguya gitmez", () => {
  it.each([
    ["NUL", "abcdef0123456789\u0000abcdef"],
    ["satır sonu", "abcdef0123456789\nabcdef"],
    ["yüzde kodu", "abcdef0123456789%00"],
    ["boşluk", "abcdef0123456789 abcdef"],
  ])("🚨 %s içeren belirteç → null (hata fırlatmaz)", async (_ad, token) => {
    await expect(resolveGuestChat(token)).resolves.toBeNull();
  });

  it("KONTROL: biçimi doğru ama kayıtsız belirteç → null (bugünkü gibi)", async () => {
    await expect(resolveGuestChat("0123456789abcdef0123456789abcdef")).resolves.toBeNull();
  });
});
