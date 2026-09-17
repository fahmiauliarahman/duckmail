#!/usr/bin/env node
// Generate DuckDuckGo private email addresses (@duck.com).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const API_URL = "https://quack.duckduckgo.com/api/email/addresses";

const HELP = `Generate DuckDuckGo private email addresses (@duck.com).

Usage:
  duckmail [count]    Generate addresses (default: 1)
  duckmail login      Save your bearer token
  duckmail logout     Remove the saved token
  duckmail --help     Show this help

The token is read from, in order:
  1. the BEARER_TOKEN environment variable
  2. a .env file in the current directory
  3. the token saved with \`duckmail login\``;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function configPath() {
  const base =
    process.platform === "win32"
      ? process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "duckmail", "config.json");
}

function readSavedToken() {
  try {
    return JSON.parse(readFileSync(configPath(), "utf8")).token;
  } catch {
    return undefined;
  }
}

function resolveToken() {
  if (process.env.BEARER_TOKEN) {
    return process.env.BEARER_TOKEN;
  }
  const envPath = join(process.cwd(), ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
    if (process.env.BEARER_TOKEN) {
      return process.env.BEARER_TOKEN;
    }
  }
  return readSavedToken();
}

async function login() {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const token = (await rl.question("Paste your DuckDuckGo bearer token: ")).trim();
  rl.close();
  if (!token) {
    fail("no token entered");
  }

  const path = configPath();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ token }, null, 2) + "\n", { mode: 0o600 });
  console.error(`Token saved to ${path}`);
}

function logout() {
  const path = configPath();
  if (existsSync(path)) {
    rmSync(path);
    console.error("Saved token removed.");
  } else {
    console.error("No saved token found.");
  }
}

async function generateAddress(token) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (err) {
    fail(`request failed: ${err.cause?.message ?? err.message}`);
  }

  const body = await response.text();
  if (!response.ok) {
    fail(`request failed (HTTP ${response.status}): ${body || "no response"}`);
  }

  let address;
  try {
    address = JSON.parse(body).address;
  } catch {
    // handled below
  }
  if (!address) {
    fail(`unexpected response: ${body}`);
  }
  return `${address}@duck.com`;
}

// Try each platform's clipboard tool; return true on the first that works.
function copyToClipboard(text) {
  const candidates = {
    win32: [["clip"]],
    darwin: [["pbcopy"]],
  }[process.platform] ?? [
    ["wl-copy"],
    ["xclip", "-selection", "clipboard"],
    ["xsel", "--clipboard", "--input"],
  ];

  for (const [cmd, ...args] of candidates) {
    const result = spawnSync(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"] });
    if (!result.error && result.status === 0) {
      return true;
    }
  }
  return false;
}

async function generate(countArg = "1") {
  if (!/^[1-9]\d*$/.test(countArg)) {
    fail("count must be a positive integer");
  }

  const token = resolveToken();
  if (!token) {
    fail("no token found. Run `duckmail login` or set BEARER_TOKEN.");
  }

  const emails = [];
  for (let i = 0; i < Number(countArg); i++) {
    const email = await generateAddress(token);
    emails.push(email);
    console.log(email);
  }

  if (copyToClipboard(emails.join("\n") + "\n")) {
    console.error("(copied to clipboard)");
  }
}

const [command] = process.argv.slice(2);
switch (command) {
  case "-h":
  case "--help":
    console.log(HELP);
    break;
  case "login":
    await login();
    break;
  case "logout":
    logout();
    break;
  default:
    await generate(command);
}
