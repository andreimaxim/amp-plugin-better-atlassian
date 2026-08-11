---
name: using-jira
description: Queries Jira issues through the read-only Better Atlassian MCP server. Use when requests mention Jira, tickets, issues, JQL, projects, assignees, statuses, transitions, or Jira fields.
mcpServers:
  better-atlassian:
    command: npx
    args: ["-y", "@andreimaxim/better-atlassian-mcp"]
    env:
      ATLASSIAN_SITE_URL: "${ATLASSIAN_SITE_URL}"
      ATLASSIAN_EMAIL: "${ATLASSIAN_EMAIL}"
      ATLASSIAN_API_TOKEN: "${ATLASSIAN_API_TOKEN}"
    includeTools: ["atlassian_get", "jira_search"]
---

# Using Jira

Use the Better Atlassian MCP tools instead of Git when the request is about Jira tickets or Jira work.

## Choose the tool

- Use `jira_search` for JQL. It is the only read-only POST endpoint and returns Jira's raw search response.
- Use `atlassian_get` for every other read. Jira Cloud v3 paths begin with `/rest/api/3/`.
- Writes are not supported. Never attempt mutations through `atlassian_get` or `jira_search`.

## Search with JQL

Keep searches bounded because Jira rejects unbounded JQL in some installations. Request only fields needed for the answer.

Examples:

- Most recently updated ticket assigned to the current user:
  - JQL: `assignee = currentUser() AND updated >= -365d ORDER BY updated DESC`
  - `maxResults`: `1`
  - `fields`: `["summary", "status", "assignee", "updated"]`
- Current user's unresolved work:
  - JQL: `assignee = currentUser() AND resolution IS EMPTY AND updated >= -365d ORDER BY priority DESC, updated DESC`
- Recently changed project work:
  - JQL: `project = FWS AND updated >= -30d ORDER BY updated DESC`

When asked for “the last ticket I worked on,” explain that Jira search can identify the most recently updated ticket assigned to the user, but does not prove who made the latest update. Use changelog or worklog data if the user specifically means their own recorded activity.

Pass `nextPageToken` from a response into the next `jira_search` call when another page is needed.

## Common GET requests

Call `atlassian_get` with these site-relative paths:

- Issue: `/rest/api/3/issue/{issueKey}` with query `fields: "summary,status,assignee,description,updated"`
- Issue changelog: `/rest/api/3/issue/{issueKey}/changelog`
- Available transitions: `/rest/api/3/issue/{issueKey}/transitions`
- All fields: `/rest/api/3/field`
- Fields editable on an issue: `/rest/api/3/issue/{issueKey}/editmeta`
- Project: `/rest/api/3/project/{projectKey}`
- Project issue types: `/rest/api/3/issuetype/project` with `projectId` and `level: 0`
- Assignable users: `/rest/api/3/user/assignable/search` with `issueKey`, `query`, and a bounded `maxResults`
- Current user: `/rest/api/3/myself`

Use the response's pagination token, cursor, `startAt`, or `_links.next` according to that endpoint. Make one GET per tool call.

If asked to create, edit, assign, or transition a Jira issue, explain that the MCP server is read-only and cannot perform the change.
