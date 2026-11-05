import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { listStore } from "../../state/listStore";
import { navStore } from "../../state/nav";
import { ListFooter } from "./ListFooter";

const set = (patch: Partial<ReturnType<typeof listStore.getState>>) => act(() => listStore.setState(patch));
afterEach(() => set({ nextCursor: null, olderOnServer: false, loadingOlder: false, olderError: null, serverSearch: "idle", query: null, loadingMore: false, pageError: null, hiddenIn: [] }));

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
    expect(searchServer).toHaveBeenCalledWith({ explicit: true });
    set({ serverSearch: "done" });
    rerender(<ListFooter />);
    expect(screen.getByRole("button", { name: "Search the server" })).toBeTruthy();
    set({ serverSearch: "error" });
    rerender(<ListFooter />);
    expect(screen.getByText(/Couldn't search the server/)).toBeTruthy();
  });

  it("offers a retry when a later page failed, keeping the rows above", () => {
    const loadMore = vi.fn(async () => undefined);
    set({ pageError: "offline", nextCursor: "50", loadMore });
    render(<ListFooter />);
    expect(screen.getByText("Couldn't load more.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(loadMore).toHaveBeenCalled();
  });

  it("says when matches are in Trash and shows them on click", () => {
    act(() => navStore.setState({ search: "golf club ", searchOpen: true }));
    set({ query: { view: "search", search: "golf club" }, hiddenIn: ["trash"] });
    render(<ListFooter />);
    expect(screen.getByText("Some matches are in Trash")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search the server" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show them" }));
    expect(navStore.getState().search).toBe("golf club in:trash");
  });

  it("offers each folder when matches are in both Trash and Spam, even with no other results", () => {
    act(() => navStore.setState({ search: "tacos", searchOpen: true }));
    set({ query: { view: "search", search: "tacos" }, hiddenIn: ["trash", "spam"] });
    render(<ListFooter empty />);
    expect(screen.getByText("Some matches are in Trash and Spam")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show Spam" }));
    expect(navStore.getState().search).toBe("tacos in:spam");
  });
});
