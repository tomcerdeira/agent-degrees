# Agent Degrees

Run an agent-degrees preflight before non-trivial implementation, debugging, review, or research work.

Configured repo:

```text
<AGENT_DEGREES_REPO>
```

Command shape:

```sh
npm --prefix "<AGENT_DEGREES_REPO>" run resolve -- \
  --task "<user task>" \
  --file "<relevant file>" \
  --command "<relevant command>"
```

Use the resolver output as task-local guidance:

- `select` or `compose`: start from the matched degree prompt.
- `ask`: ask the user to choose or provide stronger evidence.
- `none`: proceed without a degree or suggest authoring one.

Treat included skills as a shortlist, recommended tools as optional evidence sources, and soft exclusions as advisory boundaries.
