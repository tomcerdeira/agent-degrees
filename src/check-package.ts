#!/usr/bin/env node

import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "disciplines-pack-"));
  const { stdout } = await execFileAsync("npm", ["pack", "--json", "--pack-destination", tmp], { cwd: root });
  const [pack] = JSON.parse(stdout);
  const tarball = path.join(tmp, pack.filename);

  const listing = await execFileAsync("tar", ["-tf", tarball]);
  for (const expected of [
    "package/dist/disciplines.js",
    "package/src/disciplines.ts",
    "package/package.json",
  ]) {
    assert(listing.stdout.includes(expected), `package is missing ${expected}`);
  }

  await execFileAsync("npm", ["exec", "--yes", "--package", tarball, "--", "disciplines", "list", "--global"], {
    cwd: tmp,
    env: { ...process.env, HOME: path.join(tmp, "home") },
  });

  console.log(`Package smoke check passed (${pack.name}@${pack.version}).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
