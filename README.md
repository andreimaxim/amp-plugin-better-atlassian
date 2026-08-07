# Better Atlassian for Amp

An [Amp](https://ampcode.com) plugin for common interactions with Jira and Confluence.

## How it works

The plugin aims to be minimal and allows the model to perform non-destructive actions, while requiring confirmation before
performing destructive actions.

The plugin exposes the following custom tools:

* `atlassian_get`, which performs authenticated `GET` requests to any Atlassian endpoint (Jira or Confluence)
* `jira_search`, which performs an authenticated `POST` request to the JQL endpoint
* `jira_apply`, which creates or updates Jira issues and requires user confirmation

## Other agents

This integration deliberately uses a small HTTP client and a focused skill instead of depending on an official Atlassian MCP server or CLI. That keeps the tool surface limited to common Jira and Confluence workflows, reduces API discovery, and makes the behavior easy for each user to customize. Official MCPs, CLIs, and API clients can still serve as canonical references when implementing the limited feature set.

Pass this prompt to an agent harness such as Claude Code or Codex:

```text
Build a native plugin for your agent harness equivalent to this Better Atlassian plugin for Amp:

https://github.com/andreimaxim/amp-plugin-better-atlassian

Read its source code, README, and `using-jira` skill. Reimplement it using your harness's native plugin conventions.

Do not wrap or depend on an official Atlassian MCP server or CLI. Build a small HTTP client that inserts the Atlassian site URL and authentication credentials automatically, expose only the tools and operations in the Amp plugin, and port the skill describing common Jira workflows with sample payloads. Official MCPs, CLIs, and API clients may be consulted as canonical references, but they should not become runtime dependencies.

The Amp implementation reads the site URL, email, and API token from `ATLASSIAN_SITE_URL`, `ATLASSIAN_EMAIL`, and `ATLASSIAN_API_TOKEN`, or from user-level settings such as `amp.atlassian.siteUrl`, with environment variables taking precedence. Translate these mechanisms into the closest secure, user-level equivalents offered by your harness.

For context, Amp plugins are TypeScript modules that register tools through `amp.registerTool(...)`, read user configuration through `amp.configuration.get()`, and can include skills under `.agents/skills/`. This plugin also uses Amp's confirmation UI before applying Jira mutations. The detailed Amp plugin API is documented at https://ampcode.com/manual/plugin-api.

Preserve the original implementation's bounded output, read operations, JQL search, field and allowed-value resolution, mutation preflight, single confirmation step, ordered application, failure behavior, and skill guidance. Add concise setup documentation and appropriate tests, then validate it using your harness's native plugin workflow.
```

## Configuration

Edit `~/.config/amp/settings.json` and add the following values:

```json
{
  "amp.atlassian.siteUrl": "https://your-company.atlassian.net",
  "amp.atlassian.email": "you@example.com",
  "amp.atlassian.apiToken": "your-api-token"
}
```
