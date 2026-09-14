# Auto Tab Groups — linked browsing fork

This is [thesammykins/auto-tab-groups](https://github.com/thesammykins/auto-tab-groups), an experimental fork of [nitzanpap/auto-tab-groups](https://github.com/nitzanpap/auto-tab-groups), inspired by Dia's linked browsing workflow. It is not affiliated with Dia or Apple. Development branch: `feat/dia-linked-tab-groups`, based on upstream 3.15.2 (`a153e923bcdb1ae6bf50a2f99a7693d0bc368cf6`). The store links and CI badge in the original README below refer to **upstream**, not this fork or its validation.

## What changes in this fork

- **Linked + domains is the default for fresh installs.** Existing saved mode preferences remain intact. Select Linked + domains in the popup/sidebar to opt in on an existing installation. Domain and custom-rule modes remain available.
- Opening a link in a new tab groups it with its source across websites. Further links join that group. Independently opened tabs fall back to domain matching within the same window. Domain matching can extend one automatic group whose members all share that domain, or create a group from ungrouped peers; it does not merge mixed projects or manually named/existing groups. Domains use the extension’s existing base-domain rules (subdomains may match). Navigation does not reclassify tabs, and manually detached tabs are excluded from later domain matching during this browser session.
- **Group Tabs works on existing tabs:** in Linked + domains mode it groups eligible ungrouped tabs by domain in the current window. Existing groups stay intact.
- **Refresh an existing group name:** in AI settings, connect Apple, choose an Existing group, then click Refresh name. The model evaluates the current tabs and either retains the label or updates its emoji/title. This explicit action works on existing and manually named groups without making them subject to later automatic renaming. Protected groups are not renamed; results are discarded if the group changes during inference.
- New groups get a short source-page label and a topic emoji, with 🔗 as the fallback. This works without any model. A new-tab-in-current-group button and configurable keyboard command are included.
- Temporary groups dissolve when only their original source remains. Manually renamed, protected, and pre-existing groups are preserved. A remaining child stays grouped when its source closes.
- **Optional Apple Foundation Models naming** re-evaluates the current label when tabs are added or their titles change. It uses titles and hostnames of up to 12 tabs, prioritizing new/changed subjects, to retain a fitting label or suggest one emoji and a more accurate shared topic. Labels are limited to 48 visible characters including emoji and space; prompts favor specific 3–7 word titles, useful detail over padding, and stable wording. The browser may still truncate labels visually depending on tab-strip space. It does not read page bodies or send URL paths, queries, or fragments for naming. Automatic naming updates only groups created by this session; manual renames take precedence. The explicit Refresh name action can evaluate existing groups too.
- Experimental SmolLM2 360M and 135M choices are available for existing WebLLM rule/suggestion features. These do not drive automatic linked-group naming. See [model sizes and tradeoffs](docs/LINKED_TABS.md#smaller-models).

## Install and try it

Build from this branch with Bun:

```sh
bun install --frozen-lockfile
bun run build:chrome
python3 scripts/package_preview.py --browser chrome
```

In a Chromium browser's extension manager, enable Developer mode, choose **Load unpacked**, and select `.output/chrome-mv3`. If using a preview ZIP, extract it first and select the directory containing `manifest.json`. Disable any other installed copy of Auto Tab Groups while testing to avoid competing grouping actions. Fork ZIPs are unpacked previews, not signed store releases. The installed name is **Auto Tab Groups — Linked**, and Firefox uses its own fork add-on ID so it does not reuse the author’s store identity.

Firefox builds use `bun run build:firefox`. The linked workflow builds for Firefox, but this preview's browser runtime verification is Chromium-only. Apple AI settings are currently Chromium-only.

### Apple models on macOS 27

Requires an Apple Intelligence-capable Mac, an available system model, and macOS's built-in `fm` command. In Terminal:

```sh
fm available
fm serve --host 127.0.0.1 --port 1976
```

Complete any Apple license/setup steps yourself if prompted. Keep the server running while using Apple naming. In the extension's AI settings, enable AI, select **Apple Foundation Models (macOS 27, built-in server)**, click **Connect**, and allow localhost access and the requested network-rule permission. Then open linked tabs to trigger naming.

There is no companion helper app or separate model download managed by this extension. A local server process is still required: the browser calls Apple's built-in server, not the Swift framework directly. The endpoint is fixed to `http://127.0.0.1:1976`, uses the `system` model, and rejects redirects. The optional browser host permission covers `127.0.0.1` because extension permissions cannot restrict ports; requests from this provider use only port 1976. Apple’s server rejects cross-site browser headers. On Connect, a session-only `declarativeNetRequestWithHostAccess` rule removes `Origin` and `Sec-Fetch-Site` only for POST requests initiated by this extension to the exact completion endpoint. It does not change requests from websites or other extensions. Disconnect removes the rule. This compatibility workaround was verified against the built-in server; it may need revision as macOS changes. See [Chrome’s network-rule API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest).

**Aside connection troubleshooting (September 14, 2026):** We reproduced an installation stuck at “Loading 0%”: localhost permission and model listing worked, but the browser left network-rule updates pending. Reloading only this extension, then clicking Connect again, restored the rule and real Apple inference (HTTP 200). The underlying browser stall is not yet explained. Rule reads and updates time out after 10 seconds with a retryable error instead of leaving the UI indefinitely loading. Reconnects now reuse an exactly matching installed session rule, including after background worker restarts, and concurrent connection requests share one attempt. The updated installed extension was tested in Aside with three disconnect/reconnect cycles, an HTTP 200 Apple completion, and a real group-name refresh on two temporary MDN tabs. These checks passed; they do not establish that the intermittent native-browser stall can never recur. When updating an unpacked install, check the extension manager’s **Loaded from** path: extracting a ZIP again can create a second directory that is different from the one the browser is using. If this happens, reload Auto Tab Groups in the extension manager and reconnect; restarting the already-healthy `fm serve` process did not address this failure.

Tab titles can contain private information and are passed to that local server when Apple naming is enabled.

**Disconnect** stops this extension from requesting Apple naming; it does not terminate your Terminal process. After a full browser restart, reconnect in AI settings. If the server is unavailable, linked grouping and deterministic emoji labels continue to work, and AI settings display the connection error. Connecting does not retroactively rename all existing groups. Automatic naming is best-effort and debounced; background worker suspension may delay it until another tab event.

Apple API references: [Foundation Models developer tools (WWDC26)](https://developer.apple.com/videos/play/wwdc2026/334/) and local `fm serve --help` / `man fm`. Server compatibility was checked on macOS 27 on September 14, 2026. This is a preview; naming quality needs real browsing feedback.

## Limits and verification

Cross-site linked grouping depends on the browser supplying `openerTabId`. Without it, only the domain fallback applies; this cannot infer which cross-site task a tab belongs to. Pinned tabs, non-web URLs, and blacklisted tabs are excluded. Pinned or cross-window openers do not establish a link relationship; their children may use same-window domain matching. Session metadata survives background worker restarts; restored groups after a full browser restart are treated conservatively as existing groups. This is linked browsing, not semantic clustering of the entire tab strip or a full reproduction of Dia.

Run `bun run code:check`, `bun run test`, and both browser builds. After building Chrome, run `bunx playwright test tests/e2e/linked-tabs.e2e.ts` for isolated linked-workflow coverage. See [implementation notes](docs/LINKED_TABS.md) for the verification scope and smaller-model research. Neither a successful build nor an upstream CI badge establishes Firefox runtime support or model quality. See [fresh public-site naming results](docs/NAMING_EVALUATION.md) for a small practical check and a prompt weakness corrected during it.

## Fork CI and sharing builds

The fork opens on `feat/dia-linked-tab-groups`; `master` retains the upstream baseline. Use the fork’s [Actions page](https://github.com/thesammykins/auto-tab-groups/actions/workflows/ci.yml) for validation and downloadable `unpacked-extension-previews` artifacts (GitHub sign-in required, retained for 14 days).

One workflow runs on active-branch code pushes, pull requests, or manual dispatch. Documentation-only pushes are skipped. It checks code and unit tests, builds Chrome and Firefox once, runs the complete Chromium browser suite against that build, and packages the existing outputs. New pushes cancel obsolete runs. The workflow has read-only repository permission, no persisted checkout credentials, and pinned action revisions. It does not publish to either browser store, create releases, or require the original author’s secrets. Apple inference is tested locally on macOS; CI does not run or install models.

The preview ZIPs include the original GPL license; a matching committed source ZIP accompanies them. For local ZIPs, commit your changes and build from that clean checkout, then run `python3 scripts/package_preview.py` (Python 3, standard library only). Outputs and SHA-256 checksums are written under `artifacts/`. Add `--browser chrome` or `--browser firefox` to package one existing build. These unsigned ZIPs are for unpacked previews; the Firefox ZIP is not an AMO store submission. The original `bun run zip:*` commands remain available for upstream-style packaging but are not used by fork CI because they rebuild.

No upstream PRs are opened automatically. Proposals below should be extracted into separate branches based on upstream `master`.

## Proposed upstream contributions

No upstream PR has been submitted. These are proposed extraction boundaries, not claims that the entire fork is ready to merge.

| Priority | Independent contribution | Upstream scope |
| --- | --- | --- |
| 1 | Optional opener-based linked grouping | Keep upstream's domain default. Extract the model-free membership, session persistence, serialized tab creation, manual-removal protection, and cleanup behavior with its unit/browser tests. Remove Apple naming calls from this patch. |
| 2 | New tab in current group | A small standalone command/button improvement using native tab-group APIs. No model or server dependency. Retain configurable shortcuts without assigning a conflicting default. |
| 3 | Preserve settings during unrelated saves | Background and command state saves currently construct defaults that can overwrite saved AI preferences. Preserve the current settings explicitly. A keyboard-toggle regression test covers the overwrite; add background-message coverage when extracting the patch. This correctness fix needs no model installed or running. |
| 4 | Serialize background initialization | Review as a narrow race fix, with a concurrent-start regression test before proposing it independently. It supports reliable event handling without any model dependency. |
| Optional | Deterministic emoji labels | Offer as an opt-in addition to linked grouping after discussing naming preferences upstream. Unicode-safe truncation and preserving existing emoji are useful without inference. |

The Apple provider, localhost permission/setup, automatic model naming, experimental model catalog, and fresh-install default change stay out of these model-independent PRs. Linked-group naming is currently integrated in the linked service, so that service needs a clean model-free extraction for the first PR. Prefer small reviewable patches over submitting the fork wholesale; do not duplicate linked-workflow tests across several PRs.

---

## Original upstream README

# 🔖 Auto Tab Groups (Cross-Browser Extension)

[![CI](https://github.com/nitzanpap/auto-tab-groups/actions/workflows/ci.yml/badge.svg)](https://github.com/nitzanpap/auto-tab-groups/actions/workflows/ci.yml)

A lightweight cross-browser extension that automatically groups open tabs by domain, with intelligent domain name handling for better organization. Works on both Chrome and Firefox!

## 📦 Downloads

🦊 **[Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/auto-tab-groups/)**
🌐 **[Chrome Web Store](https://chromewebstore.google.com/detail/auto-tab-groups/cmolegdbajakaekbamkdhonkaldgield)**

## Example of tab groups in the navigation bar

[![Example of the extension in Chrome](images/chrome-images/tab-groups-with-popup.png)](https://chromewebstore.google.com/detail/auto-tab-groups/cmolegdbajakaekbamkdhonkaldgield)

[![Example of the extension in Firefox](images/firefox-images/tab-groups-with-popup-firefox-and-rules.png)](https://addons.mozilla.org/en-US/firefox/addon/auto-tab-groups/)

---

## 🌐 Browser Compatibility

| Browser | Version | Status                                           |
| ------- | ------- | ------------------------------------------------ |
| Firefox | 142+    | ✅ Fully supported (Manifest V3, Tab Groups API) |
| Chrome  | Latest  | ✅ Fully supported (Manifest V3, Tab Groups API) |

**Note**: Firefox 139+ required for full Tab Groups API support and enhanced features.

---

## 🚀 Features

- ✅ **Cross-browser compatibility** - Single codebase for Chrome and Firefox
- ✅ **Domain-based tab grouping** - Automatically groups tabs by website domain
- ✅ **Custom rules** - Create named groups that combine multiple domains
- ✅ **Rules export/import** - Backup, share, and migrate custom rules as JSON files
- ✅ **Smart domain display** - Shows clean domain names (e.g., "github" instead of "github.com")
- ✅ **Color management** - Persistent group colors across browser sessions
- ✅ **Collapse/expand controls** - Manage tab group visibility
- ✅ **Focus Mode** - Auto-collapse inactive groups when switching tabs
- ✅ **AI-powered features** - On-device AI via WebLLM (privacy-first, no data leaves your browser)
- ✅ **Configuration options** - Auto-grouping, subdomain handling, etc.
- ✅ **Side panel support** - Chrome side panel and Firefox sidebar
- ✅ **Modern UI** - Clean, responsive interface

### 🪄 Intelligent Tab Grouping

- Automatically groups tabs by their domain/subdomain
- Smart domain name display (e.g., "github" instead of "www.github.com")
- **Country code second-level domain (ccSLD) support** - Properly handles domains like `calendar-uk.co.uk`, `example.co.uk`, `abc.net.au`, etc.
- Special handling for IP addresses, localhost, and .local domains
- Real-time group updates as you browse

### 🛠️ Custom Rules System

- **Priority System**: Custom rules take priority over domain-based grouping
- **Fallback**: Domains not covered by custom rules still use automatic domain grouping
- **Real-time**: Changes to rules immediately re-group existing tabs
- **Quick add from current tabs**: Select domains from your currently open tabs instead of typing them manually
- **Example Use Cases**:
  - **Communication**: Group `discord.com`, `teams.microsoft.com`, `slack.com` under "Communication"
  - **Development**: Group `github.com`, `stackoverflow.com`, `docs.google.com` under "Dev Tools"
  - **Social Media**: Group `twitter.com`, `facebook.com`, `instagram.com` under "Social"

### 📎 Group Management

- One-click collapse/expand all groups
- Real-time group updates
- Maintains existing groups without duplicates
- Group/Ungroup all tabs with one click
- **Focus Mode**: Automatically collapse inactive groups when switching tabs

### 🎨 Advanced Color Management

- Consistent colors for each domain group
- Random color generation with one click
- Optional preservation of manually customized colors
- Remembers color preferences across browser sessions

### ⚙️ Configuration Options

- Toggle auto-grouping (on/off)
- Toggle grouping by subdomain (on/off)
- Toggle only applying to new tabs (on/off)
- Toggle preservation of manual color choices (on/off)

### 📱 Side Panel & Sidebar Support

- Chrome side panel and Firefox sidebar integration
- Displays tab groups for easy access
- Allows quick navigation between groups
- Sidebar popup as an alternative to the main popup

### 🤖 AI-Powered Features (On-Device, Privacy-First)

All AI features run **entirely on your device** using [WebLLM](https://github.com/mlc-ai/web-llm) and WebGPU. No tab data ever leaves your browser.

- **Smart Tab Group Suggestions**: Click "Suggest Groups" and the AI analyzes your open tabs to suggest topic-based groups (e.g., "Dev Tools", "Shopping", "Streaming") — not just domain-based grouping
- **AI Rule Generation**: Describe a rule in plain English (e.g., "Group all social media sites together") and the AI generates the domains and configuration
- **Suggestion Caching**: Apply suggestions one at a time — the popup remembers remaining suggestions across reopens
- **Multiple Model Options**: Choose from 6 models ranging from lightweight (360MB) to high-quality (3.8GB), with Qwen2.5 3B recommended for best results
- **WebGPU Accelerated**: Leverages your GPU for fast on-device inference

**Requirements**: A WebGPU-capable browser (Chrome 113+, Firefox 141+) and a GPU with sufficient VRAM for the selected model.

## Planned Features

- **Custom Rules UI Enhancements**:
  - Improved user interface for managing custom rules
  - Better visualization of rule priorities and conflicts
- **Search Functionality**:
  - Search through open tabs and groups
  - Filter by domain, group name, or custom rules
- **AI Enhancements**:
  - Content-aware grouping using page content analysis
  - Autonomous AI grouping mode (AI decides when to regroup)
  - "Why is this tab here?" explainer for group assignments
- **Improve Security, XSS, and CSP**:
  - Enhanced security measures to prevent XSS attacks
  - Content Security Policy (CSP) updates for better protection

---

## 🛠️ Development

The extension is built with [WXT](https://wxt.dev/) and TypeScript, supporting both Chrome and Firefox from a unified codebase.

### Quick Start

```bash
bun install
bun run dev        # Start development server
```

### Build Commands

| Command                 | Description                          |
| ----------------------- | ------------------------------------ |
| `bun run dev`           | Start WXT development server         |
| `bun run dev:chrome`    | Development server for Chrome        |
| `bun run dev:firefox`   | Development server for Firefox       |
| `bun run build`         | Build production extension (Chrome)  |
| `bun run build:firefox` | Build production extension (Firefox) |
| `bun run zip`           | Create release zip (Chrome)          |
| `bun run zip:firefox`   | Create release zip (Firefox)         |
| `bun run typecheck`     | Run TypeScript type checking         |
| `bun run test`          | Run unit tests (570+ tests)          |
| `bun run lint`          | Run Biome linter                     |
| `bun run format`        | Format with Biome                    |

### Loading for Development

**Chrome:**

1. Run `bun run dev:chrome`
2. Go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `.output/chrome-mv3-dev/`

**Firefox:**

1. Run `bun run dev:firefox`
2. Go to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select any file in `.output/firefox-mv3-dev/`

---

## 🧪 Testing

The project follows Test-Driven Development (TDD) principles with comprehensive test coverage across unit and end-to-end tests.

### Test Stack

| Tool       | Purpose                        |
| ---------- | ------------------------------ |
| Vitest     | Unit tests (fast, Vite-native) |
| Playwright | E2E browser extension testing  |

### Running Tests

```bash
bun run test          # Run unit tests (570+ tests)
bun run test:e2e      # Build extension and run E2E tests
```

### Unit Tests

Located in `tests/`, these test core utilities, business logic, and AI features:

- **`DomainUtils.test.ts`** (45 tests) - Domain extraction, ccSLD handling, edge cases
- **`UrlPatternMatcher.test.ts`** (27 tests) - URL pattern matching, wildcards, validation
- **`AiResponseParser.test.ts`** - AI response parsing, JSON extraction, suggestion validation
- **`PromptTemplates.test.ts`** - Prompt construction and structure verification
- **`AiService.test.ts`** - AI service orchestration, model management
- **`WebLlmProvider.test.ts`** - WebLLM provider, model loading, completion

```bash
bun run test                    # Run all unit tests
bun run test -- --watch         # Watch mode during development
bun run test -- --coverage      # Generate coverage report
```

### E2E Tests

Located in `tests/e2e/`, these test the extension in a real browser:

- **`extension.spec.ts`** - Extension loading, popup UI, toggle functionality, sidebar

E2E tests require building the extension first:

```bash
bun run test:e2e            # Builds Chrome extension, then runs Playwright
```

**Note:** E2E tests run in headed mode (visible browser) since Chrome extension testing requires it.

### Test Coverage Goals

- **Unit tests**: Core utilities at 80%+ coverage
- **E2E tests**: Critical user flows (popup, toggle, rules)

### Writing New Tests

Follow TDD workflow:

1. **Write test first** (RED) - Define expected behavior
2. **Run test** - Verify it fails
3. **Implement code** (GREEN) - Minimal code to pass
4. **Refactor** (IMPROVE) - Clean up while keeping tests green

Example unit test pattern:

```typescript
import { describe, it, expect } from "vitest"
import { extractDomain } from "../utils/DomainUtils"

describe("extractDomain", () => {
  it("extracts domain from standard URL", () => {
    expect(extractDomain("https://github.com/user/repo")).toBe("github")
  })

  it("handles ccSLD domains correctly", () => {
    expect(extractDomain("https://example.co.uk/page")).toBe("example")
  })
})
```

---

## 📦 Project Structure

```text
auto-tab-groups/
├── entrypoints/              # Extension entry points (WXT)
│   ├── background.ts         # Service worker
│   ├── popup/                # Popup UI
│   │   ├── index.html
│   │   ├── main.ts
│   │   └── style.css
│   ├── sidebar/              # Sidebar UI (Chrome side panel / Firefox sidebar)
│   │   ├── index.html
│   │   └── main.ts
│   └── rules-modal.unlisted/ # Rule creation/editing modal
│       ├── index.html
│       ├── main.ts
│       └── style.css
├── services/                 # Business logic
│   ├── TabGroupService.ts    # Tab grouping logic
│   ├── RulesService.ts       # Custom rules management
│   ├── TabGroupState.ts      # State management
│   ├── ai/                   # AI layer
│   │   ├── AiService.ts      # AI orchestrator
│   │   └── WebLlmProvider.ts # WebLLM provider (on-device inference)
│   └── index.ts
├── utils/                    # Utilities
│   ├── DomainUtils.ts        # Domain processing with ccSLD support
│   ├── UrlPatternMatcher.ts  # URL pattern matching
│   ├── AiResponseParser.ts   # AI response parsing and validation
│   ├── PromptTemplates.ts    # AI prompt engineering
│   ├── Constants.ts          # Tab group colors
│   ├── RulesUtils.ts         # Rule validation helpers
│   └── storage.ts            # WXT storage utilities
├── types/                    # TypeScript type definitions
├── tests/                    # Unit tests (570+ tests)
├── public/                   # Static assets (icons)
├── docs/                     # Documentation
├── wxt.config.ts             # WXT configuration
├── vitest.config.ts          # Vitest configuration
├── tsconfig.json             # TypeScript configuration
└── package.json
```

---

## 🧪 Usage

The extension works automatically in the background, grouping tabs by domain with intelligent name formatting. Click the extension icon in the browser toolbar to:

- Toggle automatic grouping
- Configure grouping options
- Manually trigger grouping for all tabs
- Generate new random colors for groups
- Collapse or expand all groups at once
- Access advanced settings:
  - Group by subdomain
  - Preserve manual color choices
- Create and manage custom rules for advanced grouping
- Use AI features for smart grouping and rule generation

### Custom Rules

Create named tab groups that combine multiple domains under a single group:

1. Open the extension popup
2. Click "Custom Rules" to expand the section
3. Click "Add New Rule" to create your first rule
4. Enter a group name (or let the system suggest one)
5. **Quick add from current tabs**: Select domains from your currently open tabs instead of typing them manually
6. Choose a color and save

**Example Use Cases**:

- **Communication**: Group `discord.com`, `teams.microsoft.com`, `slack.com` under "Communication"
- **Development**: Group `github.com`, `stackoverflow.com`, `docs.google.com` under "Dev Tools"
- **Social Media**: Group `twitter.com`, `facebook.com`, `instagram.com` under "Social"

### Color Management

The extension provides several ways to manage tab group colors:

1. **Automatic Colors**: Each domain gets a consistent color by default
2. **Manual Customization**:
   - Right-click any tab group to change its color
   - The extension can remember your custom color choices
3. **Random Generation**:
   - Click "Generate New Colors" to randomly assign new colors
   - Use the "Preserve manual colors" setting to keep your custom choices when generating new colors

### Group Management

The extension provides convenient ways to manage your tab groups:

1. **Automatic Grouping**:
   - Tabs are automatically grouped by domain
   - New tabs are added to existing groups
2. **Manual Controls**:
   - Group/Ungroup all tabs with one click
   - Collapse or expand all groups simultaneously
   - Right-click groups for individual controls

---

## 🧠 How It Works

### Tab Grouping Logic

- Uses the [`browser.tabs.group()`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/group) API
- Groups tabs based on their root domain
- Maintains group consistency during tab operations (refresh, new tab, etc.)
- **Smart domain extraction** with support for country code second-level domains (ccSLDs):
  - `abc.net.au` → Groups as "abc" (recognizes `co.au` as single TLD)
  - `shop.example.co.uk` → Groups as "example" (recognizes `co.uk` as single TLD)
  - `www.github.com` → Groups as "github" (standard domain handling)
- Intelligently formats domain names for group titles:
  - Removes TLD properly (e.g., ".com", ".org", ".co.uk")
  - Removes "www" subdomain when present
  - Special handling for IP addresses and local domains

### Group State Management

- Tracks collapse state of all groups
- Provides unified controls for group visibility
- Maintains group state during tab operations
- Ensures smooth transitions when collapsing/expanding

### 🌍 Country Code Second-Level Domain (ccSLD) Support

The extension includes intelligent handling for country-specific domains that use two-part top-level domains:

**Supported ccSLDs include:**

- **United Kingdom**: `.co.uk`, `.org.uk`, `.net.uk`, `.ac.uk`, `.gov.uk`
- **Australia**: `.com.au`, `.net.au`, `.org.au`, `.edu.au`, `.gov.au`
- **New Zealand**: `.co.nz`, `.net.nz`, `.org.nz`, `.ac.nz`, `.govt.nz`
- **South Africa**: `.co.za`, `.org.za`, `.net.za`, `.ac.za`, `.gov.za`
- **Japan**: `.co.jp`, `.or.jp`, `.ne.jp`, `.ac.jp`, `.go.jp`
- **South Korea**: `.co.kr`, `.or.kr`, `.ne.kr`, `.ac.kr`, `.go.kr`
- And many more...

**Examples:**

- `abc.net.au` → Groups as "abc" (not "co")
- `shop.example.co.uk` → Groups as "example" (not "co")
- `api.service.com.au` → Groups as "service" (not "com")

This ensures that international users get proper domain grouping regardless of their country's domain structure.

## 📚 Resources

- [MDN WebExtensions API Docs](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
- [tabs.group() API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/group)
- [WXT Framework](https://wxt.dev/)

---

## 📦 Distribution

### Building for Production

1. Update version in `package.json`
2. Build the extension:

   ```bash
   bun run zip          # Chrome
   bun run zip:firefox  # Firefox
   ```

3. Output files:
   - `.output/auto-tab-groups-{version}-chrome.zip` - Chrome extension
   - `.output/auto-tab-groups-{version}-firefox.zip` - Firefox extension
   - `.output/auto-tab-groups-{version}-sources.zip` - Source code (for Firefox review)

### Publishing

**Chrome Web Store:**

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Upload the Chrome zip file

**Firefox Add-ons:**

Firefox requires source code submission because the extension uses build tools (WXT, Vite, TypeScript).

1. Go to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. Upload the Firefox zip file (`auto-tab-groups-{version}-firefox.zip`)
3. When prompted "Do you need to submit source code?" select **Yes**
4. Upload the sources zip file (`auto-tab-groups-{version}-sources.zip`)
5. In the reviewer notes, add:

   ```text
   Build Instructions:
   1. Install Bun: https://bun.sh
   2. Run: bun install
   3. Run: bun run build:firefox
   4. Output in: .output/firefox-mv3/
   ```

---

## 👨‍💻 Author

Built by [Nitzan Papini](https://github.com/nitzanpap)

## 📄 License

See [LICENSE](LICENSE) for details.
