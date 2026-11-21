# Filament templates

Templates are documented presets. Applying one merges its settings into your config; upstreams and routes it adds are matched by id/match so re-applying is safe. Templates that list `requires` apply those first.

## Cursor through the official SDK (API key)

`cursor-sdk`

A second way to run Cursor's agent, next to Cursor (its CLI over ACP): the official @cursor/sdk inside Filament's process, with your Cursor API key. Offered where Settings › Experimental › Cursor through its SDK is on.

**Effects**

- New upstream `cursor-sdk` (type Cursor SDK). Paste a Cursor API key from cursor.com/dashboard → Integrations → API keys on the Upstreams page; a user key bills your Cursor plan like the IDE does.
- Route `cursor-sdk/*` → that upstream: `cursor-sdk/grok-4.6-xhigh`, `cursor-sdk/composer-2.5-fast`, `cursor-sdk/auto`; add `@plan` for plan mode.
- Needs `npm install -g @cursor/sdk` once (about 50 MB); the upstream's card has an Install button. Filament works without it and says so when it is missing.
- Set client bridge `full` on the upstream to replace Cursor's read/edit/shell/delete with Filament's tools running through your chat tool.

```json
{
  "upstreams": [
    {
      "id": "cursor-sdk",
      "name": "Cursor (official SDK)",
      "type": "cursor-sdk",
      "enabled": true,
      "apiKey": "",
      "acp": {
        "permissions": "allow-all",
        "clientBridge": "prompts",
        "thoughts": "auto",
        "toolActivity": "text",
        "cwdSource": "client",
        "mode": "agent"
      }
    }
  ],
  "routes": [
    {
      "match": "cursor-sdk/*",
      "upstream": "cursor-sdk",
      "upstreamModel": "{1}",
      "format": "auto",
      "fallbacks": [],
      "discoverPrefixes": [],
      "enabled": true,
      "rules": {}
    }
  ]
}
```

## Claude: visible thinking, real effort

`claude-visible-thinking`

Fixes the two things routers and old SDKs get wrong on Fable / Opus 5 / Sonnet 5: empty thinking text and downgraded effort.

**Effects**

- Legacy `thinking: enabled + budget_tokens` becomes `adaptive` (avoids HTTP 400 on adaptive-only models).
- `thinking.display` is set to `summarized`, so the agent shows the model's reasoning summary instead of blank blocks.
- Effort is taken from a `-xhigh`/`-max` model suffix first, then from what the agent sent, and is never silently clamped below what the model supports.
- `redact-thinking-2026-02-12` is removed from the beta header (it blanks thinking text).
- Sampling parameters that Opus 4.7+ rejects are removed.

```json
{
  "rules": {
    "thinking": {
      "mode": "client",
      "legacyToAdaptive": true,
      "display": "summarized",
      "respectClientDisplay": false
    },
    "effort": {
      "sources": [
        "suffix",
        "client",
        "default"
      ],
      "default": "none",
      "onUnsupported": "clamp"
    },
    "headers": {
      "anthropicBetaRemove": [
        "redact-thinking-2026-02-12"
      ]
    }
  }
}
```

## Direct to Anthropic

`direct-anthropic`

Talk to api.anthropic.com yourself, with prompt caching ensured and no router in between.

**Effects**

- New upstream `anthropic` (paste your Anthropic key).
- Route `claude-*` -> Anthropic.
- Cache markers are added on the system prompt and the last user message when the agent sent none, so long sessions reuse the cached prefix.
- Streams are forced on to avoid HTTP timeouts on long thinking turns; the reply is converted back if the agent asked for JSON.

Requires: `claude-visible-thinking`

```json
{
  "upstreams": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "type": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "",
      "authStyle": "x-api-key",
      "rules": {
        "cache": {
          "ensureBreakpoints": "system-and-last-user"
        },
        "params": {
          "forceStream": "on"
        }
      }
    }
  ],
  "routes": [
    {
      "match": "claude-*",
      "upstream": "anthropic",
      "upstreamModel": "{model}",
      "format": "anthropic"
    }
  ]
}
```

## Cursor as a model (via its CLI, ACP)

`cursor-via-acp`

Use Cursor's own agent and models from any chat client. The agent does the work with its own tools in your project folder; Filament relays the conversation.

**Effects**

- New upstream `cursor` of type ACP agent running `agent acp`. Install: irm 'https://cursor.com/install?win32=true' | iex
- Route `cursor/*` -> that upstream: ask for `cursor/<model id>`; the agent's model list is discovered automatically and shown on the Overview.
- The working directory is taken from the client's system prompt (`Working directory: …`, what Claude Code sends), so the agent edits the project you have open.
- Default mode `agent`; switch per message with `@plan`, `@ask`, `@agent` or the agent's own mode ids. Tool prompts are auto-approved (`permissions = allow-all`).
- Reasoning is shown as thinking blocks; one short line per tool call tells you what the agent did.
- Effort and speed are part of Cursor's model ids (…-xhigh, …-fast). Modes: agent, plan, ask. Signs in with `agent login`, or as whoever is signed in to the Cursor editor.

```json
{
  "upstreams": [
    {
      "id": "cursor",
      "name": "Cursor (agent via ACP)",
      "type": "acp",
      "baseUrl": "",
      "apiKey": "",
      "authStyle": "auto",
      "enabled": true,
      "discoverModels": true,
      "models": [],
      "rules": {},
      "acp": {
        "command": "agent",
        "args": [
          "acp"
        ],
        "env": {},
        "listModelsArgs": [
          "--list-models"
        ],
        "authenticate": false,
        "modelSelection": "arg",
        "mode": "agent",
        "modeAliases": {
          "agent": [
            "agent"
          ],
          "plan": [
            "plan"
          ],
          "ask": [
            "ask"
          ]
        },
        "permissions": "allow-all",
        "thoughts": "auto",
        "toolActivity": "text",
        "cwdSource": "client"
      }
    }
  ],
  "routes": [
    {
      "match": "cursor/*",
      "upstream": "cursor",
      "upstreamModel": "{1}",
      "format": "auto",
      "fallbacks": [],
      "discoverPrefixes": [],
      "enabled": true,
      "rules": {}
    }
  ]
}
```

## Qoder as a model (via its CLI, ACP)

`qoder-via-acp`

Use Qoder's own agent and models from any chat client. The agent does the work with its own tools in your project folder; Filament relays the conversation.

**Effects**

- New upstream `qoder` of type ACP agent running `qodercli --acp`. Install: npm install -g @qoder-ai/qodercli
- Route `qoder/*` -> that upstream: ask for `qoder/<model id>`; the agent's model list is discovered automatically and shown on the Overview.
- The working directory is taken from the client's system prompt (`Working directory: …`, what Claude Code sends), so the agent edits the project you have open.
- Default mode `yolo`; switch per message with `@plan`, `@ask`, `@agent` or the agent's own mode ids. Tool prompts are auto-approved (`permissions = allow-all`).
- Reasoning is shown as thinking blocks; one short line per tool call tells you what the agent did.
- Uses your Qoder login (`qodercli login`) and credits. Models: efficient, lite, qwen3.8-max… (see the agent's list). Modes: default, acceptEdits, auto, dontAsk, yolo.

```json
{
  "upstreams": [
    {
      "id": "qoder",
      "name": "Qoder (agent via ACP)",
      "type": "acp",
      "baseUrl": "",
      "apiKey": "",
      "authStyle": "auto",
      "enabled": true,
      "discoverModels": true,
      "models": [],
      "rules": {},
      "acp": {
        "command": "qodercli",
        "args": [
          "--acp"
        ],
        "env": {},
        "listModelsArgs": [],
        "authenticate": false,
        "modelSelection": "session",
        "mode": "yolo",
        "modeAliases": {
          "agent": [
            "yolo",
            "auto",
            "acceptEdits"
          ],
          "plan": [
            "dontAsk",
            "default"
          ],
          "ask": [
            "dontAsk",
            "default"
          ]
        },
        "permissions": "allow-all",
        "thoughts": "auto",
        "toolActivity": "text",
        "cwdSource": "client"
      }
    }
  ],
  "routes": [
    {
      "match": "qoder/*",
      "upstream": "qoder",
      "upstreamModel": "{1}",
      "format": "auto",
      "fallbacks": [],
      "discoverPrefixes": [],
      "enabled": true,
      "rules": {}
    }
  ]
}
```

## Qoder CN as a model (via its CLI, ACP)

`qoder-cn-via-acp`

Use Qoder CN's own agent and models from any chat client. The agent does the work with its own tools in your project folder; Filament relays the conversation.

**Effects**

- New upstream `qoder-cn` of type ACP agent running `qodercli --acp`. Install: npm install -g @qoder-ai/qodercli
- Route `qoder-cn/*` -> that upstream: ask for `qoder-cn/<model id>`; the agent's model list is discovered automatically and shown on the Overview.
- The working directory is taken from the client's system prompt (`Working directory: …`, what Claude Code sends), so the agent edits the project you have open.
- Default mode `yolo`; switch per message with `@plan`, `@ask`, `@agent` or the agent's own mode ids. Tool prompts are auto-approved (`permissions = allow-all`).
- Reasoning is shown as thinking blocks; one short line per tool call tells you what the agent did.
- Your qoder.cn (China) account and credits. Same CLI as the qoder upstream, started with QODERCLI_SITE=cn so it uses the .qoder-cn login, models and endpoints. Log in once via the Qoder CN desktop app or QODERCLI_SITE=cn qodercli login.

```json
{
  "upstreams": [
    {
      "id": "qoder-cn",
      "name": "Qoder CN (agent via ACP)",
      "type": "acp",
      "baseUrl": "",
      "apiKey": "",
      "authStyle": "auto",
      "enabled": true,
      "discoverModels": true,
      "models": [],
      "rules": {},
      "acp": {
        "command": "qodercli",
        "args": [
          "--acp"
        ],
        "env": {
          "QODERCLI_SITE": "cn"
        },
        "listModelsArgs": [],
        "authenticate": false,
        "modelSelection": "session",
        "mode": "yolo",
        "modeAliases": {
          "agent": [
            "yolo",
            "auto",
            "acceptEdits"
          ],
          "plan": [
            "dontAsk",
            "default"
          ],
          "ask": [
            "dontAsk",
            "default"
          ]
        },
        "permissions": "allow-all",
        "thoughts": "auto",
        "toolActivity": "text",
        "cwdSource": "client"
      }
    }
  ],
  "routes": [
    {
      "match": "qoder-cn/*",
      "upstream": "qoder-cn",
      "upstreamModel": "{1}",
      "format": "auto",
      "fallbacks": [],
      "discoverPrefixes": [],
      "enabled": true,
      "rules": {}
    }
  ]
}
```

## Claude Code as a model (via its CLI, ACP)

`claude-code-via-acp`

Use Claude Code's own agent and models from any chat client. The agent does the work with its own tools in your project folder; Filament relays the conversation.

**Effects**

- New upstream `claude-code` of type ACP agent running `claude-agent-acp`. Install: npm install -g @agentclientprotocol/claude-agent-acp
- Route `claude-code/*` -> that upstream: ask for `claude-code/<model id>`; the agent's model list is discovered automatically and shown on the Overview.
- The working directory is taken from the client's system prompt (`Working directory: …`, what Claude Code sends), so the agent edits the project you have open.
- Default mode `agent`; switch per message with `@plan`, `@ask`, `@agent` or the agent's own mode ids. Tool prompts are auto-approved (`permissions = allow-all`).
- Reasoning is shown as thinking blocks; one short line per tool call tells you what the agent did.
- Official ACP adapter over the Claude Agent SDK. Claude models only. This is the sanctioned way to use a Claude Pro/Max subscription outside claude.ai: log in once with `claude auth login`. ANTHROPIC_API_KEY works too, billed by the API.

```json
{
  "upstreams": [
    {
      "id": "claude-code",
      "name": "Claude Code (agent via ACP)",
      "type": "acp",
      "baseUrl": "",
      "apiKey": "",
      "authStyle": "auto",
      "enabled": true,
      "discoverModels": true,
      "models": [],
      "rules": {},
      "acp": {
        "command": "claude-agent-acp",
        "args": [],
        "env": {},
        "listModelsArgs": [],
        "authenticate": false,
        "modelSelection": "session",
        "mode": "agent",
        "modeAliases": {
          "agent": [
            "bypassPermissions",
            "acceptEdits",
            "default"
          ],
          "plan": [
            "plan"
          ],
          "ask": [
            "default"
          ]
        },
        "permissions": "allow-all",
        "thoughts": "auto",
        "toolActivity": "text",
        "cwdSource": "client"
      }
    }
  ],
  "routes": [
    {
      "match": "claude-code/*",
      "upstream": "claude-code",
      "upstreamModel": "{1}",
      "format": "auto",
      "fallbacks": [],
      "discoverPrefixes": [],
      "enabled": true,
      "rules": {}
    }
  ]
}
```

## Codex as a model (via its CLI, app-server)

`codex`

Use Codex's own agent and models from any chat client. The agent does the work with its own tools in your project folder; Filament relays the conversation.

**Effects**

- New upstream `codex` of type Codex running `codex app-server`. Install: npm install -g @openai/codex
- Route `codex/*` -> that upstream: ask for `codex/<model id>`; the agent's model list is discovered automatically and shown on the Overview.
- The working directory is taken from the client's system prompt (`Working directory: …`, what Claude Code sends), so the agent edits the project you have open.
- Default mode `agent`; switch per message with `@plan`, `@ask`, `@agent` or the agent's own mode ids. Tool prompts are auto-approved (`permissions = allow-all`).
- Reasoning is shown as thinking blocks; one short line per tool call tells you what the agent did.
- OpenAI's coding agent, driven over its own app-server (`codex app-server`), the interface Codex's editor extension uses. Signs in with your ChatGPT plan (`codex login`) or an OpenAI API key. Its models and their reasoning efforts, its account and its plan's usage windows come from Codex itself. Modes: agent, plan.

```json
{
  "upstreams": [
    {
      "id": "codex",
      "name": "Codex",
      "type": "codex",
      "baseUrl": "",
      "apiKey": "",
      "authStyle": "auto",
      "enabled": true,
      "discoverModels": true,
      "models": [],
      "rules": {},
      "acp": {
        "command": "codex",
        "args": [
          "app-server"
        ],
        "env": {},
        "mode": "agent",
        "permissions": "allow-all",
        "thoughts": "auto",
        "toolActivity": "text",
        "cwdSource": "client"
      }
    }
  ],
  "routes": [
    {
      "match": "codex/*",
      "upstream": "codex",
      "upstreamModel": "{1}",
      "format": "auto",
      "fallbacks": [],
      "discoverPrefixes": [],
      "enabled": true,
      "rules": {}
    }
  ]
}
```

## Qoder cloud models (your Qoder account, no CLI)

`qoder-cloud`

Talk to Qoder's cloud models (Qwen, Kimi, GLM, DeepSeek, MiniMax and Qoder's own tiers) directly with your Qoder account, the way 9router's `qd/*` provider did. Plain chat completions with tools; no agent, no working directory. For a qoder.cn (China) account, set region to china — the login page and every endpoint follow it.

**Effects**

- New upstream `qoder-cloud` of type Qoder cloud. Log in on the Upstreams page with “Log in with Qoder” (browser, PKCE device flow) or paste a personal token (pt-…, from qoder.com/account/integrations — qoder.cn in China) as the API key.
- Route `qd/*` -> that upstream: `qd/lite`, `qd/qmodel_38max`, `qd/kmodel_latest`, `qd/gmodel`, `qd/dmodel`, … The live model list from your account replaces the built-in one once logged in.
- Requests are sent in Qoder's own signed protocol; Anthropic-format clients are translated automatically (Qoder speaks OpenAI shapes).
- Uses your Qoder credits; quota is shown on the upstream card. Pasted images are uploaded to Qoder's image service and referenced by URL (small ones inline if the upload fails).

```json
{
  "upstreams": [
    {
      "id": "qoder-cloud",
      "name": "Qoder cloud",
      "type": "qoder",
      "baseUrl": "",
      "apiKey": "",
      "authStyle": "auto",
      "discoverModels": true,
      "models": [
        "ultimate",
        "auto",
        "performance",
        "efficient",
        "lite",
        "qmodel_38max",
        "qmodel_latest",
        "qmodel",
        "qfmodel",
        "kmodel_latest",
        "kmodel",
        "gmodel",
        "gfmodel",
        "dmodel",
        "dfmodel",
        "mmodel"
      ],
      "qoder": {
        "authMethod": "device"
      }
    }
  ],
  "routes": [
    {
      "match": "qd/*",
      "upstream": "qoder-cloud",
      "upstreamModel": "{1}",
      "format": "auto"
    }
  ]
}
```

## Anthropic-compatible provider or gateway

`anthropic-compatible-provider`

Forward Anthropic-format requests to any server that implements `/v1/messages` at its own address, with the same Claude fixes as the direct route.

**Effects**

- New upstream `anthropic-compat` (set its base URL and key on the Upstreams page).
- Route `compat/claude-*` -> that upstream as `claude-{1}`, so `compat/claude-sonnet-5` reaches it as `claude-sonnet-5`. Rename the prefix if you like.
- Visible-thinking and effort fixes apply; cache markers are preserved.

Requires: `claude-visible-thinking`

```json
{
  "upstreams": [
    {
      "id": "anthropic-compat",
      "name": "Anthropic-compatible gateway",
      "type": "anthropic-compatible",
      "baseUrl": "",
      "apiKey": "",
      "authStyle": "x-api-key"
    }
  ],
  "routes": [
    {
      "match": "compat/claude-*",
      "upstream": "anthropic-compat",
      "upstreamModel": "claude-{1}",
      "format": "anthropic"
    }
  ]
}
```

## OpenAI-compatible provider, minimal touch

`openai-compatible-passthrough`

Forward OpenAI-format requests to any OpenAI-compatible server (GLM, Kimi, DeepSeek, local servers) while keeping usage visible.

**Effects**

- New upstream `openai-compat` (set its base URL and key).
- Route `*` (lowest priority; put it last) -> that upstream.
- `stream_options.include_usage` is added so token usage shows up on streams.
- No thinking or effort rewriting beyond the effort suffix, which many of these servers accept as `reasoning_effort`.

```json
{
  "upstreams": [
    {
      "id": "openai-compat",
      "name": "OpenAI-compatible",
      "type": "openai-compatible",
      "baseUrl": "http://localhost:7001",
      "apiKey": "",
      "authStyle": "bearer",
      "rules": {
        "params": {
          "openaiIncludeUsage": true
        }
      }
    }
  ],
  "routes": [
    {
      "match": "*",
      "upstream": "openai-compat",
      "upstreamModel": "{model}",
      "format": "openai"
    }
  ]
}
```

## Effort by model suffix (low / medium / high / xhigh / max)

`effort-presets`

Lets any agent pick effort by model name, e.g. `claude-opus-5-max`, even if the agent has no effort setting.

**Effects**

- Suffix wins over the agent's own effort value.
- Suffix is stripped before forwarding (providers 404 on suffixed names).
- Default when neither suffix nor agent gives a value: `high`.

```json
{
  "rules": {
    "effort": {
      "sources": [
        "suffix",
        "client",
        "default"
      ],
      "default": "high",
      "stripSuffix": true
    }
  }
}
```

## Cost guard

`cost-guard`

Caps effort at `high`, caps `max_tokens`, and keeps caching on. Good default for routine work.

**Effects**

- `max` and `xhigh` are clamped to `high` (measurably cheaper on long agent sessions).
- `max_tokens` is capped at 32000 per response.
- Cache markers ensured so repeated context is billed at cache-read rates.

```json
{
  "rules": {
    "effort": {
      "allowed": [
        "low",
        "medium",
        "high"
      ],
      "onUnsupported": "clamp"
    },
    "params": {
      "maxTokensMax": 32000
    },
    "cache": {
      "ensureBreakpoints": "system-and-last-user"
    }
  }
}
```

## Maximum quality

`max-quality`

Always send effort `max` on Claude unless the agent explicitly picked something else, stream everything, never clamp.

**Effects**

- Default effort `max`; agent or suffix can still choose lower.
- `onUnsupported = clamp` still protects models that lack `max`/`xhigh`.
- Streams forced on so long turns cannot hit HTTP timeouts.

```json
{
  "rules": {
    "effort": {
      "default": "max",
      "allowed": [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ]
    },
    "params": {
      "forceStream": "on"
    }
  }
}
```

## Full observability

`full-observability`

Debugging mode: store the inbound and shaped request bodies (whole conversations) for every call.

**Effects**

- `storeBodies = full` (inbound + shaped, secrets redacted). Long agent sessions are megabytes per request, so the log file grows fast; the per-request cap still applies.
- Keep the last 2000 requests in memory for the UI.
- Switch back to `summary-logging` when done.

```json
{
  "observability": {
    "storeBodies": "full",
    "keepLastRequests": 2000
  }
}
```

## Summary logging (default)

`summary-logging`

Keep what matters per request without the conversation: what came in, what went out, and every change made.

**Effects**

- `storeBodies = summary`: model in/out, thinking in/out, effort in/out, stream flag, message and tool counts, system size, cache markers, bytes, headers sent, changes list.
- No message content is stored, so the log stays small even for very long sessions.
- Keep the last 500 requests in memory.

```json
{
  "observability": {
    "storeBodies": "summary",
    "keepLastRequests": 500
  }
}
```

## Quiet logging

`quiet-logging`

Metadata and token usage only, nothing about request contents.

**Effects**

- `storeBodies = none`: timing, status, tokens, cost and the changes list only.
- Keep the last 200 requests in memory.

```json
{
  "observability": {
    "storeBodies": "none",
    "keepLastRequests": 200
  }
}
```

