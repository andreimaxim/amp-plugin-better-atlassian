import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AtlassianService } from "../src/atlassian.js";
import { createServer } from "../src/server.js";

describe("Better Atlassian MCP server", () => {
  let client: Client | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  async function connect(service: AtlassianService): Promise<Client> {
    server = createServer(service);
    client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return client;
  }

  it("exposes only the two read-only tools", async () => {
    const connected = await connect({
      get: vi.fn(),
      searchJira: vi.fn(),
    });

    const { tools } = await connected.listTools();

    expect(tools.map(({ name }) => name)).toEqual(["atlassian_get", "jira_search"]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
    }
  });

  it("routes Atlassian GET calls to the service", async () => {
    const get = vi.fn().mockResolvedValue({ id: "123", title: "Example" });
    const connected = await connect({ get, searchJira: vi.fn() });

    const result = await connected.callTool({
      name: "atlassian_get",
      arguments: {
        path: "/wiki/api/v2/pages/123",
        query: { "body-format": "storage" },
      },
    });

    expect(get).toHaveBeenCalledWith("/wiki/api/v2/pages/123", { "body-format": "storage" });
    expect(result.content).toEqual([{
      type: "text",
      text: JSON.stringify({ id: "123", title: "Example" }, null, 2),
    }]);
  });

  it("applies Jira search defaults before calling the service", async () => {
    const searchJira = vi.fn().mockResolvedValue({ issues: [] });
    const connected = await connect({ get: vi.fn(), searchJira });

    await connected.callTool({
      name: "jira_search",
      arguments: { jql: "project = ENG" },
    });

    expect(searchJira).toHaveBeenCalledWith({
      jql: "project = ENG",
      maxResults: 25,
      fields: undefined,
      nextPageToken: undefined,
    });
  });

  it("rejects invalid tool arguments before calling the service", async () => {
    const searchJira = vi.fn();
    const connected = await connect({ get: vi.fn(), searchJira });

    const result = await connected.callTool({
      name: "jira_search",
      arguments: { jql: "project = ENG", maxResults: 101 },
    });

    expect(result.isError).toBe(true);
    expect(searchJira).not.toHaveBeenCalled();
  });
});
