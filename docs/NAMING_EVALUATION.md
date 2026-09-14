# Public-site naming evaluation — September 14, 2026

Tested on macOS 27 with the built Chrome extension and Apple’s built-in `fm serve`, using a disposable Chromium profile. These pages were freshly selected beyond the reusable fixtures, not a statistically random sample. They were loaded from the live websites with their real titles; no network fixture interception was used. A temporary link was inserted to make Command-click comparisons between sites reproducible. No personal browser tabs were used.

The test copy pre-granted the same optional host/network-rule permissions requested by Connect. This verifies real extension-to-server inference and grouping, but not Chrome’s interactive permission prompt. The distributed manifest keeps those permissions optional.

## Observed behavior

| Group | Actual pages | Final prompt behavior |
| --- | --- | --- |
| Coffee | [Espresso](https://en.wikipedia.org/wiki/Espresso), [AeroPress](https://aeropress.com/), [Pour-over / drip coffee](https://en.wikipedia.org/wiki/Pour_over_coffee) | ☕ Coffee equipment comparison; adding pour-over retained the label. |
| Astronomy | [NASA Webb](https://science.nasa.gov/mission/webb/), [ESA Hubble](https://esahubble.org/), [ESA Euclid](https://www.esa.int/Science_Exploration/Space_Science/Euclid) | 🔭 Space telescope research; adding Euclid retained the label. |
| Travel | [Kyoto guide](https://www.japan-guide.com/e/e2158.html), [Kyoto tourism](https://kyoto.travel/en/), [JR West](https://www.westjr.co.jp/global/en/), [Osaka guide](https://www.japan-guide.com/e/e2157.html) | 🧳 Kyoto trip planning; retained for supporting train information, broadened to 🧳 Kyoto and Osaka trip planning for the second destination. |

An earlier prompt overreacted to the railway page, changing Kyoto trip planning to Japan train itinerary. The final prompt explicitly distinguishes supporting logistics from new primary subjects and preserves the dominant destination/task. Small groups retain their natural context order; larger groups prioritize changed subjects within the 12-tab prompt budget.

The final live harness waits until saved naming metadata matches the actual loaded titles and hostnames, not merely until some inference has completed. An initial API-created-tab probe did not reproduce natural opener grouping reliably; it is not counted as successful live workflow coverage. Actual Command-click openings worked.

## Naming contract

- One subject-relevant emoji and a plain-language title, aiming for 3–7 useful words.
- Maximum 48 grapheme clusters for the complete label, including emoji and space. Code enforces the bound and avoids cutting emoji or words in generated titles.
- Reconsider changed membership/title context with the current label. Retain good names exactly; do not rewrite the group for an unchanged answer.
- Debounce nearby events, serialize inference per group, and reconsider changes that arrive during an outstanding request. Reject stale answers after membership changes, manual renames, disabling AI, or Disconnect.
- Manual and protected groups retain user ownership. This feature does not rename all existing groups.
- Tab titles are untrusted prompt data. JSON responses are validated; invalid names leave the current label in place.

These are smoke tests, not a benchmark or a guarantee of ideal names. Coffee equipment comparison is useful but still slightly narrower than the general topic of brewing methods. Mixed-topic groups, non-English pages, large groups, and long browsing sessions need broader evaluation. The model sees bounded titles/hostnames, not article text, so ambiguous titles limit accuracy.

## Automated checks

989 unit tests passed, including naming length, invalid responses, permission boundaries, retained labels, stale-result protection, worker reconnection and settings preservation. Six Chromium linked-workflow tests passed. Type/format/lint checks and Chrome/Firefox builds passed. Firefox runtime behavior and the interactive optional-permission prompt remain unverified.


## Hybrid mode and explicit naming follow-up

September 14, 2026: a disposable Chromium profile loaded real MDN Promise documentation and Chrome's tabGroups API documentation. They were manually grouped under `Old research`, with automatic grouping paused. The actual AI settings group picker and **Refresh name** button called the built-in Apple server and renamed this pre-existing group to **🔬 Promise and browser API research**. The model remained Ready. The test profile pre-granted the same optional localhost/network-rule permissions; it did not test a fresh permission prompt. This verifies the explicit naming UI and inference path on those public pages, not broad naming quality or the final hybrid build in Aside.

Hybrid browser regressions cover independent base-domain tabs, a detached tab staying out when a later domain tab opens, and the Group Tabs button organizing existing ungrouped tabs while preserving a manually created group. Unit coverage also checks opener precedence, mixed-project exclusion, deferred new-tab navigation, explicit renaming without taking group ownership, and stale-result rejection.
