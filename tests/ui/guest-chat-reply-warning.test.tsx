// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { GuestChatReply } from "@/components/guest-chats/reply-box";

// The QR guest-chat is a SHARED channel (first-scan device binding is not guest
// authentication). Host replies land in a thread a wrong-first-scanner could read,
// so the reply box must warn the host to keep secrets (door code / Wi-Fi) out of it
// and use the OTA message instead. Lock that warning in.
describe("GuestChatReply — shared-channel warning", () => {
  afterEach(() => cleanup());

  it("warns the host not to put door codes / Wi-Fi / personal data in the shared channel", () => {
    render(<GuestChatReply conversationId="c1" />);
    expect(screen.getByText(/paylaşılan/i)).toBeTruthy();
    expect(screen.getByText(/Kapı kodu, Wi-Fi şifresi/i)).toBeTruthy();
    expect(screen.getByText(/Airbnb\/Booking mesajından/i)).toBeTruthy();
  });
});
