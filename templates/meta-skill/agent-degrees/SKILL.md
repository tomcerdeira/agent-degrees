---
name: agent-degrees
description: Resolve a task against local agent-degrees before non-trivial work. Use when the user asks to use degrees, asks which degree applies, invokes agent-degrees, or when repo instructions say to run degree preflight.
---

# Agent Degrees

Use this skill as a lightweight preflight before non-trivial work. It does not replace task-specific skills; it decides which degree should guide which skills and tools enter context first.

## Inputs

- User task text.
- Relevant repo paths, changed files, commands, logs, or other evidence.
- Path to the local `agent-degrees` repo.

If the repo path is not known, use `$AGENT_DEGREES_HOME` when set. Otherwise ask the user for the path or proceed without degree resolution.

## Workflow

1. Gather the task text and the smallest useful evidence set:
   - files the user named
   - changed files you already know about
   - likely verification commands
   - logs or errors the user provided
2. Run the local resolver:

   ```sh
   npm --prefix "$AGENT_DEGREES_HOME" run resolve -- \
     --task "<task>" \
     --file "<relevant/path>" \
     --command "<relevant command>"
   ```

3. Read the resolver output.
4. If it returns `select` or `compose`, use the selected degree prompt as task-local guidance.
5. Map included skill ids to available local skills only when names clearly match.
6. Map recommended tools to available tools, MCPs, CLIs, browser capabilities, or package-manager commands.
7. Keep soft-excluded skills out of initial context unless the user asks for them or concrete evidence shows they are required.
8. Continue the user's task normally.

## Rules

- Degrees are advisory, not enforcement.
- Do not hide skills, refuse access, mutate runtime configuration, or install tools automatically.
- If an included skill or recommended tool is missing, say so briefly and continue with the degree focus prompt.
- If you expand into a soft-excluded skill family, state the evidence that caused the expansion.
- If the resolver returns `ask`, ask the user to choose a degree or provide stronger task evidence.
- If the resolver returns `none`, proceed without a degree or ask whether a new degree should be authored.
