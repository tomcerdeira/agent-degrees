# Invoking Agent Degrees

The v1 resolver works without runtime integration, but you can make it feel more like a skill by adding lightweight entrypoints to the agents and repos where you work.

The easiest path is the CLI:

```sh
degrees add tomcerdeira/agent-degrees --agent claude-code --global --yes
degrees add . --agent '*' --project --yes
```

See [cli.md](cli.md) for supported sources, agents, scopes, and overwrite behavior. The manual options below are useful when you want to inspect or customize the generated files.

## Options

### 1. Meta-Skill

Copy [../templates/meta-skill/agent-degrees/SKILL.md](../templates/meta-skill/agent-degrees/SKILL.md) into a skill-capable runtime.

Example:

```text
agent-degrees/
  SKILL.md
```

Then invoke it with language such as:

```md
Use agent-degrees for this task: fix keyboard shortcuts in the candidates page.
```

The skill tells the agent to run the resolver first, then load the matched degree guidance before expanding into task-specific skills and tools.

### 2. Repo Instructions

Copy one of the repo snippets into projects where degrees should be checked automatically:

- [AGENTS.md](../templates/repo-instructions/AGENTS.md)
- [CLAUDE.md](../templates/repo-instructions/CLAUDE.md)
- [cursor-rule.md](../templates/repo-instructions/cursor-rule.md)

Replace `<AGENT_DEGREES_REPO>` with the absolute path to your cloned `agent-degrees` repo.

These snippets make degree preflight part of the project workflow without installing an MCP server or plugin.

### 3. Slash or Custom Command

Use [../templates/commands/degree.md](../templates/commands/degree.md) as the body for a slash/custom command in runtimes that support them.

For shell-friendly workflows, copy [../templates/commands/degree.sh](../templates/commands/degree.sh) somewhere on your path and set:

```sh
export AGENT_DEGREES_HOME="/absolute/path/to/agent-degrees"
```

Then run:

```sh
degree.sh "Fix keyboard navigation in SearchResults.tsx" --file src/components/SearchResults.tsx
```

## Behavior

All invocation options preserve the same rules:

- Degrees are advisory.
- Soft exclusions are not refusals.
- Missing skills and tools should be reported, not silently substituted.
- No tools or plugins are installed automatically.
- The resolver output is task-local guidance and does not override higher-priority instructions.
