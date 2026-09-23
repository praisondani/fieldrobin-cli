import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../bin/fieldrobin.mjs", import.meta.url));
const packageJson = createRequire(import.meta.url)("../package.json");

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
