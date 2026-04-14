import { describe, expect, it } from "vite-plus/test";
import { parseConsoleOutput } from "../src/parse-console-output";

const multiLevelPayload = `## Console messages
Showing 1-6 of 6 (Page 1 of 1).
msgid=1 [error] synthetic error: something broke (1 args)
msgid=2 [warn] synthetic warning: be careful (1 args)
msgid=3 [info] synthetic info message (1 args)
msgid=4 [log] synthetic log message (1 args)
msgid=5 [error] Error: stack trace error test
    at pptr:evaluateHandle;performEvaluation%20(file%3A%2F%2F%2FUsers%2Fvinicius%2F.nvm%2Fversions%2Fnode%2Fv22.14.0%2Flib%2Fnode_modules%2Fchrome-devtools-mcp%2Fbuild%2Fsrc%2Ftools%2Fscript.js%3A80%3A34):1:200
    at pptr:evaluate;file%3A%2F%2F%2FUsers%2Fvinicius%2F.nvm%2Fversions%2Fnode%2Fv22.14.0%2Flib%2Fnode_modules%2Fchrome-devtools-mcp%2Fbuild%2Fsrc%2Ftools%2Fscript.js%3A83%3A46:3:45 (1 args)
msgid=6 [error] Failed to load resource: the server responded with a status of 404 () (0 args)
`;

describe("parseConsoleOutput", () => {
  it("parses the multi-level happy-path capture", () => {
    const result = parseConsoleOutput(multiLevelPayload);
    expect(result).toHaveLength(6);

    expect(result[0].level).toBe("error");
    expect(result[0].text).toBe("synthetic error: something broke");
    expect(result[0].source).toBeUndefined();
    expect(result[0].url).toBeUndefined();

    expect(result[1].level).toBe("warn");
    expect(result[1].text).toBe("synthetic warning: be careful");

    expect(result[2].level).toBe("info");
    expect(result[2].text).toBe("synthetic info message");

    expect(result[3].level).toBe("log");
    expect(result[3].text).toBe("synthetic log message");

    expect(result[4].level).toBe("error");
    expect(result[4].text).toBe("Error: stack trace error test");
    expect(result[4].url).toBeDefined();
    expect(result[4].url).toMatch(/^pptr:evaluateHandle/);

    expect(result[5].level).toBe("error");
    expect(result[5].text).toBe(
      "Failed to load resource: the server responded with a status of 404 ()",
    );
  });

  it("returns empty array for the no-messages marker", () => {
    const emptyPayload = `## Console messages\n<no console messages found>\n`;
    expect(parseConsoleOutput(emptyPayload)).toEqual([]);
  });

  it("returns empty array for malformed or non-console input", () => {
    expect(parseConsoleOutput("")).toEqual([]);
    expect(parseConsoleOutput("random markdown\n# Heading\nnot a console payload")).toEqual([]);
    expect(parseConsoleOutput("## Network requests\nreqid=1 GET https://x [200]")).toEqual([]);
  });

  it("groups stack trace continuation lines into a single entry", () => {
    const payload = `## Console messages
Showing 1-1 of 1 (Page 1 of 1).
msgid=1 [error] Error: boom
    at foo (http://example.com/app.js:10:5)
    at bar (http://example.com/app.js:20:5) (1 args)
`;
    const result = parseConsoleOutput(payload);
    expect(result).toHaveLength(1);
    expect(result[0].level).toBe("error");
    expect(result[0].text).toBe("Error: boom");
    expect(result[0].url).toBe("http://example.com/app.js:10:5");
  });

  it("leaves source undefined for every entry", () => {
    const result = parseConsoleOutput(multiLevelPayload);
    for (const entry of result) {
      expect(entry.source).toBeUndefined();
    }
  });
});
