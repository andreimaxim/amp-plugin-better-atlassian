import type { PluginAPI } from "@ampcode/plugin";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_OUTPUT_LINES = 2000;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizedSiteUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("ATLASSIAN_SITE_URL must use HTTPS");
  return url.origin + url.pathname.replace(/\/+$/, "");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatResult(value: Json): string {
  const output = JSON.stringify(value, null, 2);
  const allLines = output.split("\n");
  const totalBytes = Buffer.byteLength(output);
  if (allLines.length <= MAX_OUTPUT_LINES && totalBytes <= MAX_OUTPUT_BYTES) return output;

  const lineLimited = allLines.slice(0, MAX_OUTPUT_LINES).join("\n");
  const encoded = new TextEncoder().encode(lineLimited);
  let end = Math.min(encoded.length, MAX_OUTPUT_BYTES);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let content = "";
  while (!content) {
    try {
      content = decoder.decode(encoded.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  const outputLines = content.split("\n").length;
  return `${content}\n\n[Output truncated: ${outputLines} of ${allLines.length} lines (${formatSize(end)} of ${formatSize(totalBytes)}).]`;
}

export default function atlassianPlugin(amp: PluginAPI) {
  async function credentials(): Promise<{ siteUrl: string; email: string; token: string }> {
    const config = await amp.configuration.get();
    const token = process.env.ATLASSIAN_API_TOKEN ?? text(config["atlassian.apiToken"]);
    const email = process.env.ATLASSIAN_EMAIL ?? text(config["atlassian.email"]);
    const siteUrl = process.env.ATLASSIAN_SITE_URL ?? text(config["atlassian.siteUrl"]);

    if (!token || !email || !siteUrl) {
      throw new Error(
        "Configure ATLASSIAN_API_TOKEN, ATLASSIAN_EMAIL, and ATLASSIAN_SITE_URL, or the Amp settings amp.atlassian.apiToken, amp.atlassian.email, and amp.atlassian.siteUrl",
      );
    }
    return { siteUrl: normalizedSiteUrl(siteUrl), email, token };
  }

  async function request(
    path: string,
    options: { method?: string; body?: Json; signal?: AbortSignal } = {},
  ): Promise<Json> {
    const { siteUrl, email, token } = await credentials();
    const response = await fetch(`${siteUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });

    const raw = await response.text();
    let body: Json = null;
    if (raw) {
      try {
        body = JSON.parse(raw) as Json;
      } catch {
        body = raw;
      }
    }
    if (!response.ok) {
      throw new Error(
        `Atlassian API ${response.status} ${response.statusText}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
      );
    }
    return body;
  }

  function jira(path: string, options?: { method?: string; body?: Json; signal?: AbortSignal }) {
    return request(`/rest/api/3${path}`, options);
  }

  function result(value: Json) {
    return formatResult(value);
  }

  amp.registerTool({
    name: "atlassian_get",
    description: "Make one authenticated GET request to a site-relative Jira or Confluence API path. This tool is read-only and may truncate large output.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Site-relative API path beginning with /, for example /rest/api/3/issue/ENG-123 or /wiki/api/v2/pages/123",
        },
        query: {
          type: "object",
          description: "Optional query parameters. Array values are encoded as repeated parameters.",
          additionalProperties: {
            oneOf: [
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
              { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } },
            ],
          },
        },
      },
      required: ["path"],
    },
    async execute(input) {
      const params = input as {
        path: string;
        query?: Record<string, string | number | boolean | Array<string | number | boolean>>;
      };
      const base = "https://atlassian.invalid";
      if (!params.path.startsWith("/")) throw new Error("Atlassian API path must begin with /");
      const url = new URL(params.path, base);
      if (url.origin !== base) throw new Error("Atlassian API path must be site-relative");
      for (const [name, rawValue] of Object.entries(params.query ?? {})) {
        url.searchParams.delete(name);
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        for (const value of values) url.searchParams.append(name, String(value));
      }
      return result(await request(`${url.pathname}${url.search}`));
    },
  });

  amp.registerTool({
    name: "jira_search",
    description: "Search Jira issues using POST /rest/api/3/search/jql. This is the only read-only POST exposed by the plugin. Returns Jira's raw response and may truncate large output.",
    inputSchema: {
      type: "object",
      properties: {
        jql: { type: "string", description: "A Jira Query Language expression" },
        maxResults: { type: "number", minimum: 1, maximum: 100, default: 25 },
        fields: {
          type: "array",
          items: { type: "string" },
          description: "Fields to include. Omit to use Jira's defaults.",
        },
        nextPageToken: { type: "string", description: "Token returned by a previous search page" },
      },
      required: ["jql"],
    },
    async execute(input) {
      const params = input as { jql: string; maxResults?: number; fields?: string[]; nextPageToken?: string };
      return result(await jira("/search/jql", {
        method: "POST",
        body: {
          jql: params.jql,
          maxResults: Math.max(1, Math.min(100, params.maxResults ?? 25)),
          ...(params.fields ? { fields: params.fields } : {}),
          ...(params.nextPageToken ? { nextPageToken: params.nextPageToken } : {}),
        },
      }));
    },
  });
}
