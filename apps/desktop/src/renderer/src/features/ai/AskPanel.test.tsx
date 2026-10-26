import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AskPanel } from "./AskPanel";
import { idleRun, type RunState } from "./aiRun";
import type { Turn } from "./askState";
import type { useAsk } from "./useAsk";

const conv = (turns: Turn[]): ReturnType<typeof useAsk> => ({ turns, ask: vi.fn(async () => {}), stop: vi.fn() }) as unknown as ReturnType<typeof useAsk>;
const turn = (run: Partial<RunState>): Turn => ({ id: 1, question: "When is the offsite?", run: { ...idleRun, ...run } });

describe("AskPanel accessibility", () => {
  it("announces the start and finish, and focuses the finished answer", () => {
    const { rerender } = render(<AskPanel conversation={conv([turn({ status: "running", runId: "r", text: "It is" })])} onClose={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("Answering");
    rerender(<AskPanel conversation={conv([turn({ status: "done", runId: "r", text: "It is on May 4." })])} onClose={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("Answer ready");
    expect(document.activeElement?.textContent).toContain("It is on May 4.");
  });

  it("doesn't take focus for an answer that was already there", () => {
    render(<AskPanel conversation={conv([turn({ status: "done", runId: "r", text: "Old answer" })])} onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Question" }));
  });

  it("reports a failure as an alert", () => {
    render(<AskPanel conversation={conv([turn({ status: "error", error: "Couldn't reach ChatGPT." })])} onClose={() => {}} />);
    expect(screen.getByRole("alert").textContent).toBe("Couldn't reach ChatGPT.");
  });
});
