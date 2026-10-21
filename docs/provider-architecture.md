# OpenAI-first provider architecture (CTO Directive 007, priority 4)

Status: design only. No code, no API calls, no keys. Paid APIs were not used.

## Current shape (verified by reading the code)

- `src/lib/brain.ts` is a facade. `BACKEND` (config) selects either `./bridge` (WebSocket to `bridge/server.mjs`, which runs Claude through `@anthropic-ai/claude-agent-sdk` using the user's Claude Code login) or `./anthropic` (browser calls the Anthropic SDK directly).
- The facade's surface: `ask`, `warm`, `cancel`, `interrupt`, `isConnected`, `watchConnection`, `connectedLabels`, `watchServers`, `watchPanels`, `watchBlades`, `watchUi`, `watchCapture`. `AskHandlers` and `Msg` types come from `anthropic.ts` and are Anthropic-shaped (`Anthropic.Beta.BetaMessageParam`).
- Tools, MCP servers, the write gate (`decideTool`, `JARVIS_ALLOW_WRITES`) and panels live in the bridge. They are tied to the Agent SDK's tool loop.

## Goal

Make OpenAI the default reasoning provider while keeping Claude fully working, switchable by configuration, with no behaviour change when Claude is selected.

## Proposed design

1. Neutral types. Define `ChatMessage`, `AskHandlers` and `ProviderId = 'openai' | 'claude'` in `src/lib/provider/types.ts`, independent of any SDK.
2. Provider interface (`ask`, `cancel`, `interrupt`, `warm`, `connectedLabels`) implemented by `provider/claude.ts` (wraps today's `anthropic.ts`/bridge path unchanged) and `provider/openai.ts`.
3. `brain.ts` keeps its exports and delegates to the provider chosen by `VITE_PROVIDER` (default `openai` only after the OpenAI path passes acceptance below; until then default stays `claude`).
4. Bridge side: add a `bridge/providers/` module with the same two implementations. The OpenAI one needs its own tool loop (Responses API with function tools) that reuses the existing tool definitions and the same `decideTool` write gate. The gate must stay provider-independent: one function, called by both loops.
5. Keys: `OPENAI_API_KEY` is read only by the bridge from its shell environment. It never gets a `VITE_` prefix and never reaches the browser.
6. Cost guard: no provider call at startup; a configurable per-session token ceiling; the model name configurable, not hard-coded.
7. Failure behaviour: if the selected provider is unreachable or the key is missing, report it plainly in the UI and do not silently switch providers (a silent switch would change spend and data handling).

## Acceptance tests (before OpenAI becomes the default)

- Contract tests run against both providers with a fake transport (no network): same handler call sequence for text, tool call, cancel, interrupt.
- The write gate blocks the same actions under both providers when `JARVIS_ALLOW_WRITES` is unset.
- Selecting `claude` yields behaviour identical to the current branch (run the existing suite).
- One manual live test per provider by the CEO with a spending cap.

## Decisions needed from the CEO

- Approval to create/use an OpenAI API key and a monthly spend cap.
- Which OpenAI model to target (confirm current model names at implementation time).
- Whether tool use stays in the bridge only (recommended) or also in the browser-direct mode.
- Whether the browser-direct Anthropic mode is still wanted; it exposes an API key to the browser by design.
