export const MAX_GROUP_LABEL_GRAPHEMES = 48

const TOPIC_EMOJI: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(github|gitlab|stackoverflow|code|coding|developer|programming|debug|api)\b/i, "🛠️"],
  [/\b(flight|hotel|travel|trip|holiday|vacation)\b/i, "🧳"],
  [/\b(shop|shopping|buy|cart|checkout|store)\b/i, "🛍️"],
  [/\b(music|song|playlist|album|spotify)\b/i, "🎵"],
  [/\b(design|figma|sketch|typography)\b/i, "🎨"],
  [/\b(research|paper|study|search|documentation|docs)\b/i, "🔎"]
]

/** Give new linked groups an immediate label without waiting for a model. */
export function createLinkedGroupTitle(title: string | undefined, url: string): string {
  const hostname = new URL(url).hostname
  const text = title?.trim() || hostname
  const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)]
  const first = segments[0]?.segment || ""
  // Preserve source-page emoji, including flags and multi-codepoint sequences.
  const hasEmoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(first)
  const emoji = TOPIC_EMOJI.find(([pattern]) => pattern.test(`${text} ${hostname}`))?.[1] || "🔗"
  const label = segments
    .slice(0, hasEmoji ? MAX_GROUP_LABEL_GRAPHEMES : MAX_GROUP_LABEL_GRAPHEMES - 2)
    .map(part => part.segment)
    .join("")
  return hasEmoji ? label : `${emoji} ${label}`
}
