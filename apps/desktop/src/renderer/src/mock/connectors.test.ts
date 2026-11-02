import { describe, expect, it } from "vitest";
import { createMockApi } from "./api";

describe("mock connected apps", () => {
  it("supports preview, pairing and removal without network calls", async () => {
    const api = createMockApi();
    const preview = await api.previewConnector("https://organizer.example");
    expect(preview.manifestUrl).toBe("https://organizer.example/.well-known/flint-connector.json");
    expect(preview.subjects.length).toBeLessThanOrEqual(5);
    await expect(api.pairConnector(preview.token, "ABCD1234")).rejects.toThrow(/Open the app/);
    await api.openConnectorPairPage(preview.token);
    await expect(api.pairConnector(preview.token, "123")).rejects.toThrow(/8-character/);
    const connection = await api.pairConnector(preview.token, "ABCD1234");
    expect((await api.listConnectors())[0]?.id).toBe(connection.id);
    await expect(api.pairConnector(preview.token, "ABCD1234")).rejects.toThrow(/Review/);
    await api.removeConnector(connection.id);
    expect(await api.listConnectors()).toEqual([]);
  });

  it("rejects insecure URLs and accepts a manifest URL", async () => {
    const api = createMockApi();
    await expect(api.previewConnector("http://organizer.example")).rejects.toThrow(/HTTPS/);
    const url = "https://organizer.example/custom-manifest.json";
    expect((await api.previewConnector(url)).manifestUrl).toBe(url);
  });
});
