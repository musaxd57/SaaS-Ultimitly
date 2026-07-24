// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AutoRefresh } from "@/components/inbox/auto-refresh";

describe("AutoRefresh (UI)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("re-fetches server data on each interval while the tab is visible", () => {
    render(<AutoRefresh seconds={30} />);
    expect(refresh).not.toHaveBeenCalled(); // nothing on mount

    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stops the timer on unmount (no leaked interval)", () => {
    const { unmount } = render(<AutoRefresh seconds={30} />);
    unmount();
    vi.advanceTimersByTime(120_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
