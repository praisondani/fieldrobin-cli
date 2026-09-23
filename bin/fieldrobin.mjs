#!/usr/bin/env node

import { createRequire } from "node:module";

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
    "  fieldrobin version",
    "",
    "Environment:",
    "  FIELDROBIN_BASE_URL  Override the default https://fieldrobin.com base URL.",
  ].join("\n");
}

function parseArgs(args) {
  const positional = [];
  let baseUrl = process.env.FIELDROBIN_BASE_URL || DEFAULT_BASE_URL;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--base-url") {
      baseUrl = args[index + 1] || baseUrl;
      index += 1;
    } else {
      positional.push(arg);
    }
  }

  return { positional, baseUrl: baseUrl.replace(/\/+$/, ""), json };
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
  const { positional, baseUrl, json } = parseArgs(process.argv.slice(2));
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
  } else {
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }

  printResult(result, json);
}

main().catch((error) => {
  const payload = {
    code: error?.body?.code || "CLI_REQUEST_FAILED",
    message: error instanceof Error ? error.message : String(error),
    resolution: "Check the base URL, network connection, and API response before retrying.",
    status: error?.status || 1,
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
