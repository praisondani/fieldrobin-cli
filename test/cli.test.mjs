import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../bin/fieldrobin.mjs", import.meta.url));
const packageJson = createRequire(import.meta.url)("../package.json");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

async function runCli(args, environment = {}) {
  const env = { ...process.env };
  delete env.FIELDROBIN_BASE_URL;
  Object.assign(env, environment);

  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      env,
      encoding: "utf8",
    });

    return { code: 0, ...result };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stderr: error.stderr ?? "",
      stdout: error.stdout ?? "",
    };
  }
}

async function startFixtureServer() {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push(url);

    if (url.pathname === "/llms.txt") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("FieldRobin public resources");
      return;
    }

    if (url.pathname === "/api/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok", version: "test" }));
      return;
    }

    if (url.pathname === "/openapi.json") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ openapi: "3.1.0" }));
      return;
    }

    if (url.pathname === "/api/ai/search") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ query: url.searchParams.get("q"), results: [] }));
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: "NOT_FOUND" }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  assert.equal(typeof address, "object");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function startMcpFixtureServer({ toolError = false, scopeError = false } = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    requests.push({ method: request.method, headers: request.headers, body });

    if (body?.method === "initialize") {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Mcp-Session-Id": "cli-session",
      });
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "2025-11-25" },
      }));
      return;
    }

    if (body?.method === "notifications/initialized") {
      response.writeHead(202);
      response.end();
      return;
    }

    if (body?.method === "tools/list") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [
            { name: "get-workspace-summary", annotations: { readOnlyHint: true } },
            {
              name: "create-job",
              annotations: { readOnlyHint: false },
              inputSchema: {
                type: "object",
                required: ["idempotency_key"],
                properties: { idempotency_key: { type: "string" } },
              },
            },
          ],
        },
      }));
      return;
    }

    if (body?.method === "tools/call") {
      if (scopeError) {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: {
            code: -32003,
            message: "create-job requires mcp:read and mcp:jobs:write.",
            data: {
              code: "MCP_WRITE_SCOPE_REQUIRED",
              required_scopes: ["mcp:read", "mcp:jobs:write"],
              resource_metadata: "https://fieldrobin.com/.well-known/oauth-protected-resource/api/v1/mcp",
            },
          },
        }));
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          ...(toolError ? { isError: true } : {}),
          content: [{ type: "text", text: toolError ? "Tool denied" : "Tool completed" }],
        },
      }));
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: "NOT_FOUND" }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  assert.equal(typeof address, "object");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("prints help without making a network request", async () => {
  const result = await runCli(["--help"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /fieldrobin discover/);
  assert.match(result.stdout, /fieldrobin search QUERY/);
  assert.match(result.stdout, /fieldrobin openapi/);
});

test("prints the package version", async () => {
  const result = await runCli(["version"]);

  assert.equal(result.code, 0);
  assert.match(
    result.stdout,
    new RegExp(`@fieldrobin\\/cli ${packageJson.version.replace(/\./g, "\\.")}`),
  );
});

test("fetches discovery, health, openapi, and encoded search resources", async () => {
  const fixture = await startFixtureServer();

  try {
    const discover = await runCli(["discover", "--base-url", `${fixture.baseUrl}/`, "--json"]);
    assert.equal(discover.code, 0);
    assert.equal(JSON.parse(discover.stdout), "FieldRobin public resources");

    const health = await runCli(["health"], { FIELDROBIN_BASE_URL: fixture.baseUrl });
    assert.equal(health.code, 0);
    assert.deepEqual(JSON.parse(health.stdout), { status: "ok", version: "test" });

    const openapi = await runCli(["openapi", "--base-url", fixture.baseUrl, "--json"]);
    assert.equal(openapi.code, 0);
    assert.deepEqual(JSON.parse(openapi.stdout), { openapi: "3.1.0" });

    const search = await runCli(["search", "review follow-up", "--base-url", fixture.baseUrl, "--json"]);
    assert.equal(search.code, 0);
    assert.deepEqual(JSON.parse(search.stdout), { query: "review follow-up", results: [] });

    assert.deepEqual(fixture.requests.map((request) => request.pathname), [
      "/llms.txt",
      "/api/health",
      "/openapi.json",
      "/api/ai/search",
    ]);
    assert.equal(fixture.requests[3].searchParams.get("q"), "review follow-up");
  } finally {
    await fixture.close();
  }
});

test("returns a structured error for failed requests", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: "AUTHENTICATION_REQUIRED" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  assert.equal(typeof address, "object");

  try {
    const result = await runCli(["health", "--base-url", `http://127.0.0.1:${address.port}`]);
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.stderr), {
      code: "AUTHENTICATION_REQUIRED",
      message: "FieldRobin request failed with HTTP 401",
      resolution: "Check the base URL, network connection, and API response before retrying.",
      status: 401,
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("lists FieldRobin MCP tools without requiring a workspace token", async () => {
  const fixture = await startMcpFixtureServer();

  try {
    const result = await runCli(["mcp", "tools", "--base-url", fixture.baseUrl, "--json"]);

    assert.equal(result.code, 0);
    assert.deepEqual(
      JSON.parse(result.stdout).tools.map((tool) => tool.name),
      ["get-workspace-summary", "create-job"],
    );
    assert.deepEqual(fixture.requests.map(({ body }) => body.method), [
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
  } finally {
    await fixture.close();
  }
});

test("calls a read-only FieldRobin MCP tool with the supplied OAuth token", async () => {
  const fixture = await startMcpFixtureServer();

  try {
    const result = await runCli(
      ["mcp", "call", "get-workspace-summary", "{}", "--base-url", fixture.baseUrl, "--json"],
      { FIELDROBIN_MCP_TOKEN: "test-oauth-token" },
    );

    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), {
      content: [{ type: "text", text: "Tool completed" }],
    });
    assert.deepEqual(fixture.requests.map(({ body }) => body.method), [
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
    ]);
    assert.equal(fixture.requests[0].headers.authorization, "Bearer test-oauth-token");
    assert.deepEqual(fixture.requests[3].body.params, {
      name: "get-workspace-summary",
      arguments: {},
    });
  } finally {
    await fixture.close();
  }
});

test("explains that an OAuth token is required before workspace tool calls", async () => {
  const fixture = await startMcpFixtureServer();

  try {
    const result = await runCli([
      "mcp", "call", "get-workspace-summary", "{}", "--base-url", fixture.baseUrl,
    ]);

    assert.equal(result.code, 1);
    const error = JSON.parse(result.stderr);
    assert.equal(error.code, "MCP_AUTH_REQUIRED");
    assert.match(error.resolution, /FIELDROBIN_MCP_TOKEN/);
    assert.equal(fixture.requests.length, 0);
  } finally {
    await fixture.close();
  }
});

test("requires explicit approval before a CLI MCP write and requires its idempotency key", async () => {
  const fixture = await startMcpFixtureServer();

  try {
    const denied = await runCli(
      ["mcp", "call", "create-job", '{"idempotency_key":"job-1"}', "--base-url", fixture.baseUrl],
      { FIELDROBIN_MCP_TOKEN: "write-oauth-token" },
    );
    assert.equal(denied.code, 1);
    assert.match(JSON.parse(denied.stderr).message, /repeat with --approve/);
    assert.equal(fixture.requests.filter(({ body }) => body.method === "tools/call").length, 0);

    const missingIdempotencyKey = await runCli(
      ["mcp", "call", "create-job", "{}", "--approve", "--base-url", fixture.baseUrl],
      { FIELDROBIN_MCP_TOKEN: "write-oauth-token" },
    );
    assert.equal(missingIdempotencyKey.code, 1);
    assert.match(JSON.parse(missingIdempotencyKey.stderr).message, /requires idempotency_key/);
    assert.equal(fixture.requests.filter(({ body }) => body.method === "tools/call").length, 0);

    const approved = await runCli(
      ["mcp", "call", "create-job", '{"idempotency_key":"job-1"}', "--approve", "--base-url", fixture.baseUrl, "--json"],
      { FIELDROBIN_MCP_TOKEN: "write-oauth-token" },
    );
    assert.equal(approved.code, 0);
    assert.equal(fixture.requests.filter(({ body }) => body.method === "tools/call").length, 1);
    assert.deepEqual(fixture.requests.at(-1).body.params.arguments, { idempotency_key: "job-1" });
  } finally {
    await fixture.close();
  }
});

test("returns a failing exit code when an MCP tool returns isError", async () => {
  const fixture = await startMcpFixtureServer({ toolError: true });

  try {
    const result = await runCli(
      ["mcp", "call", "get-workspace-summary", "{}", "--base-url", fixture.baseUrl, "--json"],
      { FIELDROBIN_MCP_TOKEN: "test-oauth-token" },
    );

    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).isError, true);
  } finally {
    await fixture.close();
  }
});

test("explains which OAuth scope is needed when a write call is denied", async () => {
  const fixture = await startMcpFixtureServer({ scopeError: true });

  try {
    const result = await runCli(
      ["mcp", "call", "create-job", '{"idempotency_key":"job-1"}', "--approve", "--base-url", fixture.baseUrl],
      { FIELDROBIN_MCP_TOKEN: "read-only-oauth-token" },
    );

    assert.equal(result.code, 1);
    const error = JSON.parse(result.stderr);
    assert.equal(error.code, "MCP_WRITE_SCOPE_REQUIRED");
    assert.match(error.message, /create-job requires/);
    assert.match(error.resolution, /mcp:jobs:write/);
    assert.match(error.resolution, /oauth-protected-resource/);
    assert.equal(error.status, 403);
    assert.equal(fixture.requests.filter(({ body }) => body.method === "tools/call").length, 1);
  } finally {
    await fixture.close();
  }
});

test("checks production health before MCP or OAuth setup", () => {
  assert.match(readme, /\/api\/health/);
  assert.match(readme, /HTTP 200/);
  assert.match(readme, /stop|do not continue|wait/i);
});
