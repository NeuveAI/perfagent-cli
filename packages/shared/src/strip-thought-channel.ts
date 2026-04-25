/**
 * Strip Gemma 4 channel-tagged thinking from historical agent text.
 *
 * Per the Gemma 4 model card and `architecture-prd.md` §R4 (line 269): when
 * thinking mode is enabled, Gemma 4 prepends each turn with a
 * `<|channel>thought\n…<channel|>` block whose body is the model's internal
 * scratchpad. The model card recommends stripping these blocks from any
 * historical assistant messages re-fed to the model on subsequent turns
 * ("keep final response only"); they balloon trajectory token usage and
 * degrade multi-turn coherence.
 *
 * Variant B (R2 locked) constrains every turn's wire output to a single
 * `AgentTurn` JSON envelope via Ollama's `format` parameter, so production
 * runs do not currently emit channel tokens. This stripper is defensive and
 * forward-looking: it makes the trajectory rolling pipeline correct even
 * when thinking mode is enabled (or when an upstream client/proxy
 * leaks pre-format-grammar raw model text into the message history).
 *
 * The delimiter pair is exactly the form spelled out in the PRD example:
 * `<|channel>thought\n…<channel|>`. Note the asymmetric pipe placement
 * (`<|channel>` opens, `<channel|>` closes) — that is the literal Gemma 4
 * tokenization, not a regex-style placeholder.
 *
 * Implementation uses `String.prototype.indexOf` + slicing only. No regex per
 * `feedback_types_over_regex.md`. Pure function with no I/O.
 */

const CHANNEL_OPEN = "<|channel>";
const CHANNEL_CLOSE = "<channel|>";

export const stripThoughtChannel = (text: string): string => {
  if (text.length === 0) return text;
  if (text.indexOf(CHANNEL_OPEN) === -1) return text;
  let result = "";
  let cursor = 0;
  while (cursor < text.length) {
    const openIndex = text.indexOf(CHANNEL_OPEN, cursor);
    if (openIndex === -1) {
      result += text.slice(cursor);
      break;
    }
    result += text.slice(cursor, openIndex);
    const closeIndex = text.indexOf(CHANNEL_CLOSE, openIndex + CHANNEL_OPEN.length);
    if (closeIndex === -1) {
      cursor = text.length;
      break;
    }
    cursor = closeIndex + CHANNEL_CLOSE.length;
  }
  return result;
};
