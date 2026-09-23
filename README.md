# @fieldrobin/cli

Command-line client for FieldRobin’s **public** developer and agent surfaces.

FieldRobin is field service software for home-service businesses (customers,
jobs, scheduling, invoices). This CLI does **not** log into a workspace or
read private account data. Use it to check API health, pull discovery docs,
search public product content, and fetch OpenAPI from the terminal.

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
| `fieldrobin version` | Print this package version |

Add `--json` for machine-readable output where the response is JSON. Override
the default host with `FIELDROBIN_BASE_URL` or `--base-url`.

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

## Development

```sh
npm test
node bin/fieldrobin.mjs discover
```
