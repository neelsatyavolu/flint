import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateSettings = vi.fn(async () => ({}));
vi.mock("../../lib/api", () => ({ flint: { updateSettings: (...a: unknown[]) => updateSettings(...(a as [])) } }));
vi.mock("../../lib/host", () => ({ openExternal: vi.fn() }));

import { GoogleSetupPanel } from "./GoogleSetupPanel";
import { SAVED_SECRET_MASK } from "./googleSetup";

const ID = "123-abc.apps.googleusercontent.com";

describe("GoogleSetupPanel", () => {
  beforeEach(() => updateSettings.mockClear());

  it("keeps a saved secret without sending the mask back", async () => {
    const onSaved = vi.fn();
    render(<GoogleSetupPanel initialId={ID} initialSecret={SAVED_SECRET_MASK} onSaved={onSaved} />);
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.queryByLabelText("Client secret")).toBeNull();
    fireEvent.click(screen.getByText("Save and continue"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateSettings).toHaveBeenCalledWith({ google: { clientId: ID } });
  });

  it("replaces a saved secret when asked", async () => {
    render(<GoogleSetupPanel initialId={ID} initialSecret={SAVED_SECRET_MASK} onSaved={() => {}} />);
    fireEvent.click(screen.getByText("Replace"));
    fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: "GOCSPX-new" } });
    fireEvent.click(screen.getByText("Save and continue"));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ google: { clientId: ID, clientSecret: "GOCSPX-new" } }));
  });
});
