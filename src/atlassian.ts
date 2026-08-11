export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type QueryValue = string | number | boolean | Array<string | number | boolean>;

export interface AtlassianCredentials {
  siteUrl: string;
  email: string;
  token: string;
}

export interface JiraSearchInput {
  jql: string;
  maxResults?: number;
  fields?: string[];
  nextPageToken?: string;
}

export interface AtlassianService {
  get(path: string, query?: Record<string, QueryValue>): Promise<Json>;
  searchJira(input: JiraSearchInput): Promise<Json>;
}

const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_OUTPUT_LINES = 2000;

export function normalizedSiteUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("ATLASSIAN_SITE_URL must use HTTPS");
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): AtlassianCredentials {
  const token = env.ATLASSIAN_API_TOKEN;
  const email = env.ATLASSIAN_EMAIL;
  const siteUrl = env.ATLASSIAN_SITE_URL;

  if (!token || !email || !siteUrl) {
    throw new Error("Configure ATLASSIAN_API_TOKEN, ATLASSIAN_EMAIL, and ATLASSIAN_SITE_URL");
  }

  return { siteUrl: normalizedSiteUrl(siteUrl), email, token };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatResult(value: Json): string {
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

function siteRelativePath(path: string, query: Record<string, QueryValue> = {}): string {
  const base = "https://atlassian.invalid";
  if (!path.startsWith("/")) throw new Error("Atlassian API path must begin with /");

  const url = new URL(path, base);
  if (url.origin !== base) throw new Error("Atlassian API path must be site-relative");

  for (const [name, rawValue] of Object.entries(query)) {
    url.searchParams.delete(name);
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) url.searchParams.append(name, String(value));
  }

  return `${url.pathname}${url.search}`;
}

export class AtlassianClient implements AtlassianService {
  readonly #env: NodeJS.ProcessEnv;
  readonly #fetch: typeof fetch;

  constructor(options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}) {
    this.#env = options.env ?? process.env;
    this.#fetch = options.fetch ?? fetch;
  }

  async #request(
    path: string,
    options: { method?: string; body?: Json; signal?: AbortSignal } = {},
  ): Promise<Json> {
    const { siteUrl, email, token } = credentialsFromEnv(this.#env);
    const response = await this.#fetch(`${siteUrl}${path}`, {
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

  async get(path: string, query?: Record<string, QueryValue>): Promise<Json> {
    return this.#request(siteRelativePath(path, query));
  }

  searchJira(input: JiraSearchInput): Promise<Json> {
    return this.#request("/rest/api/3/search/jql", {
      method: "POST",
      body: {
        jql: input.jql,
        maxResults: Math.max(1, Math.min(100, input.maxResults ?? 25)),
        ...(input.fields ? { fields: input.fields } : {}),
        ...(input.nextPageToken ? { nextPageToken: input.nextPageToken } : {}),
      },
    });
  }
}
