// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// Codex 11-17 C1, 2. tur: karar onayının duyurusu da sunucunun gönderim sonucundan (`delivery`). Kanala bağlı olmayan konuşmada karar
// mesajı misafire GİTMEZ (yalnız kaydedilir) — "Mesajınız misafire gönderildi." denmez; tek kaynak metin `LOCAL_REPLY_RECORDED_TEXT`.
// Alan yoksa / başka değerse bugünkü davranış.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));

import { DecisionPanel, type DecisionCardData } from "@/components/inbox/decision-panel";

const card: DecisionCardData = {
  id: "d1",
  kind: "early_checkin",
  title: "13:00 erken giriş",
  statusLabel: "Karar bekliyor",
  open: true,
  unverified: false,
  sending: false,
  version: 0,
  requestedTime: "13:00",
  dayKey: "2026-10-14",
  dayLabel: "14 Ekim (varış günü)",
  askedAt: "13 Eki 10:00",
  requestQuote: "13:00'te girebilir miyiz?",
  standardTime: "15:00",
  lang: "tr",
  fee: null,
  note: null,
  lines: [{ ok: false, text: "Çıkış temizliği henüz bitmedi." }],
  laterGuestMessageId: null,
  factsHash: "h1",
};

const LOCAL = "Cevabınız kaydedildi. Bu konuşma bir kanala bağlı olmadığı için misafire gönderilmedi.";
const SENT = "Mesajınız misafire gönderildi.";
const QUEUED = "Mesajınız sıraya alındı — birazdan gönderilecek.";

async function decideWith(json: unknown) {
  global.fetch = vi.fn(async () => new Response(JSON.stringify(json), { status: 200 })) as unknown as typeof fetch;
  render(<DecisionPanel conversationId="c1" decisions={[card]} />);
  fireEvent.click(screen.getByRole("button", { name: /Reddet/ }));
  fireEvent.click(screen.getByRole("button", { name: "Misafire gönder" }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
  return toastMock.success.mock.calls[0][0] as string;
}

describe("karar paneli — gönderim sonucu duyurusu", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("🚨 delivery 'local_only' → 'gönderildi' DENMEZ, 'kaydedildi, gönderilmedi'", async () => {
    expect(await decideWith({ status: "declined", queued: false, delivery: "local_only" })).toBe(LOCAL);
  });

  it("KONTROL — delivery 'channel_accepted' → 'Mesajınız misafire gönderildi.'", async () => {
    expect(await decideWith({ status: "declined", queued: false, delivery: "channel_accepted" })).toBe(SENT);
  });

  it("KONTROL — alan yok (eski yanıt) → bugünkü gibi 'gönderildi'", async () => {
    expect(await decideWith({ status: "declined", queued: false })).toBe(SENT);
  });

  it("KONTROL — kuyruk → bugünkü gibi 'sıraya alındı'", async () => {
    expect(await decideWith({ status: "declined", queued: true, delivery: "queued" })).toBe(QUEUED);
  });
});
