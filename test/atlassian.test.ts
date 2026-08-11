import { describe, expect, it, vi } from "vitest";

import {
  AtlassianClient,
  credentialsFromEnv,
  formatResult,
} from "../src/atlassian.js";

const env = {
  ATLASSIAN_SITE_URL: "https://example.atlassian.net/",
  ATLASSIAN_EMAIL: "user@example.com",
  ATLASSIAN_API_TOKEN: "secret",
};

describe("AtlassianClient", () => {
  it("builds authenticated GET requests with repeated query values", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "123" }), {
      headers: { "Content-Type": "application/json" },
    }));
    const client = new AtlassianClient({ env, fetch: fetchMock });

    await client.get("/wiki/api/v2/pages/123?body-format=view", {
      "body-format": "storage",
      status: ["current", "archived"],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.atlassian.net/wiki/api/v2/pages/123?body-format=storage&status=current&status=archived",
      expect.objectContaining({
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from("user@example.com:secret").toString("base64")}`,
        },
      }),
    );
  });

  it("rejects absolute and protocol-relative request paths", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new AtlassianClient({ env, fetch: fetchMock });

    await expect(client.get("https://attacker.invalid/rest/api/3/myself")).rejects.toThrow("must begin with /");
    await expect(client.get("//attacker.invalid/rest/api/3/myself")).rejects.toThrow("must be site-relative");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts bounded Jira searches to the one allowed POST endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ issues: [] })));
    const client = new AtlassianClient({ env, fetch: fetchMock });

    await client.searchJira({
      jql: "project = ENG",
      maxResults: 1000,
      fields: ["summary", "status"],
      nextPageToken: "next",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.atlassian.net/rest/api/3/search/jql",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          jql: "project = ENG",
          maxResults: 100,
          fields: ["summary", "status"],
          nextPageToken: "next",
        }),
      }),
    );
  });

  it("surfaces Atlassian API errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ errorMessages: ["No issue"] }), {
      status: 404,
      statusText: "Not Found",
    }));
    const client = new AtlassianClient({ env, fetch: fetchMock });

    await expect(client.get("/rest/api/3/issue/NOPE-1")).rejects.toThrow(
      'Atlassian API 404 Not Found: {"errorMessages":["No issue"]}',
    );
  });
});

describe("configuration and output", () => {
  it("requires all three credentials and HTTPS", () => {
    expect(() => credentialsFromEnv({})).toThrow("Configure ATLASSIAN_API_TOKEN");
    expect(() => credentialsFromEnv({ ...env, ATLASSIAN_SITE_URL: "http://example.atlassian.net" }))
      .toThrow("must use HTTPS");
  });

  it("truncates large output without splitting UTF-8", () => {
    const output = formatResult({ value: "🎫".repeat(20_000) });

    expect(Buffer.byteLength(output)).toBeLessThan(52 * 1024);
    expect(output).toContain("[Output truncated:");
    expect(output).not.toContain("�");
  });
});
