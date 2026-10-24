# @fieldrobin/cli

Command-line client for FieldRobin’s **public** developer and agent surfaces.

FieldRobin is field service software for home-service businesses (customers,
jobs, scheduling, invoices). Public commands need no login. MCP commands can
inspect and call workspace tools when you provide an OAuth access token. The
CLI does not collect or store credentials; use FieldRobin’s OAuth flow to get a
token. See https://fieldrobin.com/auth.md for client registration and consent.

## Published version

The npm `latest` release is currently `0.1.3`. It includes the public commands;
the authenticated `mcp` commands described below are in source version `0.2.0`
and are not available from npm yet. They require `@fieldrobin/cli@0.2.0` or
later. Check the registry before installing:

```sh
npm view @fieldrobin/cli version
```

The FieldRobin product repository is private. **This repository** is the
public source for the npm package
[`@fieldrobin/cli`](https://www.npmjs.com/package/@fieldrobin/cli).

Related public packages:

- Skills: [`praisondani/fieldrobin-skills`](https://github.com/praisondani/fieldrobin-skills)
- SDK: [`praisondani/fieldrobin-sdk`](https://github.com/praisondani/fieldrobin-sdk) /
  [`@fieldrobin/sdk`](https://www.npmjs.com/package/@fieldrobin/sdk)

## What it does

| Command | Action |
| --- | --- |
| `fieldrobin discover` | Fetch `/llms.txt` (public agent index) |
| `fieldrobin health` | Fetch `/api/health` |
| `fieldrobin search "…"` | Keyword search over approved public Markdown |
| `fieldrobin openapi` | Fetch `/openapi.json` |
| `fieldrobin mcp tools` | List MCP tools and their input schemas |
| `fieldrobin mcp call TOOL [JSON]` | Call a workspace tool with an OAuth token |
| `fieldrobin version` | Print this package version |

Add `--json` for machine-readable output where the response is JSON. Override
the default host with `FIELDROBIN_BASE_URL` or `--base-url`.

Set `FIELDROBIN_MCP_TOKEN` to an OAuth access token with `mcp:read` before
calling workspace tools. Use a read-only grant for inspection. The CLI requires
`--approve` for any tool that is not marked read-only, and requires
`idempotency_key` when the tool schema asks for it. It does not retry tool
calls automatically. A scope-denial error reports the required scopes and
resource metadata so you can complete OAuth step-up before trying again.

For a typed JavaScript/TypeScript client in app code, use
[`@fieldrobin/sdk`](https://www.npmjs.com/package/@fieldrobin/sdk) instead.

## Install

```sh
npm install --global @fieldrobin/cli
```

Or run once without a global install:

```sh
npx --yes @fieldrobin/cli discover
```

## Examples

```sh
fieldrobin discover
fieldrobin health --json
fieldrobin search "review follow-up"
fieldrobin openapi
fieldrobin version
```

List tools without signing in. To call a workspace tool, make
`FIELDROBIN_MCP_TOKEN` available to the process through your secret manager or
protected environment:

```sh
fieldrobin mcp tools --json
fieldrobin mcp call get-workspace-summary '{}'
```

Write tools require `--approve` after you review the JSON arguments. OAuth
scopes still determine which actions the server permits.

## Development

```sh
npm install
npm test
node bin/fieldrobin.mjs discover
```
