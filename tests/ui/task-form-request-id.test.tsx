// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// E2 (Codex 11-17): elle görev formu istek kimliği taşır. Sözleşme:
//  1. Her POST bir `requestId` taşır (KB / söz kartıyla aynı biçim).
//  2. Ağ hatasından sonra AYNI form yeniden gönderilirse AYNI kimlik gider (sunucu ilk görevi döndürür).
//  3. Form değişirse YENİ kimlik (düzenlenmiş form = yeni işlem).
// ---------------------------------------------------------------------------

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/tasks/new" }));

import { TaskForm } from "@/components/tasks/task-form";

type Call = [string, RequestInit | undefined];
const posts = () =>
  (vi.mocked(fetch).mock.calls as unknown as Call[]).map(([, init]) => JSON.parse(String(init!.body)) as { requestId?: string; title: string });

function mockFetch(plan: Array<"net" | "ok">) {
  const steps = [...plan];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const step = steps.shift() ?? "ok";
      if (step === "net") throw new TypeError("Failed to fetch");
      return { ok: true, status: 201, json: async () => ({ id: "t1" }) } as unknown as Response;
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.push.mockClear();
});

const PROPS = [{ id: "p1", name: "Lale" }];
const submit = () => fireEvent.click(screen.getByRole("button", { name: /Görev Oluştur/ }));
const typeTitle = (v: string) => fireEvent.change(document.getElementById("title")!, { target: { value: v } });

describe("elle görev formu — istek kimliği (E2)", () => {
  it("🚨 ağ hatasından sonra aynı form yeniden gönderilince AYNI kimlik gider", async () => {
    mockFetch(["net", "ok"]);
    render(<TaskForm properties={PROPS} members={[]} />);
    typeTitle("Balkonu yıka");
    submit();
    await screen.findByText(/İnternet bağlantınızda sorun/);
    submit();
    await waitFor(() => expect(posts()).toHaveLength(2));
    const [a, b] = posts();
    expect(a.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(b.requestId).toBe(a.requestId);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/tasks"));
  });

  it("form değişince yeni kimlik (düzenlenmiş form = yeni işlem)", async () => {
    mockFetch(["net", "ok"]);
    render(<TaskForm properties={PROPS} members={[]} />);
    typeTitle("Balkonu yıka");
    submit();
    await screen.findByText(/İnternet bağlantınızda sorun/);
    typeTitle("Balkonu ve camları yıka");
    submit();
    await waitFor(() => expect(posts()).toHaveLength(2));
    const [a, b] = posts();
    expect(b.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(b.requestId).not.toBe(a.requestId);
  });
});
