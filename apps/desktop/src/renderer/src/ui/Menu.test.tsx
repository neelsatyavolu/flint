import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Menu, type MenuItem } from "./Menu";
import { Button } from "./Button";

function setup() {
  const onArchive = vi.fn();
  const onPin = vi.fn();
  const onTrash = vi.fn();
  const items: MenuItem[] = [
    { id: "archive", label: "Archive", shortcut: "e", onSelect: onArchive },
    { id: "pin", label: "Pin", onSelect: onPin },
    { type: "separator" },
    { id: "off", label: "Disabled item", disabled: true, onSelect: vi.fn() },
    { id: "trash", label: "Trash", danger: true, onSelect: onTrash },
  ];
  render(<Menu items={items} trigger={<Button>Actions</Button>} />);
  return { onArchive, onPin, onTrash };
}

/** Opens the menu; the first item is focused on open. */
const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Actions" }));
  const menu = await screen.findByRole("menu");
  await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole("menuitem")[0]));
  return menu;
};
const items = () => screen.getAllByRole("menuitem");

describe("Menu", () => {
  it("opens on click and lists items, skipping separators", async () => {
    setup();
    await open();
    expect(items()).toHaveLength(4);
    expect(items()[0]!.textContent).toContain("Archive");
    expect(items()[3]!.textContent).toBe("Trash");
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("moves focus with arrow keys, skips disabled items and wraps", async () => {
    setup();
    await open();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(items()[1]));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(items()[3])); // Trash; disabled item skipped
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(items()[0])); // wrapped
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    await waitFor(() => expect(document.activeElement).toBe(items()[3]));
  });

  it("supports Home and End", async () => {
    setup();
    await open();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    await waitFor(() => expect(document.activeElement).toBe(items()[3]));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(items()[0]));
  });

  it("jumps by typeahead", async () => {
    setup();
    await open();
    fireEvent.keyDown(document.activeElement!, { key: "t" });
    await waitFor(() => expect(document.activeElement).toBe(items()[3]));
  });

  it("selects with click, runs the action and closes", async () => {
    const { onPin } = setup();
    await open();
    fireEvent.click(items()[1]!);
    expect(onPin).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("selects the focused item with Enter", async () => {
    const { onArchive } = setup();
    await open();
    fireEvent.click(document.activeElement!); // Enter on a focused button fires click
    expect(onArchive).toHaveBeenCalledOnce();
  });

  it("does not run disabled items", async () => {
    setup();
    await open();
    const disabled = items().find((i) => i.textContent === "Disabled item")!;
    expect((disabled as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes on Escape", async () => {
    setup();
    const menu = await open();
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});
