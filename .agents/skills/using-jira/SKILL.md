---
name: using-jira
description: Queries and updates Jira issues through the Atlassian plugin. Use when requests mention Jira, tickets, issues, JQL, projects, assignees, statuses, transitions, or Jira fields.
---

# Using Jira

Use the Atlassian plugin instead of Git when the request is about Jira tickets or Jira work.

## Choose the tool

- Use `jira_search` for JQL. It is the only read-only POST endpoint and returns Jira's raw search response.
- Use `atlassian_get` for every other read. Jira Cloud v3 paths begin with `/rest/api/3/`.
- Use `jira_apply` for all writes. Never attempt writes through `atlassian_get`.

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

## Apply changes

Put all requested writes into one `jira_apply.operations` batch. Operations support `create`, `edit`, `assign`, and directly reachable `transition` actions.

Use Jira field display names in `fields`. Before uncertain creates or edits, inspect field metadata with `atlassian_get`. `jira_apply` resolves display names, validates exposed allowed values, preflights the complete batch, and asks the user for confirmation before writing.
