import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  AtlassianClient,
  formatResult,
  type AtlassianService,
} from "./atlassian.js";

const primitiveQueryValue = z.union([z.string(), z.number(), z.boolean()]);
const queryValue = z.union([primitiveQueryValue, z.array(primitiveQueryValue)]);

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

function textResult(value: Awaited<ReturnType<AtlassianService["get"]>>) {
  return {
    content: [{ type: "text" as const, text: formatResult(value) }],
  };
}

export function createServer(service: AtlassianService = new AtlassianClient()): McpServer {
  const server = new McpServer({
    name: "better-atlassian",
    version: "0.1.0",
  });

  server.registerTool(
    "atlassian_get",
    {
      title: "Get Atlassian data",
      description: "Make one authenticated GET request to a site-relative Jira or Confluence API path. This tool is read-only and may truncate large output.",
      inputSchema: z.object({
        path: z.string().describe("Site-relative API path beginning with /, for example /rest/api/3/issue/ENG-123 or /wiki/api/v2/pages/123"),
        query: z.record(z.string(), queryValue).optional().describe("Optional query parameters. Array values are encoded as repeated parameters."),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ path, query }) => textResult(await service.get(path, query)),
  );

  server.registerTool(
    "jira_search",
    {
      title: "Search Jira issues",
      description: "Search Jira issues using POST /rest/api/3/search/jql. This is the only read-only POST exposed by the server. Returns Jira's raw response and may truncate large output.",
      inputSchema: z.object({
        jql: z.string().describe("A Jira Query Language expression"),
        maxResults: z.number().int().min(1).max(100).default(25),
        fields: z.array(z.string()).optional().describe("Fields to include. Omit to use Jira's defaults."),
        nextPageToken: z.string().optional().describe("Token returned by a previous search page"),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ jql, maxResults, fields, nextPageToken }) => textResult(await service.searchJira({
      jql,
      maxResults,
      fields,
      nextPageToken,
    })),
  );

  return server;
}
