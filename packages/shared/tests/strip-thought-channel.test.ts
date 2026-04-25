import { describe, expect, it } from "vite-plus/test";
import { stripThoughtChannel } from "../src/strip-thought-channel";

describe("stripThoughtChannel", () => {
  it("returns the input unchanged when no channel block is present", () => {
    const input = "Click element 5";
    expect(stripThoughtChannel(input)).toEqual(input);
  });

  it("returns an empty string unchanged", () => {
    expect(stripThoughtChannel("")).toEqual("");
  });

  it("strips a single channel block from the start of a message (PRD example)", () => {
    const input = "<|channel>thought\nI'll click X\n<channel|>Click element 5";
    expect(stripThoughtChannel(input)).toEqual("Click element 5");
  });

  it("strips a channel block in the middle of a message", () => {
    const input = "Before <|channel>thought\nReasoning here\n<channel|>after";
    expect(stripThoughtChannel(input)).toEqual("Before after");
  });

  it("strips multiple consecutive channel blocks", () => {
    const input =
      "<|channel>thought\nfirst\n<channel|><|channel>thought\nsecond\n<channel|>final";
    expect(stripThoughtChannel(input)).toEqual("final");
  });

  it("strips multiple non-consecutive channel blocks", () => {
    const input =
      "head <|channel>thought\nA\n<channel|> middle <|channel>thought\nB\n<channel|> tail";
    expect(stripThoughtChannel(input)).toEqual("head  middle  tail");
  });

  it("drops a dangling open delimiter without close", () => {
    const input = "Visible text <|channel>thought\nopen-without-close-and-no-tail";
    expect(stripThoughtChannel(input)).toEqual("Visible text ");
  });

  it("preserves a literal close delimiter that has no matching open", () => {
    const input = "Just a close <channel|> no open";
    expect(stripThoughtChannel(input)).toEqual(input);
  });

  it("preserves an empty channel block (open immediately followed by close)", () => {
    const input = "head <|channel><channel|>tail";
    expect(stripThoughtChannel(input)).toEqual("head tail");
  });

  it("preserves text containing only the open token literal as plain text when no close exists", () => {
    const input = "Plain <|channel>";
    expect(stripThoughtChannel(input)).toEqual("Plain ");
  });
});
