# Agent Disciplines

Agent Disciplines is a small package manager and resolver for portable agent context profiles. A discipline is an advisory curation layer over agent skills and tools: it helps an agent choose relevant context first, without hiding skills, enforcing policy, or installing MCPs/CLIs automatically.

```sh
npx disciplines add owner/disciplines --all --agent '*' --global
npx disciplines use installed --task "Fix keyboard navigation" --file src/components/SearchResults.tsx
npx disciplines prepare installed --task "Fix keyboard navigation" --file src/components/SearchResults.tsx
npx disciplines search frontend
npx disciplines smoke --source owner/disciplines
npx disciplines doctor
```

## Why

Agent runtimes can accumulate many skills: frontend, backend, data, testing, observability, deployment, browser automation, documents, and more. That creates a context-selection problem. A simple UI task should not start by loading database, infrastructure, and document-editing guidance.

Disciplines sit above skills. They describe when a work mode should activate, which skill ids and tools are worth considering first, and which adjacent skill families should stay out of the initial context unless the task gives concrete evidence for them.

## Package Format

A discipline package is a folder with a `DISCIPLINE.md` entrypoint:

```text
disciplines/
  software-engineer/
    DISCIPLINE.md
```

`DISCIPLINE.md` uses YAML frontmatter plus a short focus prompt:

```yaml
---
id: software-engineer
name: Software Engineer
version: 0.1.0
description: Focuses agents on UI implementation, accessibility, interaction design, and browser verification.
includeSkills:
  - react-best-practices
  - frontend-design
softExcludeSkills:
  - backend-patterns
  - database-migrations
recommendedTools:
  - id: browser
    kind: mcp
    purpose: Verify user-visible behavior in a real browser.
activation:
  pathPatterns:
    - "**/*.tsx"
  commandPatterns:
    - "\\b(npm|pnpm|bun|yarn)\\s+run\\s+(dev|build|test|typecheck)\\b"
  promptSignals:
    phrases:
      - keyboard navigation
    allOf: []
    anyOf:
      - React
      - accessibility
    noneOf:
      - database migration
  minScore: 6.5
---

You are operating under the Software Engineer discipline.
Prefer UI, interaction, accessibility, and browser-verification context.
Treat backend, database, and infrastructure skills as soft exclusions unless concrete evidence requires them.
```

Schemas:

- [DISCIPLINE.md frontmatter](schema/discipline.schema.json)
- [disciplines.json](schema/disciplines.config.schema.json)
- [disciplines-lock.json](schema/disciplines.lock.schema.json)

Authoring guide: [docs/authoring-disciplines.md](docs/authoring-disciplines.md)

## CLI

Install disciplines from a source:

```sh
npx disciplines add owner/disciplines --discipline software-engineer
npx disciplines add owner/disciplines --all --agent '*' --global --yes
```

Use a discipline without installing:

```sh
npx disciplines use owner/disciplines@software-engineer
```

Resolve a task against installed disciplines:

```sh
npx disciplines use installed \
  --task "Fix keyboard navigation in SearchResults.tsx" \
  --file src/components/SearchResults.tsx
```

Check whether the selected discipline's skills and recommended tools are available:

```sh
npx disciplines prepare installed \
  --task "Fix keyboard navigation in SearchResults.tsx" \
  --file src/components/SearchResults.tsx \
  --agent-name codex
```

`prepare` is designed for agents as much as humans. If it reports missing or unknown skills, MCPs, CLIs, or services, the agent should ask the user whether to install/configure them, skip them for now, or continue with available capabilities. It should not install anything silently.

Disciplines can include `skillInstallHints` so `prepare` can suggest Vercel Skills CLI commands for missing skills:

```yaml
skillInstallHints:
  - id: vercel-react-best-practices
    source: vercel-labs/agent-skills
    packageManager: skills
```

When that skill is missing, `prepare` tells the agent to ask before running:

```sh
npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices
```

Inspect and manage installs:

```sh
npx disciplines catalog
npx disciplines search frontend --verbose
npx disciplines install
npx disciplines list
npx disciplines find frontend
npx disciplines check
npx disciplines update
npx disciplines remove software-engineer
npx disciplines doctor
npx disciplines cleanup
npx disciplines smoke --source owner/disciplines
```

Create a new discipline:

```sh
npx disciplines init software-engineer
```

Supported source formats include GitHub shorthand, full GitHub URLs, GitHub tree URLs, GitLab URLs, generic git URLs, and local paths:

```sh
npx disciplines add tomcerdeira/disciplines
npx disciplines add https://github.com/tomcerdeira/disciplines
npx disciplines add https://github.com/org/disciplines/tree/main/disciplines/software-engineer
npx disciplines add https://gitlab.com/org/repo
npx disciplines add https://gitlab.com/org/repo/-/tree/main/disciplines/software-engineer
npx disciplines add ./local-disciplines
```

Full CLI reference: [docs/cli.md](docs/cli.md)

Discovery and adapter notes:

- `catalog`, `browse`, and `search` read the package-shipped catalog at [catalog/disciplines.json](catalog/disciplines.json). The catalog is intentionally empty until this repo has real public disciplines.
- `smoke --source <source>` creates a temporary project, installs a discipline, runs `doctor`, and resolves a realistic task. Use it after publishing or installing a new package version.
- Agent auto-discovery still depends on each runtime. The CLI writes Claude Code, Codex, and Cursor glue when you pass `--agent`; see [docs/agent-discovery.md](docs/agent-discovery.md).

Projects can commit a small `disciplines.json` for reproducible setup:

```json
{
  "version": 1,
  "disciplines": [
    {
      "source": "tomcerdeira/disciplines",
      "discipline": "software-engineer",
      "agents": ["codex"]
    }
  ]
}
```

Run `npx disciplines install --project --yes` to restore the configured packages and optional agent glue. The command writes `disciplines-lock.json` with the resolved source paths and git revisions. Commit both files when you want repeatable project setup; pass `--no-lock` for local throwaway installs.

## Programmatic API

Adapters and local tooling can import the resolver without shelling out:

```ts
import { createResolverBundle, formatPromptBundle, loadDisciplines } from "disciplines/resolver";

const disciplines = await loadDisciplines(process.cwd());
const bundle = createResolverBundle({
  task: "Fix keyboard navigation in SearchResults.tsx",
  repoSignals: { files: ["src/components/SearchResults.tsx"] },
  commands: ["npm run typecheck"],
}, disciplines);

console.log(formatPromptBundle(bundle));
```

## Installed Stores

Project installs live in:

```text
.agents/disciplines/
```

Global installs live in:

```text
~/.agent-disciplines/disciplines/
```

`add` uses symlinks by default and `--copy` when you want a copied package. Agent glue can be installed for Claude Code, Codex, and Cursor with `--agent claude-code|codex|cursor|*`.

When `--agent` is omitted, `add` installs only the discipline package and does not write agent-specific files.

Each store has a local `.disciplines-manifest.json` that records installed ids, source roots, source paths, install mode, and git revisions for update checks. `doctor` validates that manifest and warns when entries no longer have an installed package.

`doctor` also validates project `disciplines.json` and `disciplines-lock.json` when they exist.

`check` fetches git metadata for installed sources and reports whether manifest-recorded revisions are current. It does not relink, copy, or mutate installed discipline packages. Run `update` after `check` when updates are available.

`cleanup` removes stale `agent-degrees` files from older installs. Use `--disciplines` only when you also want to remove current installed discipline stores and agent glue.

## Public Disciplines

This package ships the CLI, schema, templates, docs, and resolver, plus the published disciplines listed in [catalog/disciplines.json](catalog/disciplines.json):

- **`data-observability-engineer`** — querying, operating, and debugging data stores and telemetry: relational, document, graph, cache, and search systems plus logs, traces, and metrics.

Install a published discipline and wire it into Claude Code, Codex, and Cursor in one command:

```sh
npx disciplines add tomcerdeira/disciplines --discipline data-observability-engineer --agent '*' --global
```

Use `npx disciplines init <name>` to create a new discipline package, then add it to [catalog/disciplines.json](catalog/disciplines.json) when it is ready to publish.

## Development

```sh
npm install
npm run check:all
```

Useful local smoke tests:

```sh
npm run build
node dist/disciplines.js list .
node dist/disciplines.js use . --task "Fix keyboard navigation" --file src/components/SearchResults.tsx
node dist/disciplines.js smoke --source fixtures/sample-disciplines
npm run check:release
```

Release checklist: [docs/release.md](docs/release.md)

## Scope

Disciplines are advisory. They do not:

- hide or disable skills
- enforce refusals
- install MCP servers, CLIs, services, or plugins automatically
- override system, developer, user, or repository instructions

They only help agents start with a smaller, more relevant context bundle and expand deliberately when the task requires it.
