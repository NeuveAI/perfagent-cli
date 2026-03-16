---
format_version: 2
title: "Hacker News Login State Check – cookie-effect-rewrite Smoke Test"
description: "76-file unstaged rewrite on cookie-effect-rewrite: deletes legacy SQLite/profile cookie extraction (chromium, firefox, …"
slug: "hacker-news-login-state-check-cookie-effect-rewrite-smoke-test"
saved_target_scope: "unstaged"
saved_target_display_name: "unstaged changes on cookie-effect-rewrite"
plan: {"title":"Hacker News Login State Check – cookie-effect-rewrite Smoke Test","rationale":"The diff removes the entire cookies SQLite/profiles extraction stack and rewrites the cookie effect. The core risk is that cookie reading/forwarding is broken, which would prevent authenticated sessions from being passed to the browser. Testing Hacker News login state exercises the cookie pipeline end-to-end in a real browser context with minimal steps.","targetSummary":"76-file unstaged rewrite on cookie-effect-rewrite: deletes legacy SQLite/profile cookie extraction (chromium, firefox, safari adapters, CDP client, detectors) and rewrites packages/cookies/src/index.ts + packages/browser/src/create-page.ts. High risk of cookie injection regression.","assumptions":["The test runner has access to the local browser binary and can launch a headed or headless Chromium instance via the rewritten create-page.ts.","No Hacker News credentials are required — the test only checks whether a session cookie is present (logged-in indicator visible) or absent (login link visible).","The rewritten cookie effect may or may not forward system browser cookies; if cookieSync is disabled the session will be anonymous.","Hacker News uses a standard 'user' cookie for session state, visible in the top nav bar."],"riskAreas":["packages/cookies/src/index.ts rewrite may fail to export or apply cookies correctly, breaking cookie injection into the page context.","packages/browser/src/create-page.ts changes may alter how cookies are attached to the browser context before navigation.","Deletion of cdp-client.ts and cdp-extract.ts removes CDP-based cookie injection — if the new path doesn't replace this, cookies silently drop.","host-matching.ts was modified — incorrect host matching could cause cookies to be skipped for news.ycombinator.com.","If the new cookie effect throws at runtime, the page may still load but without any cookies, making the auth check the key signal."],"targetUrls":["https://news.ycombinator.com"],"cookieSync":{"required":false,"reason":"Hacker News is fully public. The journey only checks the presence or absence of a logged-in state indicator in the nav bar — no authenticated content is required. If the tester wants to verify cookie forwarding for a logged-in session they should enable cookie sync, but the smoke test is valid without it: a missing login indicator when cookies should have been forwarded is itself a detectable regression signal."},"steps":[{"id":"step-1","title":"Navigate to Hacker News homepage","instruction":"Open a new browser page and navigate to https://news.ycombinator.com. Wait for the page to fully load.","expectedOutcome":"The Hacker News front page loads successfully. The orange top nav bar is visible. HTTP status is 200 with no navigation errors.","routeHint":"https://news.ycombinator.com","changedFileEvidence":["packages/browser/src/create-page.ts"]},{"id":"step-2","title":"Inspect the top navigation bar for login state","instruction":"Examine the top-right area of the nav bar. Look for either: (a) a 'login' link indicating an anonymous session, or (b) a username link and 'logout' link indicating an authenticated session.","expectedOutcome":"One of two outcomes is clearly present: the text 'login' is visible (anonymous/no cookies forwarded), OR a username with 'logout' is visible (cookies forwarded successfully). The nav bar must not be empty or broken.","routeHint":"https://news.ycombinator.com","changedFileEvidence":["packages/cookies/src/index.ts","packages/browser/src/create-page.ts"]},{"id":"step-3","title":"Verify cookie attachment did not throw a runtime error","instruction":"Open the browser DevTools console (or check the test runner logs) for any uncaught JavaScript errors or network errors that occurred during page load. Specifically look for errors referencing cookie injection, CDP, or context setup.","expectedOutcome":"No uncaught errors related to cookie setup appear in the console. The page loaded without runtime exceptions from the cookie effect.","routeHint":"https://news.ycombinator.com","changedFileEvidence":["packages/cookies/src/index.ts","packages/browser/src/create-page.ts","packages/cookies/src/utils/host-matching.ts"]},{"id":"step-4","title":"Check browser cookie store for ycombinator.com cookies","instruction":"Using DevTools Application > Cookies (or the test framework's cookie inspection API), inspect the cookies set for news.ycombinator.com. Note whether a 'user' session cookie is present.","expectedOutcome":"If cookie sync was enabled: a 'user' cookie with a non-empty value is present. If cookie sync was disabled: no 'user' cookie is present. Either state is acceptable as long as it matches the nav bar login indicator observed in step 2 — a mismatch (nav shows logged in but no cookie, or vice versa) would indicate a regression.","routeHint":"https://news.ycombinator.com","changedFileEvidence":["packages/cookies/src/index.ts","packages/cookies/src/utils/host-matching.ts"]},{"id":"step-5","title":"Navigate to the login page to confirm public routing works","instruction":"Click the 'login' link in the nav bar (if present) or navigate directly to https://news.ycombinator.com/login. Verify the login form loads.","expectedOutcome":"The login page loads with a visible username/password form and a 'login' submit button. No redirect loops or errors occur. (Skip this step if already logged in from step 2.)","routeHint":"https://news.ycombinator.com/login","changedFileEvidence":["packages/browser/src/create-page.ts"]}],"userInstruction":"go to hackernews and check if we are signed ikn or not"}
environment: {}
---

# Hacker News Login State Check – cookie-effect-rewrite Smoke Test

76-file unstaged rewrite on cookie-effect-rewrite: deletes legacy SQLite/profile cookie extraction (chromium, firefox, …

## User Instruction

go to hackernews and check if we are signed ikn or not

## Target

- Scope: unstaged
- Display name: unstaged changes on cookie-effect-rewrite
- Current branch: cookie-effect-rewrite
- Main branch: main

## Cookie Sync

- Required: No
- Reason: Hacker News is fully public. The journey only checks the presence or absence of a logged-in state indicator in the nav bar — no authenticated content is required. If the tester wants to verify cookie forwarding for a logged-in session they should enable cookie sync, but the smoke test is valid without it: a missing login indicator when cookies should have been forwarded is itself a detectable regression signal.
- Enabled for this saved flow: No

## Target URLs

- https://news.ycombinator.com

## Risk Areas

- packages/cookies/src/index.ts rewrite may fail to export or apply cookies correctly, breaking cookie injection into the page context.
- packages/browser/src/create-page.ts changes may alter how cookies are attached to the browser context before navigation.
- Deletion of cdp-client.ts and cdp-extract.ts removes CDP-based cookie injection — if the new path doesn't replace this, cookies silently drop.
- host-matching.ts was modified — incorrect host matching could cause cookies to be skipped for news.ycombinator.com.
- If the new cookie effect throws at runtime, the page may still load but without any cookies, making the auth check the key signal.

## Assumptions

- The test runner has access to the local browser binary and can launch a headed or headless Chromium instance via the rewritten create-page.ts.
- No Hacker News credentials are required — the test only checks whether a session cookie is present (logged-in indicator visible) or absent (login link visible).
- The rewritten cookie effect may or may not forward system browser cookies; if cookieSync is disabled the session will be anonymous.
- Hacker News uses a standard 'user' cookie for session state, visible in the top nav bar.

## Steps

### 1. Navigate to Hacker News homepage

Instruction: Open a new browser page and navigate to https://news.ycombinator.com. Wait for the page to fully load.
Expected outcome: The Hacker News front page loads successfully. The orange top nav bar is visible. HTTP status is 200 with no navigation errors.
Route hint: https://news.ycombinator.com
Changed file evidence: packages/browser/src/create-page.ts

### 2. Inspect the top navigation bar for login state

Instruction: Examine the top-right area of the nav bar. Look for either: (a) a 'login' link indicating an anonymous session, or (b) a username link and 'logout' link indicating an authenticated session.
Expected outcome: One of two outcomes is clearly present: the text 'login' is visible (anonymous/no cookies forwarded), OR a username with 'logout' is visible (cookies forwarded successfully). The nav bar must not be empty or broken.
Route hint: https://news.ycombinator.com
Changed file evidence: packages/cookies/src/index.ts, packages/browser/src/create-page.ts

### 3. Verify cookie attachment did not throw a runtime error

Instruction: Open the browser DevTools console (or check the test runner logs) for any uncaught JavaScript errors or network errors that occurred during page load. Specifically look for errors referencing cookie injection, CDP, or context setup.
Expected outcome: No uncaught errors related to cookie setup appear in the console. The page loaded without runtime exceptions from the cookie effect.
Route hint: https://news.ycombinator.com
Changed file evidence: packages/cookies/src/index.ts, packages/browser/src/create-page.ts, packages/cookies/src/utils/host-matching.ts

### 4. Check browser cookie store for ycombinator.com cookies

Instruction: Using DevTools Application > Cookies (or the test framework's cookie inspection API), inspect the cookies set for news.ycombinator.com. Note whether a 'user' session cookie is present.
Expected outcome: If cookie sync was enabled: a 'user' cookie with a non-empty value is present. If cookie sync was disabled: no 'user' cookie is present. Either state is acceptable as long as it matches the nav bar login indicator observed in step 2 — a mismatch (nav shows logged in but no cookie, or vice versa) would indicate a regression.
Route hint: https://news.ycombinator.com
Changed file evidence: packages/cookies/src/index.ts, packages/cookies/src/utils/host-matching.ts

### 5. Navigate to the login page to confirm public routing works

Instruction: Click the 'login' link in the nav bar (if present) or navigate directly to https://news.ycombinator.com/login. Verify the login form loads.
Expected outcome: The login page loads with a visible username/password form and a 'login' submit button. No redirect loops or errors occur. (Skip this step if already logged in from step 2.)
Route hint: https://news.ycombinator.com/login
Changed file evidence: packages/browser/src/create-page.ts
