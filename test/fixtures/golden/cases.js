// @ts-check
// The golden corpus: profiles (one Filament boot each, with scripted fake upstreams) and cases (a list of steps run
// against a profile). For every step the harness captures what the client got back, what the upstreams received and
// the records Filament wrote, normalised, and compares them byte for byte with expected/<profile>.<case>.json.
// A refactoring step must leave every file unchanged; a fix step regenerates with UPDATE_GOLDEN=1 and the diff is
// the review. Keep fixtures small: their whole point is to be read when they differ.
import { anthropicReply, openaiReply, FAKE_ACP_AGENT } from "../../helpers/app.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SYS = "You are a coding assistant.\nWorking directory: C:\\demo\\goldenproj";
const A_TOOLS = [
  {
    name: "Read",
    description: "Read a file",
    input_schema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] },
  },
];
const O_TOOLS = [
  {
    type: "function",
    function: {
      name: "Read",
      description: "Read a file",
      parameters: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] },
    },
  },
];

// A conversation of completed turns with tool traffic, then a live user message.
export function convo(turns, { format = "anthropic", tag = "topic", words = 40 } = {}) {
  const out = [];
  for (let i = 0; i < turns; i++) {
    out.push({ role: "user", content: `${tag} turn ${i}: please fix file${i}.js` });
    if (format === "anthropic") {
      out.push({
        role: "assistant",
        content: [
          { type: "text", text: `Looking at file${i}.js.` },
          { type: "tool_use", id: `r${i}`, name: "Read", input: { file_path: `src/file${i}.js` } },
        ],
      });
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `r${i}`, content: `line of file${i} `.repeat(words) }],
      });
      out.push({
        role: "assistant",
        content: [
          { type: "text", text: `Fixed file${i}.js: the off-by-one on line 12 (${tag}). Tests pass.` },
        ],
      });
    } else {
      out.push({
        role: "assistant",
        content: `Looking at file${i}.js.`,
        tool_calls: [
          {
            id: `r${i}`,
            type: "function",
            function: { name: "Read", arguments: JSON.stringify({ file_path: `src/file${i}.js` }) },
          },
        ],
      });
      out.push({ role: "tool", tool_call_id: `r${i}`, content: `line of file${i} `.repeat(words) });
      out.push({
        role: "assistant",
        content: `Fixed file${i}.js: the off-by-one on line 12 (${tag}). Tests pass.`,
      });
    }
  }
  out.push({ role: "user", content: `${tag}: now what is left?` });
  return out;
}

const COMPACT_PROMPT =
  "Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.";
const SUMMARY =
  "SUMMARY: " +
  "the user asked for file fixes; each turn read one file and fixed an off-by-one on line 12; tests pass. ".repeat(
    6,
  );

// One script serves every profile: the model name says what the fake should do.
const fakeScript = () => {
  const seen = new Map();
  return (call) => {
    const model = String(call.body?.model || "");
    const n = (seen.get(model) || 0) + 1;
    seen.set(model, n);
    if (call.kind === "anthropic" || call.kind === "openai") {
      if (/^cheap/.test(model))
        return call.kind === "anthropic"
          ? anthropicReply(SUMMARY, { model })
          : openaiReply(SUMMARY, { model });
      if (/^narrow/.test(model) && n === 1)
        return {
          status: 400,
          json: {
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "prompt is too long: 9000 tokens > 2000 maximum",
            },
          },
        };
      if (/^toolcall/.test(model))
        return call.kind === "anthropic"
          ? anthropicReply("", {
              model,
              stop: "tool_use",
              blocks: [
                { type: "text", text: "Let me read it." },
                { type: "tool_use", id: "toolu_fake_1", name: "Read", input: { file_path: "src/a.js" } },
              ],
            })
          : openaiReply("Let me read it.", {
              model,
              finish: "tool_calls",
              toolCalls: [
                {
                  id: "call_fake_1",
                  type: "function",
                  function: { name: "Read", arguments: JSON.stringify({ file_path: "src/a.js" }) },
                },
              ],
            });
    }
    return undefined;
  };
};
const alwaysDown = () => ({
  status: 500,
  json: { type: "error", error: { type: "api_error", message: "fake upstream is down" } },
});

const pricing = {
  "big-1": { input: 5, output: 25 },
  "toolcall-1": { input: 5, output: 25 },
  "small-1": { input: 1, output: 1, contextTokens: 3000 },
  "narrow-1": { input: 1, output: 1 },
  "cheap-1": { input: 0.1, output: 0.4, contextTokens: 128000 },
};

// `fakes` are started per profile; `configure` receives the config and the fakes' URLs by name.
export const profiles = {
  base: {
    memory: false,
    fakes: { a: fakeScript, o: fakeScript, down: () => alwaysDown },
    configure(cfg, urls) {
      cfg.observability.storeBodies = "full";
      // fo-1's backup is tried: failover is off until switched on (the owner's of 11-09).
      cfg.rules.resilience.failover = true;
      cfg.upstreams = [
        { id: "u", name: "u", type: "anthropic-compatible", baseUrl: urls.a, apiKey: "secret-a", pricing },
        {
          id: "oa",
          name: "oa",
          type: "openai-compatible",
          baseUrl: urls.o,
          apiKey: "secret-o",
          pricing: { "oa-1": { input: 2, output: 8 }, "emb-1": { input: 0.1, output: 0 } },
        },
        { id: "down", name: "down", type: "anthropic-compatible", baseUrl: urls.down, apiKey: "secret-d" },
      ];
      cfg.routes = [
        { match: "big-*", upstream: "u", upstreamModel: "{model}" },
        { match: "toolcall-*", upstream: "u", upstreamModel: "{model}" },
        { match: "small-*", upstream: "u", upstreamModel: "{model}" },
        { match: "narrow-*", upstream: "u", upstreamModel: "{model}" },
        { match: "oa-*", upstream: "oa", upstreamModel: "{model}" },
        { match: "emb-*", upstream: "oa", upstreamModel: "{model}" },
        {
          match: "fo-1",
          upstream: "down",
          upstreamModel: "big-1",
          fallbacks: [{ upstream: "u", upstreamModel: "big-1" }],
        },
      ];
    },
  },
  memory: {
    memory: true,
    summarizer: "cheap-1",
    fakes: { a: fakeScript, o: fakeScript },
    configure(cfg, urls) {
      cfg.observability.storeBodies = "full";
      cfg.upstreams = [
        { id: "u", name: "u", type: "anthropic-compatible", baseUrl: urls.a, apiKey: "secret-a", pricing },
        {
          id: "oa",
          name: "oa",
          type: "openai-compatible",
          baseUrl: urls.o,
          apiKey: "secret-o",
          pricing: { "oa-1": { input: 2, output: 8 } },
        },
      ];
      cfg.routes = [
        { match: "big-*", upstream: "u", upstreamModel: "{model}" },
        { match: "cheap-*", upstream: "u", upstreamModel: "{model}" },
        { match: "oa-*", upstream: "oa", upstreamModel: "{model}" },
      ];
    },
  },
  acp: {
    memory: false,
    fakes: {},
    configure(cfg, urls, { dataDir }) {
      cfg.observability.storeBodies = "full";
      cfg.upstreams = [
        {
          id: "agent",
          name: "fake agent",
          type: "acp",
          acp: {
            command: process.execPath,
            args: [FAKE_ACP_AGENT],
            env: {},
            cwdDefault: dataDir,
            thoughts: "thinking-block",
            toolActivity: "text",
            permissions: "allow-all",
            hints: false,
          },
        },
      ];
      cfg.routes = [{ match: "agent-*", upstream: "agent", upstreamModel: "{model}" }];
    },
  },
};

const A = (model, messages, extra = {}) => ({ model, max_tokens: 64, system: SYS, messages, ...extra });
const O = (model, messages, extra = {}) => ({
  model,
  max_tokens: 64,
  messages: [{ role: "system", content: SYS }, ...messages],
  ...extra,
});
const sid = (id) => ({ "x-session-id": id });
const post = (path, body, headers = {}) => ({ post: path, body, headers });

export const cases = [
  // ---- base: wire formats, translation, shaping, failover, auto-fit, the other endpoints ------------------------------
  {
    profile: "base",
    name: "anthropic-plain",
    steps: [post("/v1/messages", A("big-1", [{ role: "user", content: "hello" }]))],
  },
  {
    profile: "base",
    name: "anthropic-stream",
    steps: [post("/v1/messages", A("big-1", [{ role: "user", content: "hello" }], { stream: true }))],
  },
  {
    profile: "base",
    name: "anthropic-tools-and-results",
    steps: [post("/v1/messages", A("toolcall-1", convo(1), { tools: A_TOOLS }))],
  },
  {
    profile: "base",
    name: "anthropic-thinking-and-image",
    steps: [
      post(
        "/v1/messages",
        A(
          "big-1",
          [
            {
              role: "user",
              content: [
                { type: "text", text: "what is in this image?" },
                { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
              ],
            },
            {
              role: "assistant",
              content: [
                { type: "thinking", thinking: "a small png", signature: "sig" },
                { type: "text", text: "A tiny image." },
              ],
            },
            { role: "user", content: "and now?" },
          ],
          { thinking: { type: "enabled", budget_tokens: 1024 }, max_tokens: 2048 },
        ),
      ),
    ],
  },
  {
    profile: "base",
    name: "openai-plain",
    steps: [post("/v1/chat/completions", O("oa-1", [{ role: "user", content: "hello" }]))],
  },
  {
    profile: "base",
    name: "openai-stream",
    steps: [post("/v1/chat/completions", O("oa-1", [{ role: "user", content: "hello" }], { stream: true }))],
  },
  {
    profile: "base",
    name: "openai-tools-and-results",
    steps: [post("/v1/chat/completions", O("oa-1", convo(1, { format: "openai" }), { tools: O_TOOLS }))],
  },
  {
    profile: "base",
    name: "translate-anthropic-to-openai",
    steps: [post("/v1/messages", A("oa-1", convo(1), { tools: A_TOOLS }))],
  },
  {
    profile: "base",
    name: "translate-anthropic-to-openai-stream",
    steps: [post("/v1/messages", A("oa-1", [{ role: "user", content: "hello" }], { stream: true }))],
  },
  {
    profile: "base",
    name: "translate-openai-to-anthropic",
    steps: [
      post("/v1/chat/completions", O("toolcall-1", convo(1, { format: "openai" }), { tools: O_TOOLS })),
    ],
  },
  {
    profile: "base",
    name: "translate-openai-to-anthropic-stream",
    steps: [post("/v1/chat/completions", O("big-1", [{ role: "user", content: "hello" }], { stream: true }))],
  },
  {
    profile: "base",
    name: "model-suffix-effort",
    steps: [
      post("/v1/messages", A("big-1-high", [{ role: "user", content: "think hard" }], { max_tokens: 4096 })),
    ],
  },
  {
    profile: "base",
    name: "failover-primary-down",
    steps: [post("/v1/messages", A("fo-1", [{ role: "user", content: "hello" }]))],
  },
  {
    profile: "base",
    name: "window-known-over-it-request-goes-out-whole",
    steps: [post("/v1/messages", A("small-1", convo(6, { words: 120 })))],
  },
  {
    profile: "base",
    name: "provider-refusal-reaches-the-client-whole",
    steps: [post("/v1/messages", A("narrow-1", convo(4)))],
  },
  {
    profile: "base",
    name: "count-tokens",
    steps: [post("/v1/messages/count_tokens", { model: "big-1", system: SYS, messages: convo(2) })],
  },
  {
    profile: "base",
    name: "embeddings",
    steps: [post("/v1/embeddings", { model: "emb-1", input: ["hello", "world"] })],
  },
  { profile: "base", name: "models-list", steps: [{ get: "/v1/models" }] },
  {
    profile: "base",
    name: "responses-passthrough",
    steps: [
      post("/v1/responses", {
        model: "oa-1",
        input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
        max_output_tokens: 64,
      }),
    ],
  },
  {
    profile: "base",
    // An outside client's chat is a plain proxy with memory (the owner's rules of 10-31): its `/status` and `/help` go
    // to its model as typed.
    name: "commands-without-memory",
    steps: [
      post("/v1/messages", A("big-1", [{ role: "user", content: "/status" }])),
      post("/v1/messages", A("big-1", [{ role: "user", content: "/help" }])),
    ],
  },
  {
    profile: "base",
    name: "auth-rejected",
    steps: [
      {
        post: "/v1/messages",
        body: A("big-1", [{ role: "user", content: "hello" }]),
        headers: { "x-api-key": "wrong", authorization: "Bearer wrong" },
      },
    ],
  },
  {
    profile: "base",
    name: "unknown-model",
    steps: [post("/v1/messages", A("nobody-1", [{ role: "user", content: "hello" }]))],
  },

  // ---- memory: the prepare pass, the commands, the compaction paths ------------------------------------------------------
  {
    profile: "memory",
    name: "memory-first-turns",
    steps: [
      post(
        "/v1/messages",
        A("big-1", [{ role: "user", content: "alpha: let us fix the parser in src/parse.js" }]),
        sid("g-mem-1"),
      ),
      post(
        "/v1/messages",
        A("big-1", [
          { role: "user", content: "alpha: let us fix the parser in src/parse.js" },
          { role: "assistant", content: "MODEL ANSWER" },
          { role: "user", content: "alpha: now the lexer" },
        ]),
        sid("g-mem-1"),
      ),
    ],
  },
  {
    profile: "memory",
    // An outside client's chat is a plain proxy with memory: its `/status`, `/cost` and `/help` go to its model as typed,
    // and memory's `@mem …` is answered by Filament.
    name: "commands-with-memory",
    steps: [
      post("/v1/messages", A("big-1", convo(2, { tag: "cmd" })), sid("g-cmd-1")),
      ...[
        "/status",
        "/cost",
        "/help",
        "@mem help",
      ].map((c) =>
        post(
          "/v1/messages",
          A("big-1", [...convo(2, { tag: "cmd" }).slice(0, -1), { role: "user", content: c }]),
          sid("g-cmd-1"),
        ),
      ),
    ],
  },
  {
    profile: "memory",
    name: "commands-openai-format",
    steps: [
      post("/v1/chat/completions", O("oa-1", [{ role: "user", content: "/status" }]), sid("g-cmd-oa")),
      post(
        "/v1/chat/completions",
        O("oa-1", [{ role: "user", content: "@mem help" }], { stream: true }),
        sid("g-cmd-oa"),
      ),
    ],
  },
  {
    profile: "memory",
    // A client's compaction goes to its own model as it sent it, with what memory adds to every request of its session
    // (the owner's rules of 10-31: a plain proxy plus memory).
    name: "compaction-to-client-model",
    steps: [
      post("/v1/messages", A("big-1", convo(6, { tag: "work", words: 60 })), sid("g-trim-1")),
      post(
        "/v1/messages",
        A("big-1", [
          ...convo(6, { tag: "work", words: 60 }).slice(0, -1),
          { role: "user", content: COMPACT_PROMPT },
        ]),
        sid("g-trim-1"),
      ),
      post(
        "/v1/messages",
        A(
          "big-1",
          [...convo(6, { tag: "work", words: 60 }).slice(0, -1), { role: "user", content: COMPACT_PROMPT }],
          { stream: true },
        ),
        sid("g-trim-1"),
      ),
    ],
  },
  {
    profile: "memory",
    name: "memory-off-header-quiet",
    steps: [
      post("/v1/messages", A("big-1", [{ role: "user", content: "quiet: hello" }]), {
        ...sid("g-quiet-1"),
        "x-filament-memory": "off",
      }),
    ],
  },
  {
    // A native session's turns (Step 3): what the composer sends for the second turn — turn one's messages as
    // stored, then the new one — captured so the reconciling work later in the step cannot change it silently.
    profile: "memory",
    name: "session-turn-compose",
    steps: [
      {
        name: "create-and-two-turns",
        run: async (env) => {
          // A fixed folder under the (masked) data dir, so the project's name is not the random temp basename.
          const cwd = join(env.app.dataDir, "sessionproj");
          mkdirSync(cwd, { recursive: true });
          const made = await env.app.api("/api/sessions", {
            method: "POST",
            body: { cwd, model: "big-1" },
          });
          const row = await made.json();
          if (!row?.id) return { status: made.status, body: row };
          const turn = (content) =>
            env.app.api(`/api/sessions/${encodeURIComponent(row.id)}/turns`, {
              method: "POST",
              body: { content, stream: false },
            });
          await turn("first message in the harness session");
          const second = await turn("second message in the harness session");
          return { status: made.status, body: { ok: second.status === 200, turns: 2 } };
        },
      },
    ],
  },

  // ---- acp: one agent turn, both ways the client can read it ---------------------------------------------------------
  {
    profile: "acp",
    // An outside client's chat is a plain proxy with memory: its `/sessions` goes to its agent as typed.
    name: "acp-turn",
    steps: [
      post("/v1/messages", A("agent-1", [{ role: "user", content: "hello agent" }]), sid("g-acp-1")),
      post(
        "/v1/messages",
        A(
          "agent-1",
          [
            { role: "user", content: "hello agent" },
            { role: "assistant", content: "done" },
            { role: "user", content: "and again" },
          ],
          { stream: true },
        ),
        sid("g-acp-1"),
      ),
      post("/v1/chat/completions", O("agent-1", [{ role: "user", content: "/sessions" }]), sid("g-acp-1")),
    ],
  },
];
