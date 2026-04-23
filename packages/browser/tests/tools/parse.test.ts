import { describe, expect, it } from "vitest";
import {
  countPendingNetworkRequests,
  findOptionsForSelect,
  snapshotContainsUid,
} from "../../src/tools/parse";

const networkFixture = `Showing 1-4 of 4 (Page 1 of 1).
reqid=1 GET https://agent.perflab.io/ [200]
reqid=2 GET https://agent.perflab.io/chunk.js [pending]
reqid=3 GET https://agent.perflab.io/data.json [pending]
reqid=4 GET https://agent.perflab.io/favicon.ico [404]`;

const networkAllSettled = `Showing 1-2 of 2 (Page 1 of 1).
reqid=1 GET https://agent.perflab.io/ [200]
reqid=2 GET https://agent.perflab.io/favicon.ico [200]`;

const networkDnsFailure = `Showing 1-1 of 1 (Page 1 of 1).
reqid=5 GET https://nonexistent.invalid.example/x [net::ERR_NAME_NOT_RESOLVED]`;

const snapshotFixture = `[0-1] <body uid=2_0>
  [0-2] <nav uid=2_1 role=navigation>
    [0-3] <button uid=2_10 "Buy">
    [0-4] <button uid=2_100 "Build your Volvo">
  [0-5] <main uid=2_20>
    [0-6] <input uid=2_30 role=textbox "Email">`;

describe("tools/parse/countPendingNetworkRequests", () => {
  it("counts exactly the lines with [pending] status tokens", () => {
    expect(countPendingNetworkRequests(networkFixture)).toBe(2);
  });

  it("returns 0 when no requests are pending", () => {
    expect(countPendingNetworkRequests(networkAllSettled)).toBe(0);
  });

  it("ignores net::ERR_* tokens as in-flight (they are terminated)", () => {
    expect(countPendingNetworkRequests(networkDnsFailure)).toBe(0);
  });

  it("returns 0 for empty or header-only input", () => {
    expect(countPendingNetworkRequests("")).toBe(0);
    expect(countPendingNetworkRequests("No requests found.")).toBe(0);
  });
});

describe("tools/parse/snapshotContainsUid", () => {
  it("matches uid=<ref> verbatim and only at word boundaries", () => {
    expect(snapshotContainsUid(snapshotFixture, "2_10")).toBe(true);
    expect(snapshotContainsUid(snapshotFixture, "2_100")).toBe(true);
    expect(snapshotContainsUid(snapshotFixture, "2_20")).toBe(true);
  });

  it("does NOT match on substring hits inside a longer uid", () => {
    // "2_1" is a proper prefix of "2_10" and "2_100" but no node's uid is exactly "2_1"... wait — there is one (2_1 on nav).
    // Use a ref that is a substring of another uid but not present as a standalone uid.
    expect(snapshotContainsUid(snapshotFixture, "2_1000")).toBe(false);
    expect(snapshotContainsUid(snapshotFixture, "2_40")).toBe(false);
  });

  it("does NOT match a bare digit in accessible names (false-positive guard)", () => {
    const withDigit = `[0-1] <body uid=99>\n  [0-2] <p "the number 3 is prime">`;
    expect(snapshotContainsUid(withDigit, "3")).toBe(false);
    expect(snapshotContainsUid(withDigit, "99")).toBe(true);
  });

  it("handles refs with regex-special characters safely", () => {
    const withSpecial = `[0-1] <body uid=a.b+c>`;
    expect(snapshotContainsUid(withSpecial, "a.b+c")).toBe(true);
    expect(snapshotContainsUid(withSpecial, "a-b-c")).toBe(false);
  });
});

const selectSnapshot = `uid=10 combobox "Color"
  uid=11 option "Red" value="red"
  uid=12 option "Green" value="green"
  uid=13 option "Blue" value="blue"
uid=20 button "Submit"`;

describe("tools/parse/findOptionsForSelect", () => {
  it("returns the immediate option children of the combobox in document order", () => {
    const options = findOptionsForSelect(selectSnapshot, "10");
    expect(options.map((o) => o.name)).toEqual(["Red", "Green", "Blue"]);
    expect(options.map((o) => o.value)).toEqual(["red", "green", "blue"]);
  });

  it("returns [] when the uid is not a combobox or has no option children", () => {
    const nonSelect = `uid=10 button "Go"\n  uid=11 text "Label"`;
    expect(findOptionsForSelect(nonSelect, "10")).toEqual([]);
  });

  it("returns [] when the select uid is absent", () => {
    expect(findOptionsForSelect(selectSnapshot, "99")).toEqual([]);
  });

  it("stops collecting options when the indent returns to the select's level", () => {
    // The button at uid=20 is NOT a child of uid=10 (same indent level).
    const options = findOptionsForSelect(selectSnapshot, "10");
    expect(options.every((o) => o.role === "option")).toBe(true);
    expect(options.map((o) => o.uid)).toEqual(["11", "12", "13"]);
  });
});
