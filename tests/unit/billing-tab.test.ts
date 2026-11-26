import { describe, it, expect } from "vitest";
import { billingTabAvailable, paddleConfigured } from "@/lib/billing/billing-tab";

// Faturalandırma sekmesi tek kural (Haiku 10-22): sahip + Paddle istemci anahtarı + en az bir fiyat kimliği. Bağlantı veren yüzeyler
// (gelen kutusu kilitli anahtar, konuşma bandı) ve Ayarlar sayfası aynı kurala bakar.
const env = (over: Record<string, string>) => ({ ...over }) as unknown as NodeJS.ProcessEnv;

describe("Faturalandırma sekmesi ne zaman var", () => {
  it("sahip + anahtar + fiyat → var", () => {
    expect(billingTabAvailable("owner", env({ NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "t", PADDLE_PRICE_PRO: "pri_1" }))).toBe(true);
  });
  it("sahip değil → yok", () => {
    expect(billingTabAvailable("manager", env({ NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "t", PADDLE_PRICE_PRO: "pri_1" }))).toBe(false);
  });
  it("anahtar ya da fiyat yok → yok (boşluk da yok sayılır)", () => {
    expect(paddleConfigured(env({ PADDLE_PRICE_PRO: "pri_1" }))).toBe(false);
    expect(paddleConfigured(env({ NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "t" }))).toBe(false);
    expect(paddleConfigured(env({ NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: " ", PADDLE_PRICE_PRO: "pri_1" }))).toBe(false);
    expect(paddleConfigured(env({ NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "t", PADDLE_PRICE_ISLETME: " pri_2 " }))).toBe(true);
  });
});
