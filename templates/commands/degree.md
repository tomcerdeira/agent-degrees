# `/degree <task>` Command Template

Use this as the body for a custom command in an agent that supports slash/custom commands.

## Purpose

Resolve the requested task against `agent-degrees` and return the selected degree prelude.

## Command Body

````md
Resolve this task with agent-degrees before doing implementation work:

Task:
<COMMAND_ARGUMENTS>

Run:

```sh
npm --prefix "<AGENT_DEGREES_REPO>" run resolve -- --task "<COMMAND_ARGUMENTS>"
```

If relevant files, commands, logs, or errors are already known, include them as `--file` and `--command` arguments.

Return the resolver output first, then proceed with the task under the selected degree. If the resolver returns `ask`, ask the user to choose. If it returns `none`, proceed without a degree and mention that no degree matched.
````
