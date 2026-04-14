import { describe, expect, it } from "vite-plus/test";
import { parseNetworkRequests } from "../src/parse-network-requests";

const diversePayload = `## Network requests
Showing 1-32 of 32 (Page 1 of 1).
reqid=1 GET https://agent.perflab.io/ [200]
reqid=2 GET https://agent.perflab.io/_next/static/css/07f1586a3ae3b690.css?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=3 GET https://agent.perflab.io/_next/static/css/39acbe2d004e163a.css?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=4 GET https://agent.perflab.io/_next/static/chunks/webpack-fef28fa7711482ab.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=5 GET https://agent.perflab.io/_next/static/chunks/common-5.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=6 GET https://agent.perflab.io/_next/static/chunks/common-6.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=7 GET https://agent.perflab.io/_next/static/chunks/common-7.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=8 GET https://agent.perflab.io/_next/static/chunks/common-8.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=9 GET https://agent.perflab.io/_next/static/chunks/common-9.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=10 GET https://agent.perflab.io/_next/static/chunks/common-10.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=11 GET https://agent.perflab.io/_next/static/chunks/common-11.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=12 GET https://agent.perflab.io/_next/static/chunks/common-12.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=13 GET https://agent.perflab.io/site.webmanifest [200]
reqid=14 GET https://agent.perflab.io/favicons/favicon-32x32.png [200]
reqid=15 GET https://agent.perflab.io/favicons/favicon.svg [200]
reqid=16 GET https://agent.perflab.io/favicons/apple-touch-icon.png [200]
reqid=17 GET https://agent.perflab.io/site.webmanifest [304]
reqid=18 GET https://agent.perflab.io/favicons/favicon-16x16.png [200]
reqid=19 GET https://agent.perflab.io/favicons/android-chrome-192x192.png [200]
reqid=20 GET https://agent.perflab.io/favicons/android-chrome-512x512.png [200]
reqid=21 GET https://agent.perflab.io/_next/static/chunks/app-20.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=22 GET https://agent.perflab.io/_next/static/chunks/app-21.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=23 GET https://agent.perflab.io/_next/static/chunks/app-22.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=24 GET https://agent.perflab.io/_next/static/chunks/app-23.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=25 GET https://agent.perflab.io/_next/static/chunks/app-24.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=26 GET https://agent.perflab.io/_next/static/chunks/app-25.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=27 GET https://agent.perflab.io/_next/static/chunks/app-26.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=28 GET https://agent.perflab.io/_next/static/chunks/app-27.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=29 GET https://agent.perflab.io/_next/static/chunks/app-28.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=30 GET https://agent.perflab.io/_next/static/chunks/app-29.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=31 GET https://agent.perflab.io/_next/static/chunks/app-30.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
reqid=32 GET https://agent.perflab.io/_next/static/chunks/app/(user)/chat/page-1628216deed1a2d5.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY [200]
`;

const failurePayload = `## Network requests
Showing 1-4 of 4 (Page 1 of 1).
reqid=1 GET https://httpbin.org/html [200]
reqid=2 GET https://httpbin.org/status/404 [404]
reqid=3 GET https://httpbin.org/status/500 [500]
reqid=4 GET https://nonexistent.invalid.example/x [net::ERR_NAME_NOT_RESOLVED]
`;

describe("parseNetworkRequests", () => {
  it("parses a diverse 32-entry capture with HTML, CSS, JS, image, and manifest resources", () => {
    const result = parseNetworkRequests(diversePayload);
    expect(result).toHaveLength(32);

    const [first] = result;
    expect(first.method).toBe("GET");
    expect(first.url).toBe("https://agent.perflab.io/");
    expect(first.status).toBe(200);
    expect(first.statusText).toBeUndefined();
    expect(first.failed).toBe(false);
    expect(first.resourceType).toBeUndefined();
    expect(first.transferSizeKb).toBeUndefined();
    expect(first.durationMs).toBeUndefined();

    const cssEntry = result.find((entry) =>
      entry.url.startsWith("https://agent.perflab.io/_next/static/css/07f1586a"),
    );
    expect(cssEntry).toBeDefined();
    expect(cssEntry?.status).toBe(200);
    expect(cssEntry?.failed).toBe(false);
    expect(cssEntry?.resourceType).toBeUndefined();

    const imageEntry = result.find(
      (entry) => entry.url === "https://agent.perflab.io/favicons/android-chrome-192x192.png",
    );
    expect(imageEntry).toBeDefined();
    expect(imageEntry?.status).toBe(200);
    expect(imageEntry?.failed).toBe(false);

    const notModifiedEntry = result.find((entry) => entry.status === 304);
    expect(notModifiedEntry).toBeDefined();
    expect(notModifiedEntry?.failed).toBe(false);

    const parenthesisEntry = result.find((entry) => entry.url.includes("/chat/page-"));
    expect(parenthesisEntry).toBeDefined();
    expect(parenthesisEntry?.url).toBe(
      "https://agent.perflab.io/_next/static/chunks/app/(user)/chat/page-1628216deed1a2d5.js?dpl=dpl_22hnh6pWDmnQWx8yRZiYqxkcRoZY",
    );
  });

  it("returns [] when the payload is the empty-requests sentinel", () => {
    const payload = `## Network requests
No requests found.
`;
    expect(parseNetworkRequests(payload)).toEqual([]);
  });

  it("returns [] for malformed or non-network input", () => {
    expect(parseNetworkRequests("")).toEqual([]);
    expect(parseNetworkRequests("## Console messages\nmsgid=1 [error] something\n")).toEqual([]);
    expect(parseNetworkRequests("random text without any sentinel")).toEqual([]);
  });

  it("classifies 200/404/500/net::ERR statuses into status/statusText/failed", () => {
    const result = parseNetworkRequests(failurePayload);
    expect(result).toHaveLength(4);

    const okEntry = result[0];
    expect(okEntry.url).toBe("https://httpbin.org/html");
    expect(okEntry.status).toBe(200);
    expect(okEntry.statusText).toBeUndefined();
    expect(okEntry.failed).toBe(false);

    const notFoundEntry = result[1];
    expect(notFoundEntry.status).toBe(404);
    expect(notFoundEntry.statusText).toBeUndefined();
    expect(notFoundEntry.failed).toBe(true);

    const serverErrorEntry = result[2];
    expect(serverErrorEntry.status).toBe(500);
    expect(serverErrorEntry.statusText).toBeUndefined();
    expect(serverErrorEntry.failed).toBe(true);

    const dnsFailureEntry = result[3];
    expect(dnsFailureEntry.status).toBeUndefined();
    expect(dnsFailureEntry.statusText).toBe("net::ERR_NAME_NOT_RESOLVED");
    expect(dnsFailureEntry.failed).toBe(true);
  });

  it("treats pending status as non-failed with statusText='pending'", () => {
    const payload = `## Network requests
Showing 1-1 of 1 (Page 1 of 1).
reqid=1 GET https://example.com/slow [pending]
`;
    const [entry] = parseNetworkRequests(payload);
    expect(entry.status).toBeUndefined();
    expect(entry.statusText).toBe("pending");
    expect(entry.failed).toBe(false);
  });

  it("strips the ' [selected in the DevTools Network panel]' suffix", () => {
    const payload = `## Network requests
Showing 1-1 of 1 (Page 1 of 1).
reqid=1 GET https://example.com/ [200] [selected in the DevTools Network panel]
`;
    const [entry] = parseNetworkRequests(payload);
    expect(entry.url).toBe("https://example.com/");
    expect(entry.status).toBe(200);
  });
});
