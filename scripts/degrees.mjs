#!/usr/bin/env node

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createResolverBundle,
  formatPromptBundle,
  loadDegrees,
} from "./lib/degree-resolver.mjs";

const execFileAsync = promisify(execFile);
const AGENTS = ["claude-code", "codex", "cursor"];
const STORE_DIR = path.join(os.homedir(), ".agent-degrees", "sources");

function usage() {
  console.log(`Usage:
  degrees list [source]
  degrees use <source> --task "..." [--file path] [--command cmd] [--format prompt|json]
  degrees add <source> [--agent claude-code|codex|cursor|*] [--global|--project] [--copy] [--yes] [--list]

Sources:
  ./agent-degrees
  https://github.com/tomcerdeira/agent-degrees
  tomcerdeira/agent-degrees

Examples:
  degrees list .
  degrees use . --task "Fix keyboard navigation" --file src/components/SearchResults.tsx
  degrees add tomcerdeira/agent-degrees --agent claude-code --global --yes
  degrees add . --agent cursor --project --yes
`);
}

function parseArgs(argv) {
  const result = { _: [], files: [], commands: [], agents: [], format: "prompt" };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--task") {
      if (!next || next.startsWith("--")) throw new Error("--task requires a value");
      result.task = next;
      index += 1;
      continue;
    }
    if (arg === "--file") {
      if (!next || next.startsWith("--")) throw new Error("--file requires a value");
      result.files.push(next);
      index += 1;
      continue;
    }
    if (arg === "--command") {
      if (!next || next.startsWith("--")) throw new Error("--command requires a value");
      result.commands.push(next);
      index += 1;
      continue;
    }
    if (arg === "--agent" || arg === "-a") {
      if (!next || next.startsWith("--")) throw new Error("--agent requires a value");
      result.agents.push(next);
      index += 1;
      continue;
    }
    if (arg === "--format") {
      if (!next || next.startsWith("--")) throw new Error("--format requires a value");
      result.format = next;
      index += 1;
      continue;
    }
    if (arg === "--global" || arg === "-g") {
      result.global = true;
      continue;
    }
    if (arg === "--project") {
      result.project = true;
      continue;
    }
    if (arg === "--copy") {
      result.copy = true;
      continue;
    }
    if (arg === "--yes" || arg === "-y") {
      result.yes = true;
      continue;
    }
    if (arg === "--list" || arg === "-l") {
      result.list = true;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    result._.push(arg);
  }

  return result;
}

function githubUrlFromSource(source) {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source)) {
    return `https://github.com/${source}.git`;
  }
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(source)) {
    return source.replace(/\/$/, "") + ".git";
  }
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+\.git$/.test(source)) {
    return source;
  }
  return null;
}

function sourceSlug(source) {
  return source
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function copyDirectory(source, target) {
  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    filter: (entry) => {
      const parts = entry.split(path.sep);
      return !parts.includes(".git") && !parts.includes("node_modules");
    },
  });
}

async function cloneToStore(source) {
  const url = githubUrlFromSource(source);
  if (!url) return null;

  const target = path.join(STORE_DIR, sourceSlug(source));
  if (existsSync(target)) {
    return target;
  }

  await mkdir(STORE_DIR, { recursive: true });
  await execFileAsync("git", ["clone", "--depth", "1", url, target], { stdio: "ignore" });
  return target;
}

async function resolveSource(source, { persistent = false, copy = false } = {}) {
  const githubTarget = persistent ? await cloneToStore(source) : null;
  if (githubTarget) return githubTarget;

  const githubUrl = githubUrlFromSource(source);
  if (githubUrl) {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "degrees-source-"));
    const target = path.join(tempRoot, sourceSlug(source));
    await execFileAsync("git", ["clone", "--depth", "1", githubUrl, target], { stdio: "ignore" });
    return target;
  }

  const localPath = path.resolve(process.cwd(), source);
  if (!existsSync(localPath)) throw new Error(`Source not found: ${source}`);

  if (persistent && copy) {
    const target = path.join(STORE_DIR, sourceSlug(localPath));
    if (existsSync(target)) return target;
    await copyDirectory(localPath, target);
    return target;
  }

  return localPath;
}

function normalizeAgents(values) {
  if (values.length === 0 || values.includes("*")) return AGENTS;
  const unknown = values.filter((agent) => !AGENTS.includes(agent));
  if (unknown.length > 0) throw new Error(`Unknown agent(s): ${unknown.join(", ")}`);
  return [...new Set(values)];
}

async function renderTemplate(sourceRoot, relativePath, replacements = {}) {
  const template = await readFile(path.join(sourceRoot, relativePath), "utf8");
  let output = template;
  for (const [key, value] of Object.entries(replacements)) {
    output = output.split(key).join(value);
  }
  return output;
}

function renderMetaSkill(template, sourceRoot, name = "agent-degrees") {
  let output = template;
  output = output.replace(/^name: .+$/m, `name: ${name}`);
  if (name === "degree") {
    output = output.replace(
      /^description: .+$/m,
      "description: Resolve a task against local agent-degrees before non-trivial work. Use when the user invokes /degree, asks to use degrees, asks which degree applies, invokes agent-degrees, or when repo instructions say to run degree preflight.",
    );
  }
  output = output.replace(
    "If the repo path is not known, use `$AGENT_DEGREES_HOME` when set. Otherwise ask the user for the path or proceed without degree resolution.",
    `On this machine, use \`${sourceRoot}\`. If the user overrides it, use \`$AGENT_DEGREES_HOME\` instead.`,
  );
  output = output.replaceAll(
    'npm --prefix "$AGENT_DEGREES_HOME" run resolve',
    `npm --prefix "\${AGENT_DEGREES_HOME:-${sourceRoot}}" run resolve`,
  );
  return output;
}

function renderDegreeCommand(sourceRoot) {
  return `---
description: Resolve a task with agent-degrees and return the selected degree prelude
argument-hint: <task>
---

Resolve this task with agent-degrees before doing implementation work:

Task:
$ARGUMENTS

Run:

\`\`\`sh
npm --prefix "${sourceRoot}" run resolve -- --task "$ARGUMENTS"
\`\`\`

If relevant files, commands, logs, or errors are already known, include them as \`--file\` and \`--command\` arguments.

Return the resolver output first, then proceed with the task under the selected degree. If the resolver returns \`ask\`, ask the user to choose. If it returns \`none\`, proceed without a degree and mention that no degree matched.
`;
}

async function confirmOverwrite(filePath, options) {
  if (!existsSync(filePath)) return true;
  if (options.yes) return true;
  if (!process.stdin.isTTY) return false;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${filePath} exists. Overwrite? [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function writeManagedFile(filePath, content, options) {
  if (!(await confirmOverwrite(filePath, options))) {
    console.log(`skip ${filePath}`);
    return;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  console.log(`write ${filePath}`);
}

function projectRoot() {
  return process.cwd();
}

async function installClaudeCode(sourceRoot, scope, options) {
  const metaTemplate = await renderTemplate(sourceRoot, "templates/meta-skill/agent-degrees/SKILL.md");
  const commandTemplate = renderDegreeCommand(sourceRoot);

  if (scope === "global") {
    await writeManagedFile(
      path.join(os.homedir(), ".claude", "skills", "agent-degrees", "SKILL.md"),
      renderMetaSkill(metaTemplate, sourceRoot, "agent-degrees"),
      options,
    );
    await writeManagedFile(
      path.join(os.homedir(), ".claude", "skills", "degree", "SKILL.md"),
      renderMetaSkill(metaTemplate, sourceRoot, "degree"),
      options,
    );
    await writeManagedFile(path.join(os.homedir(), ".claude", "commands", "degree.md"), commandTemplate, options);
    return;
  }

  await writeManagedFile(path.join(projectRoot(), "CLAUDE.md"), await renderTemplate(sourceRoot, "templates/repo-instructions/CLAUDE.md", {
    "<AGENT_DEGREES_REPO>": sourceRoot,
  }), options);
  await writeManagedFile(path.join(projectRoot(), ".claude", "commands", "degree.md"), commandTemplate, options);
}

async function installCodex(sourceRoot, scope, options) {
  const metaTemplate = await renderTemplate(sourceRoot, "templates/meta-skill/agent-degrees/SKILL.md");
  const renderedSkill = renderMetaSkill(metaTemplate, sourceRoot, "agent-degrees");

  if (scope === "global") {
    await writeManagedFile(path.join(os.homedir(), ".codex", "skills", "agent-degrees", "SKILL.md"), renderedSkill, options);
    await writeManagedFile(path.join(os.homedir(), ".agents", "skills", "agent-degrees", "SKILL.md"), renderedSkill, options);
    return;
  }

  await writeManagedFile(path.join(projectRoot(), "AGENTS.md"), await renderTemplate(sourceRoot, "templates/repo-instructions/AGENTS.md", {
    "<AGENT_DEGREES_REPO>": sourceRoot,
  }), options);
}

async function installCursor(sourceRoot, scope, options) {
  const content = await renderTemplate(sourceRoot, "templates/repo-instructions/cursor-rule.md", {
    "<AGENT_DEGREES_REPO>": sourceRoot,
  });
  const base = scope === "global" ? path.join(os.homedir(), ".cursor") : path.join(projectRoot(), ".cursor");
  await writeManagedFile(path.join(base, "rules", "agent-degrees.mdc"), content, options);
}

async function commandList(source) {
  const sourceRoot = await resolveSource(source ?? ".", { persistent: false });
  const degrees = await loadDegrees(sourceRoot);
  for (const degree of degrees) {
    console.log(`${degree.id}\t${degree.name}\t${degree.description}`);
  }
}

async function commandUse(source, options) {
  if (!options.task || options.task.trim() === "") throw new Error("use requires --task");
  if (!["prompt", "json"].includes(options.format)) throw new Error("--format must be prompt or json");

  const sourceRoot = await resolveSource(source, { persistent: false });
  const degrees = await loadDegrees(sourceRoot);
  const bundle = createResolverBundle({
    task: options.task,
    repoSignals: { files: options.files.filter(Boolean) },
    commands: options.commands.filter(Boolean),
  }, degrees);

  if (options.format === "json") {
    console.log(JSON.stringify(bundle, null, 2));
    return;
  }
  console.log(formatPromptBundle(bundle));
}

async function commandAdd(source, options) {
  const sourceRoot = await resolveSource(source, { persistent: true, copy: options.copy });

  if (options.list) {
    await commandList(sourceRoot);
    return;
  }

  const agents = normalizeAgents(options.agents);
  const scopes = [];
  if (options.global) scopes.push("global");
  if (options.project) scopes.push("project");
  if (scopes.length === 0) scopes.push("global");

  for (const scope of scopes) {
    for (const agent of agents) {
      if (agent === "claude-code") await installClaudeCode(sourceRoot, scope, options);
      if (agent === "codex") await installCodex(sourceRoot, scope, options);
      if (agent === "cursor") await installCursor(sourceRoot, scope, options);
    }
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);

  if (!command || options.help) {
    usage();
    return;
  }

  if (command === "list") {
    await commandList(options._[0] ?? ".");
    return;
  }

  if (command === "use") {
    const source = options._[0];
    if (!source) throw new Error("use requires a source");
    await commandUse(source, options);
    return;
  }

  if (command === "add") {
    const source = options._[0];
    if (!source) throw new Error("add requires a source");
    await commandAdd(source, options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
