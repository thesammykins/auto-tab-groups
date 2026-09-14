import { describe, expect, it } from "vitest"
import { createLinkedGroupTitle } from "../utils/LinkedGroupTitle"

describe("linked group titles", () => {
  it("uses a topic emoji when the source indicates a topic", () => {
    expect(createLinkedGroupTitle("Flight options", "https://example.com")).toBe(
      "🧳 Flight options"
    )
    expect(createLinkedGroupTitle("Pull requests", "https://github.com")).toBe("🛠️ Pull requests")
  })
  it("uses a neutral linked emoji for unknown topics", () => {
    expect(createLinkedGroupTitle("My project", "https://example.com")).toBe("🔗 My project")
  })
  it.each([
    "👩🏽‍💻 Coding",
    "🇦🇺 Trip",
    "1️⃣ Tasks",
    "🎨 Design"
  ])("preserves a source emoji: %s", title => {
    expect(createLinkedGroupTitle(title, "https://example.com")).toBe(title)
  })
  it("falls back to the hostname when the source has no title", () => {
    expect(createLinkedGroupTitle("  ", "https://example.com/path")).toBe("🔗 example.com")
  })
  it("does not cut a grapheme at the label limit", () => {
    const title = createLinkedGroupTitle(`Task ${"👩🏽‍💻".repeat(80)}`, "https://example.com")
    const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(title)]
    expect(graphemes).toHaveLength(48)
    expect(graphemes.at(-1)?.segment).toBe("👩🏽‍💻")
  })
})
