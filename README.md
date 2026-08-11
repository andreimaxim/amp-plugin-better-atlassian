# Better Atlassian MCP

A focused, read-only [Model Context Protocol](https://modelcontextprotocol.io/) server for Jira and Confluence Cloud. It works with Amp, Claude Code, Codex, and other clients that support local stdio MCP servers.

## Tools

The server deliberately exposes only two tools:

- `atlassian_get` performs one authenticated `GET` request to a site-relative Jira or Confluence API path.
- `jira_search` performs an authenticated `POST` to Jira's read-only `/rest/api/3/search/jql` endpoint.

It does not expose create, edit, assignment, transition, or deletion operations. Tool output is limited to 2,000 lines or 50 KB.

## Requirements

- Node.js 20 or newer
- An Atlassian Cloud API token

Configure the process that runs your MCP client with these environment variables:

```bash
export ATLASSIAN_SITE_URL="https://your-company.atlassian.net"
export ATLASSIAN_EMAIL="you@example.com"
export ATLASSIAN_API_TOKEN="your-api-token"
```

`ATLASSIAN_SITE_URL` must use HTTPS. Treat `ATLASSIAN_API_TOKEN` as a secret and do not commit it to an MCP configuration file.

Run the published package through an MCP client:

```bash
npx -y @andreimaxim/better-atlassian-mcp
```

It communicates over standard input and output, so running it directly appears to do nothing while it waits for an MCP client.

## Amp

The distributable [`using-jira` skill](skill/using-jira/SKILL.md) includes the MCP launch configuration and exposes only `atlassian_get` and `jira_search`. Install that directory as a project, personal, or workspace skill.

For a project skill, copy it into the repository:

```text
.agents/skills/using-jira/SKILL.md
```

For an orb, add the three `ATLASSIAN_*` values under personal, project, or workspace **Secrets & Env Vars**. Store the API token as a secret. Amp starts the MCP server in the orb when it discovers the skill and reveals its tools only when the skill loads.

The previous `amp.atlassian.*` plugin settings are no longer read; the portable MCP server uses environment variables in every harness.

## Claude Code

Register the same stdio server at user scope:

```bash
claude mcp add --scope user --transport stdio better-atlassian -- \
  npx -y @andreimaxim/better-atlassian-mcp
```

Start Claude Code with the three `ATLASSIAN_*` variables available in its environment. For team distribution, put the equivalent server entry in the project's `.mcp.json` and keep credentials as environment-variable references.

## Codex

Add this entry to `~/.codex/config.toml`, or to `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.better-atlassian]
command = "npx"
args = ["-y", "@andreimaxim/better-atlassian-mcp"]
env_vars = [
  "ATLASSIAN_SITE_URL",
  "ATLASSIAN_EMAIL",
  "ATLASSIAN_API_TOKEN",
]
enabled_tools = ["atlassian_get", "jira_search"]
```

The `env_vars` list forwards existing variables without placing their values in the configuration file.

## Development

```bash
npm install
npm run check
npm pack --dry-run
```

Repository layout:

- `src/atlassian.ts` contains credential handling, request validation, the Atlassian HTTP client, and bounded output formatting.
- `src/server.ts` registers the MCP tools and their read-only annotations.
- `src/index.ts` starts the stdio server.
- `skill/using-jira/SKILL.md` contains the Amp skill and its MCP launch configuration.
- `test/` contains HTTP-client and protocol-level integration tests.
