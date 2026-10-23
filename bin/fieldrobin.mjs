#!/usr/bin/env node

import { createRequire } from "node:module";
import { FieldRobinMcpClient } from "@fieldrobin/sdk";

const DEFAULT_BASE_URL = "https://fieldrobin.com";
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

function usage() {
  return [
    "FieldRobin CLI",
    "",
    "Usage:",
    "  fieldrobin discover [--base-url URL] [--json]",
    "  fieldrobin health [--base-url URL] [--json]",
    "  fieldrobin search QUERY [--base-url URL] [--json]",
    "  fieldrobin openapi [--base-url URL] [--json]",
    "  fieldrobin mcp tools [--base-url URL] [--json]",
    "  fieldrobin mcp call TOOL [JSON_ARGUMENTS] [--approve] [--base-url URL] [--json]",
    "  fieldrobin version",
    "",
    "Environment:",
    "  FIELDROBIN_BASE_URL  Override the default https://fieldrobin.com base URL.",
    "  FIELDROBIN_MCP_TOKEN OAuth access token for authenticated MCP tool calls.",
    "",
    "MCP calls require an OAuth token with mcp:read. Tools that may change workspace data require --approve.",
  ].join("\n");
}

function parseArgs(args) {
  const positional = [];
  let baseUrl = process.env.FIELDROBIN_BASE_URL || DEFAULT_BASE_URL;
  let json = false;
  let approve = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--approve") {
      approve = true;
    } else if (arg === "--base-url") {
      baseUrl = args[index + 1] || baseUrl;
      index += 1;
    } else {
      positional.push(arg);
    }
  }

  return { positional, baseUrl: baseUrl.replace(/\/+$/, ""), json, approve };
}

function cliError(code, message, resolution) {
  const error = new Error(message);
  error.code = code;
  error.resolution = resolution;
  return error;
}

async function fetchResource(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { Accept: "application/json, text/plain, text/markdown" },
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(`FieldRobin request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return { body, status: response.status, headers: Object.fromEntries(response.headers.entries()) };
}

function parseToolArguments(rawArguments) {
  if (!rawArguments) return {};

  let parsed;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    throw cliError("INVALID_JSON_ARGUMENTS", "MCP tool arguments must be valid JSON.", "Pass one JSON object after the tool name.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw cliError("INVALID_JSON_ARGUMENTS", "MCP tool arguments must be a JSON object.", "Pass one JSON object after the tool name.");
  }

  return parsed;
}

async function runMcpCommand(baseUrl, subcommand, args, { approve } = {}) {
  const mcp = new FieldRobinMcpClient({
    baseUrl,
    token: process.env.FIELDROBIN_MCP_TOKEN,
  });

  if (subcommand === "tools" && args.length === 0) {
    return mcp.listTools();
  }

  if (subcommand !== "call" || args.length < 1) {
    throw cliError("INVALID_COMMAND", `Unknown MCP command: ${subcommand || ""}\n\n${usage()}`, "Run `fieldrobin mcp tools` to inspect the available commands and tools.");
  }

  if (!process.env.FIELDROBIN_MCP_TOKEN?.trim()) {
    throw cliError(
      "MCP_AUTH_REQUIRED",
      "An OAuth access token is required before calling a FieldRobin workspace tool.",
      "Set FIELDROBIN_MCP_TOKEN to a token with mcp:read. Store it in a secret manager or protected process environment.",
    );
  }

  const [name, ...rawArguments] = args;
  const toolArguments = parseToolArguments(rawArguments.join(" "));
  const { tools } = await mcp.listTools();
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw cliError("UNKNOWN_MCP_TOOL", `Unknown FieldRobin MCP tool: ${name}`, "Run `fieldrobin mcp tools` to see available tools.");
  }

  if (tool.annotations?.readOnlyHint !== true && !approve) {
    throw cliError(
      "APPROVAL_REQUIRED",
      `Tool ${name} may change workspace data. Review arguments, then repeat with --approve.`,
      "Review the tool schema and supplied JSON. Rerun with --approve only if this change is intended.",
    );
  }

  const required = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [];
  if (required.includes("idempotency_key") && !toolArguments.idempotency_key) {
    throw cliError(
      "IDEMPOTENCY_KEY_REQUIRED",
      `Tool ${name} requires idempotency_key in its JSON arguments.`,
      "Add a unique idempotency_key to the JSON object before retrying the tool call.",
    );
  }

  return mcp.callTool(name, toolArguments);
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result.body, null, 2)}\n`);
    return;
  }
  if (typeof result.body === "string") {
    process.stdout.write(`${result.body.replace(/\s+$/, "")}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result.body, null, 2)}\n`);
}

async function main() {
  const { positional, baseUrl, json, approve } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;

  if (!command || command === "--help" || command === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (command === "version" || command === "--version" || command === "-V") {
    process.stdout.write(`${packageJson.name} ${packageJson.version}\n`);
    return;
  }

  let result;
  if (command === "discover") {
    result = await fetchResource(baseUrl, "/llms.txt");
  } else if (command === "health") {
    result = await fetchResource(baseUrl, "/api/health");
  } else if (command === "openapi") {
    result = await fetchResource(baseUrl, "/openapi.json");
  } else if (command === "search") {
    const query = rest.join(" ").trim();
    if (!query) throw new Error("search requires a query");
    result = await fetchResource(baseUrl, `/api/ai/search?q=${encodeURIComponent(query)}`);
  } else if (command === "mcp") {
    const [subcommand, ...mcpArgs] = rest;
    result = {
      body: await runMcpCommand(baseUrl, subcommand, mcpArgs, { approve }),
    };
  } else {
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }

  printResult(result, json);
  if (command === "mcp" && rest[0] === "call" && result.body?.isError) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const errorData = error?.data || error?.body?.error?.data;
  const errorCode = errorData?.code
    || error?.body?.code
    || error?.body?.error?.code
    || error?.code
    || "CLI_REQUEST_FAILED";
  const requiredScopes = Array.isArray(errorData?.required_scopes)
    ? errorData.required_scopes.join(" ")
    : "the required MCP write scope";
  const scopeResolution = errorData?.resource_metadata
    ? `Complete OAuth step-up for ${requiredScopes} using ${errorData.resource_metadata}. Retry only after the new grant is active.`
    : `Complete OAuth step-up for ${requiredScopes}. Retry only after the new grant is active.`;
  const payload = {
    code: errorCode,
    message: error instanceof Error ? error.message : String(error),
    resolution: error?.resolution || (errorCode === "MCP_WRITE_SCOPE_REQUIRED"
      ? scopeResolution
      : "Check the base URL, network connection, and API response before retrying."),
    status: error?.status || 1,
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
