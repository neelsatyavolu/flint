import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ConnectorConnection, ConnectorPreview } from "@flint/core/types";
import { flint } from "../../../lib/api";
import { ConnectedAppsSection } from "./ConnectedAppsSection";

const preview: ConnectorPreview = {
  token: "consent-token", manifestUrl: "https://organizer.example/.well-known/flint-connector.json", count: 12, subjects: ["Your invoice", "Receipt for your purchase"],
  manifest: {
    flintConnector: 1, id: "example.organizer", name: "Organizer", description: "Organizes invoices.", homepage: "https://organizer.example",
    pairPage: "https://organizer.example/connect", pairEndpoint: "https://organizer.example/pair", deliverEndpoint: "https://organizer.example/deliver", revokeEndpoint: "https://organizer.example/revoke",
    match: { any: [{ field: "subject", op: "contains", value: "invoice" }], schemaTypes: ["Invoice"] }, fields: ["messageId", "subject", "text"], historyDays: 365,
  },
};
const connection: ConnectorConnection = { id: "connection-1", manifestUrl: preview.manifestUrl, manifest: preview.manifest, status: "active", pendingManifest: null, lastDelivery: null, deliveredCount: 0 };

beforeEach(() => {
  vi.spyOn(flint, "listConnectors").mockResolvedValue([]);
  vi.spyOn(flint, "previewConnector").mockResolvedValue(preview);
  vi.spyOn(flint, "openConnectorPairPage").mockResolvedValue();
  vi.spyOn(flint, "pairConnector").mockResolvedValue(connection);
  vi.spyOn(flint, "previewConnectorApproval").mockResolvedValue(preview);
  vi.spyOn(flint, "approveConnector").mockResolvedValue();
  vi.spyOn(flint, "removeConnector").mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());

describe("Connected apps", () => {
  it("shows the consent preview before opening the app and pairing with a code", async () => {
    render(<ConnectedAppsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Add app" }));
    fireEvent.change(screen.getByLabelText("App URL"), { target: { value: "https://organizer.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Review permissions" }));
    expect(await screen.findByText("12 messages from the last 365 days would be sent.")).toBeTruthy();
    expect(screen.getByText("organizer.example")).toBeTruthy();
    expect(screen.getByText("Message ID, Subject, Plain-text body")).toBeTruthy();
    expect(screen.getByText("Subject contains “invoice”")).toBeTruthy();
    expect(screen.getByText("Contains structured email data of type Invoice")).toBeTruthy();
    expect(screen.getByText("Your invoice")).toBeTruthy();
    expect(flint.openConnectorPairPage).not.toHaveBeenCalled();
    expect(flint.pairConnector).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open Organizer to get a code" }));
    const field = await screen.findByLabelText("8-character code");
    expect(flint.openConnectorPairPage).toHaveBeenCalledWith(preview.token);
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(true);
    expect((field as HTMLInputElement).maxLength).toBe(12);
    fireEvent.change(field, { target: { value: "ABCD-EF!" } });
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: "ABCD-EFGH" } });
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(false);
    vi.mocked(flint.listConnectors).mockResolvedValue([connection]);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(flint.pairConnector).toHaveBeenCalledWith(preview.token, "ABCD-EFGH"));
    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("re-approves pending permissions without making another pairing request", async () => {
    vi.mocked(flint.listConnectors).mockResolvedValue([{ ...connection, status: "needs_approval", pendingManifest: preview.manifest }]);
    render(<ConnectedAppsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Re-approve" }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText("12 messages from the last 365 days would be sent.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve and resume" }));
    await waitFor(() => expect(flint.approveConnector).toHaveBeenCalledWith(connection.id, preview.token));
    expect(flint.pairConnector).not.toHaveBeenCalled();
  });

  it("keeps a failed removal visible and supports retry", async () => {
    vi.mocked(flint.listConnectors).mockResolvedValue([connection]);
    vi.mocked(flint.removeConnector).mockRejectedValueOnce(new Error("Could not reach the app."));
    render(<ConnectedAppsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Organizer" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not reach the app.");
    expect(screen.getByText("Connected")).toBeTruthy();
    vi.mocked(flint.listConnectors).mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Organizer" }));
    expect(await screen.findByText("No apps connected yet.")).toBeTruthy();
  });
});
