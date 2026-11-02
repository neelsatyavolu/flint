import type { FlintApi } from "@flint/core/api";
import { FlintError, type ConnectorConnection, type ConnectorManifest, type ConnectorPreview } from "@flint/core/types";
import type { MockState } from "./state";

/** Browser demo only: constructs a sample manifest without contacting the entered host. */
export function mockConnectorApi(state: MockState, now: () => number): Pick<FlintApi,
  "listConnectors" | "previewConnector" | "openConnectorPairPage" | "pairConnector" | "previewConnectorApproval" | "approveConnector" | "removeConnector"> {
  const connections = new Map<string, ConnectorConnection>();
  const previews = new Map<string, { preview: ConnectorPreview; connectionId?: string }>();
  const opened = new Set<string>();
  const previewFor = (manifestUrl: string, manifest: ConnectorManifest, connectionId?: string) => {
    const messages = state.threads.filter((thread) => !["spam", "trash", "sent", "drafts"].includes(thread.location))
      .flatMap((thread) => thread.messages).filter((message) => !message.isFromMe && message.date >= now() - manifest.historyDays * 86_400_000 && /invoice/i.test(message.subject));
    const preview: ConnectorPreview = { token: crypto.randomUUID(), manifestUrl, manifest: structuredClone(manifest), count: messages.length, subjects: messages.slice(0, 5).map((message) => message.subject) };
    previews.set(preview.token, { preview, connectionId });
    return structuredClone(preview);
  };
  const getPreview = (token: string) => {
    const entry = previews.get(token);
    if (!entry) throw new FlintError("invalid", "Review the app's permissions again.");
    return entry;
  };
  const getConnection = (id: string) => {
    const connection = connections.get(id);
    if (!connection) throw new FlintError("not_found", "That connection no longer exists.");
    return connection;
  };
  return {
    async listConnectors() { return structuredClone([...connections.values()]); },
    async previewConnector(input) {
      let url: URL;
      try { url = new URL(input); } catch { throw new FlintError("invalid", "Enter the app's HTTPS URL."); }
      if (url.protocol !== "https:" || url.username || url.password) throw new FlintError("invalid", "Enter the app's HTTPS URL.");
      const manifestUrl = url.pathname === "/" ? `${url.origin}/.well-known/flint-connector.json` : url.href;
      return previewFor(manifestUrl, {
        flintConnector: 1, id: `example.${url.hostname}`, name: "Example organizer", description: "Demo app that organizes invoices. No mail leaves the browser preview. Use any 8-character code to try pairing.",
        homepage: url.origin, pairPage: `${url.origin}/connect`, pairEndpoint: `${url.origin}/pair`, deliverEndpoint: `${url.origin}/deliver`, revokeEndpoint: `${url.origin}/revoke`,
        match: { any: [{ field: "subject", op: "contains", value: "invoice" }], schemaTypes: [] },
        fields: ["messageId", "from", "subject", "date", "text"], historyDays: 365,
      });
    },
    async openConnectorPairPage(token) { getPreview(token); opened.add(token); },
    async pairConnector(token, code) {
      const { preview, connectionId } = getPreview(token);
      if (connectionId || !opened.has(token)) throw new FlintError("invalid", "Open the app to get a code first.");
      if (code.trim().length !== 8) throw new FlintError("invalid", "Enter the 8-character code from the app.");
      const connection: ConnectorConnection = {
        id: crypto.randomUUID(), manifestUrl: preview.manifestUrl, manifest: preview.manifest, status: "active", pendingManifest: null,
        deliveredCount: preview.count, lastDelivery: preview.count ? now() : null,
      };
      connections.set(connection.id, connection);
      previews.delete(token);
      opened.delete(token);
      return structuredClone(connection);
    },
    async previewConnectorApproval(id) {
      const connection = getConnection(id);
      if (!connection.pendingManifest) throw new FlintError("invalid", "This app does not need approval.");
      return previewFor(connection.manifestUrl, connection.pendingManifest, id);
    },
    async approveConnector(id, token) {
      const connection = getConnection(id);
      const entry = getPreview(token);
      if (entry.connectionId !== id) throw new FlintError("invalid", "Review this app's permissions again.");
      connection.manifest = entry.preview.manifest;
      connection.pendingManifest = null;
      connection.status = "active";
      previews.delete(token);
    },
    async removeConnector(id) { connections.delete(id); },
  };
}
