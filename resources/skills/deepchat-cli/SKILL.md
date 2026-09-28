---
name: deepchat-cli
description: Use MauWork's bundled CLI control plane for model inference, image/video/speech generation, transcription, OCR, artifact inspection, public configuration, Skills, and MCP operations. Activate when a user asks to invoke MauWork capabilities that are not already exposed as a more specific tool, compare models, run a benchmark, inspect MauWork runtime state, or manage MauWork through the CLI.
allowedTools:
  - exec
  - process
---

# MauWork CLI

Use the bundled `mauwork` command to ask the running MauWork main process to perform supported
operations. The main process remains the sole owner of providers, credentials, Skills, MCP servers,
artifacts, Agent runs, and approvals.

## Command rules

- Every command must begin exactly with `mauwork <domain> <verb>`. Put `--json`, `--jsonl`,
  `--timeout`, and all domain options after the domain and verb.
- Execute one standalone command per `exec` call. Do not use pipes, redirection, command separators,
  command substitution, environment assignments, or shell wrappers around `mauwork`.
- Quote every user-controlled argument for the current shell. Never interpolate untrusted text into
  an unquoted command.
- Prefer `--json` for one result and `--jsonl` for streaming or benchmark collection. Use text mode
  only when its output will be returned directly to the user.
- Do not inspect authentication environment variables or MauWork's local descriptor. Authorization
  is injected only after the command has passed the normal shell permission check.
- A shell approval authorizes command execution. Sensitive mutations can additionally pause for a
  renderer approval; wait for that decision and never attempt to manufacture confirmation data.
- Use `mauwork help` or `mauwork <domain> <verb> --help` only when the options below are
  insufficient. Do not probe undocumented routes.

## Agent file and recursion boundaries

- Agent callers may consume a MauWork-owned artifact with `--artifact <id>` and inspect metadata
  with `artifact describe`.
- Do not use `--file`, `--out`, `--overwrite`, `artifact get`, or `artifact delete`. Agent callers
  cannot upload arbitrary local bytes, download artifact bytes, or choose output paths.
- Do not call `agent run` or `run watch`. An Agent cannot recursively create a detached Agent run,
  and waiting on its own currently executing run would deadlock it. Use `run get` for a nonblocking
  snapshot or `run cancel` to request cancellation.
- Generated media remains in MauWork's artifact spool. Return the artifact metadata or ID so the
  application can render or reuse it.

## Discovery and model calls

```text
mauwork system status --json
mauwork system capabilities --json
mauwork system doctor --json
mauwork provider list --enabled-only --json
mauwork model list --provider <provider-id> --json
mauwork model config-get --provider <provider-id> --model <model-id> --json
mauwork model invoke --provider <provider-id> --model <model-id> --prompt <quoted-text> --jsonl
```

Always discover provider and model IDs rather than guessing them. `model invoke` is a raw provider
call: it does not create a chat session, run tools, or start an Agent loop.

## Media, transcription, and OCR

```text
mauwork image generate --provider <provider-id> --model <model-id> --prompt <quoted-text> --jsonl
mauwork video generate --provider <provider-id> --model <model-id> --prompt <quoted-text> --jsonl
mauwork audio speak --provider <provider-id> --model <model-id> --text <quoted-text> --jsonl
mauwork audio transcribe --provider <provider-id> --model <model-id> --artifact <artifact-id> --json
mauwork ocr status --json
mauwork ocr extract --artifact <artifact-id> --json
mauwork artifact describe --id <artifact-id> --json
```

Use the provider/model lists to choose a compatible runtime. OCR is local and does not require a
provider. OCR text is returned inline and is not written to the artifact spool.

## Public configuration and management

Read-only operations:

```text
mauwork settings get --json
mauwork skill list --json
mauwork mcp list --json
```

Agent callers may request renderer approval for preference-only settings, query-free HTTPS Skill
installation, and adding a new disabled HTTPS remote MCP configuration. Only perform one when it
directly satisfies the user's request:

```text
mauwork settings set --key <public-key> --value <json-scalar> --json
mauwork skill install --url <https-url> --json
mauwork mcp add --name <server-name> --stdin --json
```

The Agent setting allowlist is limited to presentation preferences such as font size/family,
artifact effects, auto-scroll, notifications, and copy-with-reasoning. Agent Skill URLs cannot carry
credentials, query parameters, or fragments. The main process classifies MCP input before approval
and rejects stdio commands, non-HTTPS endpoints, headers, authorization bindings, or configurations
too large to review safely. Provider/model configuration, credential writes, local Skill archives,
Skill enable/disable/removal, MCP update/runtime control/removal, and every destructive operation
require the MauWork UI or a human terminal.

## Benchmark discipline

- Pin provider/model IDs and pass per-invocation options; do not mutate global defaults to prepare a
  benchmark.
- Record structured output, exit status, wall time, and errors. Preserve failed samples.
- For OCR, distinguish cache hit, cache miss with warm runtime, cold runtime after app restart, and
  offline availability. `ocr clear-cache` initializes the resource graph but does not start the OCR
  helper, so classify the next extraction from its reported pre-extraction runtime state.
- Run samples sequentially unless the benchmark explicitly measures concurrency; Agent compute is
  rate-limited and bounded by the main process.
