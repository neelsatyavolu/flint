import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { listStore } from "../../state/listStore";
import { ListFooter } from "./ListFooter";

const set = (patch: Partial<ReturnType<typeof listStore.getState>>) => act(() => listStore.setState(patch));
afterEach(() => set({ nextCursor: null, olderOnServer: false, loadingOlder: false, olderError: null, serverSearch: "idle", query: null, loadingMore: false }));

describe("ListFooter", () => {
  it("is empty when the whole list is local", () => {
    const { container } = render(<ListFooter />);
    expect(container.textContent).toBe("");
  });

  it("says older mail is not here yet and loads more on click", () => {
    const loadOlder = vi.fn(async () => undefined);
    set({ olderOnServer: true, loadOlder });
    render(<ListFooter />);
    expect(screen.getByText("Older mail isn't on this computer yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(loadOlder).toHaveBeenCalled();
  });

  it("shows quiet progress while loading and while searching the server", () => {
    set({ olderOnServer: true, loadingOlder: true });
    const { rerender } = render(<ListFooter />);
    expect(screen.getByText("Loading older mail")).toBeTruthy();
    set({ loadingOlder: false, olderOnServer: false, serverSearch: "searching" });
    rerender(<ListFooter />);
    expect(screen.getByText("Searching the server…")).toBeTruthy();
  });

  it("stays out of the way while more local pages remain", () => {
    set({ olderOnServer: true, nextCursor: "50" });
    const { container } = render(<ListFooter />);
    expect(container.textContent).toBe("");
  });

  it("offers a server search under search results and reports errors with a retry", () => {
    const searchServer = vi.fn(async () => undefined);
    set({ query: { view: "search", search: "x" }, searchServer });
    const { rerender } = render(<ListFooter />);
    fireEvent.click(screen.getByRole("button", { name: "Search the server" }));
    expect(searchServer).toHaveBeenCalled();
    set({ serverSearch: "error" });
    rerender(<ListFooter />);
    expect(screen.getByText(/Couldn't search the server/)).toBeTruthy();
  });
});
