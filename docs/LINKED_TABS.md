# Linked tabs preview

Branch: `feat/dia-linked-tab-groups`. Based on upstream commit
`a153e923bcdb1ae6bf50a2f99a7693d0bc368cf6` (3.15.2).

Fresh installations default to **Linked + domains**. Existing saved mode preferences
are retained; select Linked + domains in the popup or sidebar to try it.

- Command/Ctrl-click a web link to group it with its source. Subsequent links
  from any member join the same group, even across websites.
- Navigating, redirecting, or manually removing a tab does not reclassify it.
- The source page's title supplies the initial label, with a topic emoji inferred from that title and hostname (or 🔗 as a fallback). Existing leading emoji are preserved. Renaming keeps the group. Automatic naming does not retroactively rename existing groups. AI settings now offer an explicit Existing group picker and Refresh name action, including for manually named groups. Protected groups are excluded from renaming.
- A temporary group dissolves when only its original tab remains. A remaining
  child stays grouped if the original closes. Protected and existing manual
  groups are preserved during automatic cleanup.
- New tab in current group is available in the popup, sidebar and configurable
  keyboard shortcuts. No shortcut is assigned automatically.
- Independent tabs fall back to the existing base-domain matcher within their window. Subdomains may match. A new tab can join one unambiguous automatic group whose members all match that domain, or form a group with ungrouped same-domain peers. It never merges existing groups or adds domain matches to manually named/protected groups or mixed-domain projects.
- Pinned tabs, non-web URLs and blacklisted tabs are excluded. When an opener is pinned, closed or in another window, same-window domain fallback can still apply to its child. Ordinary custom grouping rules remain in the other modes.
- Group Tabs now organizes existing ungrouped tabs by domain in the current window, even when automatic grouping is paused. Existing groups remain intact. Ungroup All remains an explicit action.
- Manually detached tabs are excluded from domain fallback for this browser session, including after worker restarts. Opener relationships still take priority for new links opened from them.

No page content is injected or collected for this feature. The browser's opener
relationship is the signal, so programmatic new windows with an opener can also
qualify. Without an opener, only domain matching applies; unrelated cross-site tasks are not inferred.

Membership metadata lives in session storage. It survives service-worker
restarts. After a full browser restart, restored groups are treated as existing
user groups, so automatic singleton cleanup is deliberately conservative.
Initial naming is deterministic; no model is required for grouping. Optional Apple naming uses the built-in macOS 27 server and bounded tab titles/hostnames. See the setup and privacy details at the top of the [README](../README.md).

## Smaller models

The existing WebLLM 0.2.80 runtime already supports these optional models:

| Model | Weight bytes, approximately | Runtime's estimated VRAM |
| --- | --- | --- |
| SmolLM2 360M, q4f16 | 204 MB | 376 MB |
| SmolLM2 135M, q0f16 | 269 MB | 360 MB |

The UI rounds these estimates upwards. Downloads also include tokenizer and
runtime assets. The 360M model uses fewer weight bytes because it is quantized;
parameter count alone is not a download-size comparison. Both require WebGPU
with shader-f16. They are marked experimental, and the existing default is
retained pending a task-specific quality evaluation. They are available for the
existing AI rule/suggestion features, not automatic renaming of linked groups.

Sources checked September 14, 2026:

- [SmolLM2 model family](https://github.com/huggingface/smollm/blob/main/text/README.md)
- [WebLLM model registry](https://github.com/mlc-ai/web-llm/blob/main/src/config.ts)
- [360M converted weights](https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f16_1-MLC)
- [135M converted weights](https://huggingface.co/mlc-ai/SmolLM2-135M-Instruct-q0f16-MLC)

A future topic-similarity feature could use an embedding model such as
[all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2).
It produces vectors for similarity/clustering, not group names. It would need a
separate runtime and an evaluated decision threshold, so it is not a drop-in
replacement for the current text-generation provider. Opener-based membership
avoids needing that model in the first place.

## Verification

Run `bun install --frozen-lockfile`, `bun run code:check`, `bun run test`,
`bun run build:chrome`, and `bun run build:firefox`.
Browser coverage: `bunx playwright test tests/e2e/linked-tabs.e2e.ts` after building
Chrome. Tests use isolated profiles and local fixture responses, not personal
browser tabs. Firefox runtime behavior and broad model quality require separate testing.

Initial linked-mode verification on September 14, 2026 (before the Apple provider): 966 unit tests passed; code checks,
Chrome and Firefox builds passed; ten Chromium integration tests passed.
A grouping-disabled mutation was rejected by the linked-tab regression suite.
The final narrow popup was visually inspected. SmolLM2 360M loaded successfully
in an isolated Chromium profile and returned a valid Development rule covering
`github.com` and `stackoverflow.com`. This is a smoke test, not a model benchmark.
The 135M model is registry-verified but has not been exercised end to end.

Current Apple provider and fresh-site verification is recorded in [Naming evaluation](NAMING_EVALUATION.md).
