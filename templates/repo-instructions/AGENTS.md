# Agent Degrees

Before non-trivial work, run an agent-degrees preflight.

Use the local `agent-degrees` repo at:

```text
<AGENT_DEGREES_REPO>
```

Resolve the task with the smallest useful evidence set:

```sh
npm --prefix "<AGENT_DEGREES_REPO>" run resolve -- \
  --task "<user task>" \
  --file "<relevant file>" \
  --command "<relevant command>"
```

Use the selected degree as task-local guidance. Map included skill ids and recommended tools to what is actually available in this agent/runtime. Keep soft-excluded skills out of initial context unless the user asks for them or concrete code evidence requires them.

Agent degrees are advisory. They do not hide skills, enforce choices, install tools, or override repository/user/system instructions.
