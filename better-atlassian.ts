import type { PluginAPI } from "@ampcode/plugin";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type JiraField = {
  id: string;
  name: string;
  required?: boolean;
  schema?: Json;
  allowedValues?: Json[];
};

type JiraMutation = {
  action: "create" | "edit" | "assign" | "transition";
  issueKey?: string;
  projectKey?: string;
  issueType?: string;
  fields?: Array<{ name: string; value: Json }>;
  assignee?: string;
  targetStatus?: string;
};

type PreparedMutation = {
  preview: Json;
  apply(signal?: AbortSignal): Promise<Json>;
};

const mutationSchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["create", "edit", "assign", "transition"],
      description: "The Jira mutation to perform",
    },
    issueKey: { type: "string", description: "Issue key, such as ENG-123" },
    projectKey: { type: "string", description: "Project key for a new issue" },
    issueType: { type: "string", description: "Issue type display name for a new issue" },
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Jira field display name" },
          value: { description: "Value accepted by Jira for this field" },
        },
        required: ["name", "value"],
      },
      description: "Standard or custom fields identified by display name",
    },
    assignee: {
      type: "string",
      description: "Assignee display name, email, account ID, or 'Unassigned'",
    },
    targetStatus: { type: "string", description: "A directly reachable Jira status" },
  },
  required: ["action"],
} as const;

const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_OUTPUT_LINES = 2000;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function adf(value: string): Json {
  const paragraphs = value.split(/\n{2,}/).map((paragraph) => ({
    type: "paragraph",
    content: paragraph
      ? [{ type: "text", text: paragraph.replace(/\n/g, "\n") }]
      : [],
  }));
  return { type: "doc", version: 1, content: paragraphs };
}

function displayValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(displayValue);
  const object = asObject(value);
  if (Object.keys(object).length === 0) return value;
  return (
    object.displayName ??
    object.name ??
    object.value ??
    object.key ??
    object.id ??
    value
  );
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

  function parseFields(payload: Json): JiraField[] {
    const object = asObject(payload);
    const source = Array.isArray(payload)
      ? payload
      : Array.isArray(object.values)
        ? object.values
        : Object.entries(asObject(object.fields)).map(([id, field]) => ({ id, ...asObject(field) }));

    return source.flatMap((entry) => {
      const field = asObject(entry);
      const id = text(field.id) || text(field.fieldId) || text(field.key);
      const name = text(field.name);
      if (!id || !name) return [];
      return [{
        id,
        name,
        required: field.required === true,
        schema: field.schema as Json | undefined,
        allowedValues: Array.isArray(field.allowedValues) ? field.allowedValues as Json[] : undefined,
      }];
    });
  }

  async function globalFields(signal?: AbortSignal): Promise<JiraField[]> {
    return parseFields(await jira("/field", { signal }));
  }

  async function editFields(issueKey: string, signal?: AbortSignal): Promise<JiraField[]> {
    return parseFields(await jira(`/issue/${encodeURIComponent(issueKey)}/editmeta`, { signal }));
  }

  async function createFields(
    projectKey: string,
    issueTypeName: string,
    signal?: AbortSignal,
  ): Promise<{ issueTypeId: string; fields: JiraField[] }> {
    const project = asObject(await jira(`/project/${encodeURIComponent(projectKey)}`, { signal }));
    const projectId = text(project.id);
    if (!projectId) throw new Error(`Jira project not found: ${projectKey}`);

    const issueTypesPayload = await jira(
      `/issuetype/project?projectId=${encodeURIComponent(projectId)}&level=0`,
      { signal },
    );
    const issueTypes = Array.isArray(issueTypesPayload) ? issueTypesPayload : [];
    const matching = issueTypes.filter(
      (item) => text(asObject(item).name).toLocaleLowerCase() === issueTypeName.toLocaleLowerCase(),
    );
    if (matching.length !== 1) {
      const available = issueTypes.map((item) => text(asObject(item).name)).filter(Boolean);
      throw new Error(
        matching.length > 1
          ? `Issue type name is ambiguous: ${issueTypeName}`
          : `Unknown issue type '${issueTypeName}'. Available: ${available.join(", ")}`,
      );
    }
    const issueTypeId = text(asObject(matching[0]).id);
    const metadata = await jira(
      `/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}?maxResults=100`,
      { signal },
    );
    return { issueTypeId, fields: parseFields(metadata) };
  }

  function resolveField(fieldName: string, available: JiraField[]): JiraField {
    const matches = available.filter(
      (field) => field.name.toLocaleLowerCase() === fieldName.toLocaleLowerCase(),
    );
    if (matches.length === 0) throw new Error(`Unknown or unavailable Jira field: ${fieldName}`);
    if (matches.length > 1) {
      throw new Error(
        `Jira field name '${fieldName}' is ambiguous (${matches.map((field) => field.id).join(", ")})`,
      );
    }
    return matches[0];
  }

  function normalizeAllowedValue(field: JiraField, value: Json): Json {
    if (!field.allowedValues?.length) return field.id === "description" && typeof value === "string" ? adf(value) : value;

    const normalizeOne = (candidate: Json): Json => {
      if (typeof candidate !== "string") return candidate;
      const matches = field.allowedValues!.filter((allowed) => {
        const object = asObject(allowed);
        return [object.id, object.name, object.value, object.key]
          .filter((part) => typeof part === "string")
          .some((part) => (part as string).toLocaleLowerCase() === candidate.toLocaleLowerCase());
      });
      if (matches.length !== 1) {
        const values = field.allowedValues!.map(displayValue);
        throw new Error(
          `Invalid value '${candidate}' for '${field.name}'. Allowed values: ${JSON.stringify(values)}`,
        );
      }
      const selected = asObject(matches[0]);
      return selected.id ? { id: selected.id as Json } : matches[0];
    };

    return Array.isArray(value) ? value.map(normalizeOne) : normalizeOne(value);
  }

  function resolveFields(
    supplied: Array<{ name: string; value: Json }>,
    available: JiraField[],
  ): { apiFields: Record<string, Json>; previewFields: Record<string, Json> } {
    const apiFields: Record<string, Json> = {};
    const previewFields: Record<string, Json> = {};
    for (const item of supplied) {
      const field = resolveField(item.name, available);
      if (field.id in apiFields) throw new Error(`Jira field supplied more than once: ${item.name}`);
      apiFields[field.id] = normalizeAllowedValue(field, item.value);
      previewFields[field.name] = item.value;
    }
    return { apiFields, previewFields };
  }

  async function prepareMutation(operation: JiraMutation, signal?: AbortSignal): Promise<PreparedMutation> {
    if (operation.action === "create") {
      if (!operation.projectKey || !operation.issueType || !operation.fields?.length) {
        throw new Error("create requires projectKey, issueType, and fields");
      }
      const metadata = await createFields(operation.projectKey, operation.issueType, signal);
      const { apiFields, previewFields } = resolveFields(operation.fields, metadata.fields);
      return {
        preview: {
          action: "create",
          project: operation.projectKey,
          issueType: operation.issueType,
          fields: previewFields,
        },
        apply: async (applySignal) => jira("/issue", {
          method: "POST",
          body: {
            fields: {
              project: { key: operation.projectKey! },
              issuetype: { id: metadata.issueTypeId },
              ...apiFields,
            },
          },
          signal: applySignal,
        }),
      };
    }

    if (!operation.issueKey) throw new Error(`${operation.action} requires issueKey`);

    if (operation.action === "edit") {
      if (!operation.fields?.length) throw new Error("edit requires fields");
      const { apiFields, previewFields } = resolveFields(
        operation.fields,
        await editFields(operation.issueKey, signal),
      );
      return {
        preview: { action: "edit", issueKey: operation.issueKey, fields: previewFields },
        apply: async (applySignal) => jira(`/issue/${encodeURIComponent(operation.issueKey!)}`, {
          method: "PUT",
          body: { fields: apiFields },
          signal: applySignal,
        }),
      };
    }

    if (operation.action === "assign") {
      if (!operation.assignee) throw new Error("assign requires assignee");
      let accountId: string | null = null;
      let assigneeName = "Unassigned";
      if (operation.assignee.toLocaleLowerCase() !== "unassigned") {
        const usersPayload = await jira(
          `/user/assignable/search?issueKey=${encodeURIComponent(operation.issueKey)}&query=${encodeURIComponent(operation.assignee)}&maxResults=100`,
          { signal },
        );
        const users = Array.isArray(usersPayload) ? usersPayload.map(asObject) : [];
        const exact = users.filter((user) =>
          [user.accountId, user.emailAddress, user.displayName]
            .filter((part) => typeof part === "string")
            .some((part) => (part as string).toLocaleLowerCase() === operation.assignee!.toLocaleLowerCase()),
        );
        if (exact.length !== 1) {
          throw new Error(
            exact.length > 1
              ? `Assignee '${operation.assignee}' is ambiguous`
              : `No exact assignable user found for '${operation.assignee}'. Matches: ${users.map((user) => user.displayName).filter(Boolean).join(", ")}`,
          );
        }
        accountId = text(exact[0].accountId);
        assigneeName = text(exact[0].displayName) || operation.assignee;
      }
      return {
        preview: { action: "assign", issueKey: operation.issueKey, assignee: assigneeName },
        apply: async (applySignal) => jira(`/issue/${encodeURIComponent(operation.issueKey!)}/assignee`, {
          method: "PUT",
          body: { accountId },
          signal: applySignal,
        }),
      };
    }

    if (!operation.targetStatus) throw new Error("transition requires targetStatus");
    const transitionsPayload = asObject(await jira(
      `/issue/${encodeURIComponent(operation.issueKey)}/transitions`,
      { signal },
    ));
    const transitions = Array.isArray(transitionsPayload.transitions)
      ? transitionsPayload.transitions.map(asObject)
      : [];
    const matches = transitions.filter(
      (transition) => text(asObject(transition.to).name).toLocaleLowerCase() === operation.targetStatus!.toLocaleLowerCase(),
    );
    if (matches.length !== 1) {
      const available = transitions.map((transition) => text(asObject(transition.to).name)).filter(Boolean);
      throw new Error(
        matches.length > 1
          ? `Several direct transitions lead to '${operation.targetStatus}'`
          : `No direct transition to '${operation.targetStatus}'. Available: ${available.join(", ")}`,
      );
    }
    const transitionId = text(matches[0].id);
    return {
      preview: { action: "transition", issueKey: operation.issueKey, targetStatus: operation.targetStatus },
      apply: async (applySignal) => jira(`/issue/${encodeURIComponent(operation.issueKey!)}/transitions`, {
        method: "POST",
        body: { transition: { id: transitionId } },
        signal: applySignal,
      }),
    };
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

  amp.registerTool({
    name: "jira_apply",
    description: "Create, edit, assign, or directly transition Jira issues. Put all requested Jira changes into one operations batch. Use Jira field display names and inspect metadata with atlassian_get when values are uncertain. The tool preflights the entire batch, asks the user once, then executes in order and stops on the first failure.",
    inputSchema: {
      type: "object",
      properties: {
        operations: {
          type: "array",
          items: mutationSchema,
          minItems: 1,
          description: "Ordered Jira mutation batch",
        },
      },
      required: ["operations"],
    },
    async execute(input, ctx) {
      const params = input as { operations: JiraMutation[] };

      const prepared: PreparedMutation[] = [];
      for (const operation of params.operations as JiraMutation[]) {
        prepared.push(await prepareMutation(operation));
      }

      const preview = prepared.map((item, index) => ({ number: index + 1, ...asObject(item.preview) }));
      let approved: boolean;
      try {
        approved = await ctx.ui.confirm({
          title: `Apply ${prepared.length} Jira change${prepared.length === 1 ? "" : "s"}?`,
          message: formatResult(preview as Json),
          confirmButtonText: "Apply",
        });
      } catch (error) {
        if (error instanceof Error && amp.helpers.isPluginUINotAvailableError(error)) {
          throw new Error("Jira writes require Amp confirmation UI");
        }
        throw error;
      }
      if (!approved) return result({ applied: 0, rejected: true });

      const completed: Json[] = [];
      for (let index = 0; index < prepared.length; index += 1) {
        try {
          const response = await prepared[index].apply();
          completed.push({ operation: index + 1, preview: prepared[index].preview, response });
        } catch (error) {
          throw new Error(
            `Jira batch stopped at operation ${index + 1}; ${completed.length} earlier operation(s) succeeded. ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return result({ applied: completed.length, completed });
    },
  });

}
