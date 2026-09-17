import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../generate.js", import.meta.url));

// Local stand-in for the DuckDuckGo API, so tests never create real addresses.
let server;
let apiUrl;
let requests;
let respond;

before(async () => {
  server = createServer((req, res) => {
    requests.push({ method: req.method, authorization: req.headers.authorization });
    const { status, body } = respond(requests.length);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${server.address().port}/api/email/addresses`;
});

after(() => server.close());

let workDir;

beforeEach((t) => {
  requests = [];
  respond = (n) => ({ status: 201, body: JSON.stringify({ address: `addr${n}` }) });
  workDir = mkdtempSync(join(tmpdir(), "duckmail-test-"));
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
});

// Run the CLI in an isolated environment: temp cwd and config dir, no inherited
// token, and an empty PATH so it can't reach the real clipboard.
function run(args = [], { env = {}, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: workDir,
      env: {
        PATH: "",
        SystemRoot: process.env.SystemRoot,
        XDG_CONFIG_HOME: join(workDir, "config"),
        APPDATA: join(workDir, "config"),
        DUCKMAIL_API_URL: apiUrl,
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function savedConfigPath() {
  return join(workDir, "config", "duckmail", "config.json");
}

describe("help", () => {
  for (const flag of ["--help", "-h"]) {
    test(`${flag} prints usage`, async () => {
      const { code, stdout } = await run([flag]);
      assert.equal(code, 0);
      assert.match(stdout, /Usage:/);
      assert.match(stdout, /max: 10/);
    });
  }
});

describe("generate", () => {
  const token = { env: { BEARER_TOKEN: "test-token" } };

  test("generates one address by default", async () => {
    const { code, stdout } = await run([], token);
    assert.equal(code, 0);
    assert.equal(stdout, "addr1@duck.com\n");
    assert.deepEqual(requests, [{ method: "POST", authorization: "Bearer test-token" }]);
  });

  test("generates the requested number of addresses", async () => {
    const { code, stdout } = await run(["3"], token);
    assert.equal(code, 0);
    assert.equal(stdout, "addr1@duck.com\naddr2@duck.com\naddr3@duck.com\n");
    assert.equal(requests.length, 3);
  });

  test("allows the maximum of 10", async () => {
    const { code, stdout } = await run(["10"], token);
    assert.equal(code, 0);
    assert.equal(stdout.trim().split("\n").length, 10);
  });

  test("rejects more than 10 without calling the API", async () => {
    const { code, stderr } = await run(["11"], token);
    assert.equal(code, 1);
    assert.match(stderr, /count must be 10 or less/);
    assert.equal(requests.length, 0);
  });

  for (const bad of ["0", "-1", "abc", "1.5", "01"]) {
    test(`rejects invalid count "${bad}" without calling the API`, async () => {
      const { code, stderr } = await run([bad], token);
      assert.equal(code, 1);
      assert.match(stderr, /count must be a positive integer/);
      assert.equal(requests.length, 0);
    });
  }

  test("fails when no token is found", async () => {
    const { code, stderr } = await run();
    assert.equal(code, 1);
    assert.match(stderr, /no token found/);
    assert.equal(requests.length, 0);
  });

  test("reports API errors", async () => {
    respond = () => ({ status: 401, body: '{"error":"invalid_token"}' });
    const { code, stdout, stderr } = await run([], token);
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /HTTP 401.*invalid_token/);
  });

  test("reports a response without an address", async () => {
    respond = () => ({ status: 200, body: "{}" });
    const { code, stderr } = await run([], token);
    assert.equal(code, 1);
    assert.match(stderr, /unexpected response: \{\}/);
  });

  test("reports a non-JSON response", async () => {
    respond = () => ({ status: 200, body: "<html>" });
    const { code, stderr } = await run([], token);
    assert.equal(code, 1);
    assert.match(stderr, /unexpected response: <html>/);
  });

  test("stops at the first failure in a bulk run", async () => {
    respond = (n) =>
      n === 2
        ? { status: 500, body: "" }
        : { status: 201, body: JSON.stringify({ address: `addr${n}` }) };
    const { code, stdout, stderr } = await run(["5"], token);
    assert.equal(code, 1);
    assert.equal(stdout, "addr1@duck.com\n");
    assert.match(stderr, /HTTP 500/);
    assert.equal(requests.length, 2);
  });
});

describe("token lookup", () => {
  function saveToken(value) {
    return run(["login"], { input: `${value}\n` });
  }

  test("environment variable wins over .env and saved token", async () => {
    await saveToken("saved-token");
    writeFileSync(join(workDir, ".env"), 'BEARER_TOKEN="dotenv-token"\n');
    await run([], { env: { BEARER_TOKEN: "env-token" } });
    assert.equal(requests.at(-1).authorization, "Bearer env-token");
  });

  test(".env in the current directory wins over saved token", async () => {
    await saveToken("saved-token");
    writeFileSync(join(workDir, ".env"), 'BEARER_TOKEN="dotenv-token"\n');
    await run();
    assert.equal(requests.at(-1).authorization, "Bearer dotenv-token");
  });

  test("falls back to the saved token", async () => {
    await saveToken("saved-token");
    await run();
    assert.equal(requests.at(-1).authorization, "Bearer saved-token");
  });
});

describe("login and logout", () => {
  test("login saves the trimmed token", async () => {
    const { code, stderr } = await run(["login"], { input: "  my-token  \n" });
    assert.equal(code, 0);
    assert.match(stderr, /Token saved/);
    assert.deepEqual(JSON.parse(readFileSync(savedConfigPath(), "utf8")), { token: "my-token" });
  });

  test("login rejects an empty token", async () => {
    const { code, stderr } = await run(["login"], { input: "\n" });
    assert.equal(code, 1);
    assert.match(stderr, /no token entered/);
    assert.equal(existsSync(savedConfigPath()), false);
  });

  test("logout removes the saved token", async () => {
    await run(["login"], { input: "my-token\n" });
    const { code, stderr } = await run(["logout"]);
    assert.equal(code, 0);
    assert.match(stderr, /Saved token removed/);
    assert.equal(existsSync(savedConfigPath()), false);
  });

  test("logout without a saved token", async () => {
    const { code, stderr } = await run(["logout"]);
    assert.equal(code, 0);
    assert.match(stderr, /No saved token found/);
  });
});
