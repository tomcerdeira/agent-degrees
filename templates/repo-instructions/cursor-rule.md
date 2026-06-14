# Agent Degrees Cursor Rule

Apply this rule to coding, debugging, review, research, and automation tasks that are not trivial one-line edits.

Before starting, resolve the task against the local `agent-degrees` repo:

```sh
npm --prefix "<AGENT_DEGREES_REPO>" run resolve -- \
  --task "<user task>" \
  --file "<relevant file>" \
  --command "<relevant command>"
```

Use the resolver output as a task-local prelude. Load only the matched degree's guidance, then map included skill ids and recommended tools to what is available in this Cursor workspace.

Do not treat soft exclusions as refusals. They only keep unrelated context out until user intent or code evidence justifies expansion.
