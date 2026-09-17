# AI Report Analysis Application

A standalone Next.js portfolio project for asking questions across research and intelligence reports a user is authorized to access, then answering from that evidence with a visible source trail. It is not affiliated with a research provider. Every bundled report, company, market figure, and forecast is fictional.

Reports stay in the server-only `data/reports` directory. **Third-party reports and all local session, chat, audit, and purchase data are excluded from this repository.** Fully synthetic examples are provided under `examples/reports/`; their content is illustrative, not real market research. A request must cross the signed-session and entitlement boundaries before the relevant file is opened:

```text
signed session → AI routes safe catalog metadata → deterministic entitlement intersection
                                                    ↓
                              approved file read → evidence ranking → cited OpenAI answer
                                                    ↘ denied files are never opened
```

## What the demo proves

- **Server-derived identity.** The browser establishes a signed, expiring, HTTP-only demo session. Chat, context, audit, and report-view routes derive identity from that cookie and reject per-request identity overrides.
- **AI-first report routing.** OpenAI selects candidate report IDs from safe manifest metadata using a strict structured-output schema. Its output is treated as untrusted and cannot grant access; metadata matching is the resilient fallback.
- **Report-level permissions.** Three simulated identities receive configurable access across registered reports. Authorization is centralized and enforced before retrieval, not only in the UI.
- **Quarantined report intake.** Add or remove HTML, Markdown, or text files without changing application code. A new file remains unopened and unindexed until its filename has a manifest entry in `data/reports.config.json`.
- **Grounded retrieval.** The server parses the authorized reports, ranks relevant sections, and sends only the top evidence passages to the AI layer.
- **Claim-level provenance.** Answers carry source IDs, report codes, section names, evidence excerpts, and relevance indicators. Click a supported figure such as `62.5%` to jump to that exact highlighted value, or use the viewer arrows to move through multiple source passages and calculation inputs.
- **Fast source previews.** Evidence opens as a compact extract of the original report section instead of processing the entire multi-megabyte document. The complete report remains available on demand from the same viewer.
- **A safe failure mode.** Unsupported questions and unlicensed requests stop with a clear explanation instead of a fabricated answer.
- **Operational visibility.** Each request exposes its identity, authorization, retrieval, grounding, and generation steps and appends a reason-coded audit event to `.data/report-analysis-audit-events.jsonl`.
- **Server-driven progress.** The chat route streams each workflow completion as it happens, so loading checkmarks reflect real backend milestones rather than a presentation timer.
- **Saved conversation threads.** A prominent “New chat” action sits at the top of the left sidebar, followed by up to 20 conversations per signed demo identity. A submitted user message is shown and persisted before AI routing begins, then the completed answer, citations, and workflow metadata are attached to that turn. Clicking a title restores its thread, current entitlements are rechecked before cited turns are returned, and the identity menu can clear all of that user's threads. Each conversation retains its latest 25 turns.
- **Simulated report purchasing.** A denied answer includes server-owned report pricing and a clearly labeled fake checkout. Completing it adds a durable demo entitlement for the signed identity, refreshes the library, and offers to retry the original question once every missing report is accessible. Fake billing fields remain in the browser and are never submitted.
- **Abuse controls.** Chat payloads are schema- and size-limited and each signed session receives a bounded request quota.
- **OpenAI integration with a no-key fallback.** With `OPENAI_API_KEY`, the app uses the Responses API. Without it, deterministic grounded demo answers keep the full workflow testable.

## Run it

Requirements: Node.js 20.9+ (this workspace currently uses Node 24).

```powershell
npm ci
Copy-Item .env.example .env.local
Copy-Item examples/reports/*.html data/reports/
npm run dev
```

Only copy the example files on a fresh checkout; do not overwrite your own local reports. The synthetic files use the two configured filenames so the demo, viewer, and tests can run without third-party documents. Their figures are invented and should not be used as research. Open [http://localhost:3000](http://localhost:3000). If that port is occupied, use the alternate URL printed by Next.js. To enable live generation, add a server-side `OPENAI_API_KEY` to `.env.local`. `OPENAI_MODEL` defaults to `gpt-5-mini` and can be changed without touching application code.

With a valid key, every submitted question first makes a fresh metadata-only routing call and, if authorized evidence is found, a second grounded-answer call. Routing decisions are not cached. `OPENAI_ROUTER_MODEL` can select a separate routing model, `OPENAI_ROUTER_TIMEOUT_MS` controls the fallback deadline, and `OPENAI_ROUTING_ENABLED=false` disables AI routing without disabling answer generation.

Set `SESSION_SECRET` to a random value of at least 32 characters before deploying. Development has a local-only fallback so the demo remains one-command runnable; production startup refuses to create sessions without an explicit secret.

## Adding your own reports

1. Copy a `.html`, `.htm`, `.md`, `.markdown`, or `.txt` file into `data/reports`.
2. Register its exact filename under `reports` in `data/reports.config.json` and assign `allowedUsers`.
3. Restart `npm run dev` after adding or removing files.

Until step 2 is complete, the file is quarantined: the app may see its filename while enumerating the directory, but it will not open, index, display, or send its contents anywhere. Searchable metadata is derived only from the manifest and basic filesystem metadata—not from an unauthorized content preview.

Register metadata and simulated access under `reports` using the exact filename:

```json
{
  "reports": {
    "my-new-report.md": {
      "code": "EXAMPLE-2026-01",
      "shortTitle": "My New Report",
      "geography": "Canada",
      "category": "Custom research",
      "priceCents": 19900,
      "allowedUsers": ["alex", "jordan"],
      "keywords": ["canada", "custom topic", "competitor name"]
    }
  }
}
```

The demo user IDs are `alex`, `jordan`, and `taylor`. Configuration for a file that is not present is ignored. Files beginning with `.` or `_`, plus the folder's `README.md`, are intentionally ignored.

## Demo identities

| Identity | Organization | Initial report access |
| --- | --- | --- |
| Alex Morgan | Clearview Insights | Both supplied reports |
| Jordan Lee | Clearview Insights | Grid Storage Outlook only |
| Taylor Chen | Vector Labs | Warehouse Robotics Outlook only |

For the clearest entitlement demo, switch to Jordan and ask: “Who leads the warehouse robotics market?” The API denies the retrieval, returns no report text, and records the attempt. Then ask a grid storage question and watch the same account complete the authorized flow. The purchase option can add the robotics report to Jordan's demo entitlements.

## Verification

```powershell
npm run typecheck
npm test
npm run build
```

## Project map

- `app/api/purchases/route.ts` — validates report IDs, resolves prices server-side, and records simulated entitlements for the signed identity.
- `lib/demo-purchases.ts` — serializes identity-scoped simulated purchase records under `.data/demo-purchases`.

- `app/api/session/route.ts` — creates and clears signed, HTTP-only demo sessions.
- `app/api/chat/route.ts` — validates and rate-limits requests, then streams the route → authorize → retrieve → answer → audit workflow.
- `app/api/history/route.ts` — lists, restores, or clears only the signed identity's stored conversation threads.
- `app/api/reports/[reportId]/view/route.ts` — permission-checks and serves a sandboxed source report viewer.
- `data/reports/` — hot-swappable server report directory (contents excluded from Git).
- `examples/reports/` — fictional example reports; copy into `data/reports/` on a fresh checkout.
- `data/reports.config.json` — required registration metadata and report entitlements.
- `lib/session.ts` and `lib/access-control.ts` — signed-session verification and server-derived request identity.
- `lib/chat-history.ts` — bounded, identity-scoped thread persistence with legacy-history migration and serialized, deduplicated turn writes.
- `lib/report-router.ts` — fresh structured AI routing over safe manifest metadata with a resilient metadata fallback.
- `lib/report-registry.ts` — manifest-first discovery, quarantine handling, format filtering, and authorized file reads.
- `lib/permissions.ts` — central entitlement logic.
- `lib/retrieval.ts` — local HTML/text/Markdown parsing, chunking, cache invalidation, and evidence ranking.
- `lib/answer.ts` — prompt construction, OpenAI Responses API call, citations, and deterministic fallback.
- `components/research-app.tsx` — responsive assistant, library, identity switcher, evidence view, and audit trail.
- `tests/` — registry, entitlement, and retrieval boundary coverage.

## Security choices in the prototype

- The API key is read only on the server and is never prefixed with `NEXT_PUBLIC_`.
- Client-supplied file paths and report IDs are never accepted; the server discovers basenames inside one fixed directory and validates resolved paths before reading.
- Client-supplied identity values are rejected by protected routes; identity comes from an HMAC-signed, expiring cookie marked `HttpOnly`, `SameSite=Strict`, and `Secure` in production.
- Conversation context is reloaded on the server for the signed identity; browser-supplied history is not trusted as conversational state.
- New, unregistered files are quarantined. Report contents are not inspected to infer metadata before authorization.
- The routing model receives catalog metadata only, never report bytes or ACLs. Every returned report ID is validated and intersected with server-side entitlements.
- Permissions are evaluated before the report is read, and the file reader accepts only authorization-branded report objects.
- Proprietary excerpts are treated as untrusted data in the model prompt.
- OpenAI response storage is disabled with `store: false` for the live demo call.
- Raw reports do not live in `public/`, and there is no report-download endpoint.
- Source viewing repeats the server-side entitlement check, removes executable HTML, applies a restrictive content security policy, and renders inside a sandboxed frame.
- Chat is rate-limited per signed session, and durable audit records include explicit allow/deny reason codes.

## What would change for production

This remains a prototype rather than a deployed identity system: anyone using the UI may intentionally switch among the three demo identities. A real deployment should replace that switcher with SSO, store sessions, conversations, entitlements, and audits in a database, move the in-memory rate limiter to shared infrastructure, and use tenant-scoped private object storage and a vector/structured retrieval service. The front-end can remain Next.js while those services evolve independently.
