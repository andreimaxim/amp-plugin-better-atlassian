# Better Atlassian for Amp

An [Amp](https://ampcode.com) plugin for common interactions with Jira and Confluence.

## How it works

The plugin aims to be minimal and allows the model to perform non-destructive actions, while requiring confirmation before
performing destructive actions.

The plugin is exposes the following custom tools:

* `atlassian_get`, which performs authenticated `GET` requests to any Atlassian endpoint (Jira or Confluence)
* `jira_search`, which performs and authenticated `POST` requests to the JQL endpoint
* `jira_apply`, which creates or updates Jira issues and requires user confirmation

## Configuration

Edit `~/.config/amp/settings.json` and add the following values:

```json
{
  "amp.atlassian.siteUrl": "https://your-company.atlassian.net",
  "amp.atlassian.email": "you@example.com",
  "amp.atlassian.apiToken": "your-api-token"
}
```

## Installation

Either copy the `better-atlassian.ts` file into Amp plugin folder (e.g. `~/.config/amp/plugins/`) and add the `using-jira` skill to `~/.config/agents/skills/` or run:

```sh
./install.sh
```

Then run `plugins: reload` in Amp.
