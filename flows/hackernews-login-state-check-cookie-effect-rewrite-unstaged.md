---
format_version: 2
title: "HackerNews Login State Check — cookie-effect-rewrite unstaged"
description: "87 files changed on cookie-effect-rewrite (unstaged). Large deletion of cookies/src internals (sqlite, profiles, cdp) w…"
slug: "hackernews-login-state-check-cookie-effect-rewrite-unstaged"
saved_target_scope: "unstaged"
saved_target_display_name: "unstaged changes on cookie-effect-rewrite"
plan: {"title":"HackerNews Login State Check — cookie-effect-rewrite unstaged","rationale":"The diff rewrites the cookies package (deleting SQLite/CDP/profile extraction logic and restructuring exports) and modifies create-page.ts in the browser package. The core risk is that the new cookie plumbing either fails to surface cookies to the browser page context or silently drops the HN session cookie, causing a false 'logged out' state. The user's journey (visit HN, check login) directly exercises this risk surface.","targetSummary":"87 files changed on cookie-effect-rewrite (unstaged). Large deletion of cookies/src internals (sqlite, profiles, cdp) with apparent rewrite of the cookie injection mechanism. packages/browser/src/create-page.ts modified — the entry point that attaches cookies to a Playwright/CDP page.","assumptions":["The test runner uses the local unstaged build of packages/browser and packages/cookies.","If cookieSync is enabled, the user has a valid HackerNews session cookie in their local browser profile.","HackerNews login state is visible via a 'logout' link or username in the top nav when authenticated.","If no session cookie is synced, the expected outcome flips to 'logged out' — the test still validates the page loads and cookie state is deterministic."],"riskAreas":["Cookie injection in create-page.ts may silently fail after the rewrite, causing session cookies to never reach the page.","Deleted SQLite/profile extraction code may break the cookie-reading path before any browser step runs.","Restructured packages/cookies/src/index.ts exports may cause import errors at runtime if consumers reference deleted symbols.","The new cookie flow might inject cookies with wrong domain/path/sameSite attributes, causing HN to reject the session.","No commit history means the rewrite intent is opaque — edge cases in host-matching (packages/cookies/src/utils/host-matching.ts, modified) could drop the 'news.ycombinator.com' cookie."],"targetUrls":["https://news.ycombinator.com"],"cookieSync":{"required":true,"reason":"The explicit user goal is to check whether the session is preserved after the cookie rewrite. Without syncing the local browser's HN session cookie into the test browser, the page will always appear logged out, making the test unable to distinguish a cookie-injection regression from a simple unauthenticated state. cookieSync exercises the exact code paths deleted and rewritten in this diff."},"steps":[{"id":"step-1","title":"Navigate to HackerNews homepage","instruction":"Open https://news.ycombinator.com in the test browser after cookie sync has been applied.","expectedOutcome":"Page loads successfully (HTTP 200). The HN top bar is visible with either a username + 'logout' link (authenticated) or a 'login' link (unauthenticated). No JavaScript or network errors related to cookie handling.","routeHint":"https://news.ycombinator.com","changedFileEvidence":["packages/browser/src/create-page.ts","packages/cookies/src/index.ts"]},{"id":"step-2","title":"Assert login state in top navigation","instruction":"Inspect the top-right navigation bar. Check for the presence of a 'logout' link (authenticated) or a 'login' link (unauthenticated). Record which state is observed.","expectedOutcome":"If cookie sync succeeded and the session cookie was correctly injected by the rewritten create-page.ts, a username and 'logout' link appear. If the cookie plumbing regressed, a 'login' link appears instead — this is a signal of breakage.","routeHint":"https://news.ycombinator.com","changedFileEvidence":["packages/browser/src/create-page.ts","packages/cookies/src/utils/host-matching.ts"]},{"id":"step-3","title":"Verify cookie is present in browser storage","instruction":"Open browser DevTools (or use the test agent's cookie inspection API) and check document.cookie or the Application > Cookies panel for 'news.ycombinator.com'. Confirm the 'user' cookie (HN session token) is present and non-empty.","expectedOutcome":"The 'user' cookie exists for the domain news.ycombinator.com with a non-empty value. Absence of this cookie confirms the cookie injection path in create-page.ts or the new cookies package failed.","routeHint":"https://news.ycombinator.com","changedFileEvidence":["packages/browser/src/create-page.ts","packages/cookies/src/index.ts","packages/cookies/src/utils/host-matching.ts"]},{"id":"step-4","title":"Navigate to HN profile page to confirm session depth","instruction":"If logged in, click the username link in the top nav to visit the user profile page (https://news.ycombinator.com/user?id=<username>).","expectedOutcome":"Profile page loads and displays the correct account details (karma, about, etc.) without redirecting to the login page. A redirect to login would indicate the session cookie was injected with incorrect attributes (wrong domain, path, or sameSite) by the rewritten cookie logic.","routeHint":"https://news.ycombinator.com/user","changedFileEvidence":["packages/cookies/src/utils/host-matching.ts","packages/browser/src/create-page.ts"]}],"userInstruction":"go to hackernews and check if we are logged in or not"}
environment: {"cookies":true}
---

# HackerNews Login State Check — cookie-effect-rewrite unstaged

87 files changed on cookie-effect-rewrite (unstaged). Large deletion of cookies/src internals (sqlite, profiles, cdp) w…

## User Instruction

go to hackernews and check if we are logged in or not

## Target

- Scope: unstaged
- Display name: unstaged changes on cookie-effect-rewrite
- Current branch: cookie-effect-rewrite
- Main branch: main

## Cookie Sync

- Required: Yes
- Reason: The explicit user goal is to check whether the session is preserved after the cookie rewrite. Without syncing the local browser's HN session cookie into the test browser, the page will always appear logged out, making the test unable to distinguish a cookie-injection regression from a simple unauthenticated state. cookieSync exercises the exact code paths deleted and rewritten in this diff.
- Enabled for this saved flow: Yes

## Target URLs

- https://news.ycombinator.com

## Risk Areas

- Cookie injection in create-page.ts may silently fail after the rewrite, causing session cookies to never reach the page.
- Deleted SQLite/profile extraction code may break the cookie-reading path before any browser step runs.
- Restructured packages/cookies/src/index.ts exports may cause import errors at runtime if consumers reference deleted symbols.
- The new cookie flow might inject cookies with wrong domain/path/sameSite attributes, causing HN to reject the session.
- No commit history means the rewrite intent is opaque — edge cases in host-matching (packages/cookies/src/utils/host-matching.ts, modified) could drop the 'news.ycombinator.com' cookie.

## Assumptions

- The test runner uses the local unstaged build of packages/browser and packages/cookies.
- If cookieSync is enabled, the user has a valid HackerNews session cookie in their local browser profile.
- HackerNews login state is visible via a 'logout' link or username in the top nav when authenticated.
- If no session cookie is synced, the expected outcome flips to 'logged out' — the test still validates the page loads and cookie state is deterministic.

## Steps

### 1. Navigate to HackerNews homepage

Instruction: Open https://news.ycombinator.com in the test browser after cookie sync has been applied.
Expected outcome: Page loads successfully (HTTP 200). The HN top bar is visible with either a username + 'logout' link (authenticated) or a 'login' link (unauthenticated). No JavaScript or network errors related to cookie handling.
Route hint: https://news.ycombinator.com
Changed file evidence: packages/browser/src/create-page.ts, packages/cookies/src/index.ts

### 2. Assert login state in top navigation

Instruction: Inspect the top-right navigation bar. Check for the presence of a 'logout' link (authenticated) or a 'login' link (unauthenticated). Record which state is observed.
Expected outcome: If cookie sync succeeded and the session cookie was correctly injected by the rewritten create-page.ts, a username and 'logout' link appear. If the cookie plumbing regressed, a 'login' link appears instead — this is a signal of breakage.
Route hint: https://news.ycombinator.com
Changed file evidence: packages/browser/src/create-page.ts, packages/cookies/src/utils/host-matching.ts

### 3. Verify cookie is present in browser storage

Instruction: Open browser DevTools (or use the test agent's cookie inspection API) and check document.cookie or the Application > Cookies panel for 'news.ycombinator.com'. Confirm the 'user' cookie (HN session token) is present and non-empty.
Expected outcome: The 'user' cookie exists for the domain news.ycombinator.com with a non-empty value. Absence of this cookie confirms the cookie injection path in create-page.ts or the new cookies package failed.
Route hint: https://news.ycombinator.com
Changed file evidence: packages/browser/src/create-page.ts, packages/cookies/src/index.ts, packages/cookies/src/utils/host-matching.ts

### 4. Navigate to HN profile page to confirm session depth

Instruction: If logged in, click the username link in the top nav to visit the user profile page (https://news.ycombinator.com/user?id=<username>).
Expected outcome: Profile page loads and displays the correct account details (karma, about, etc.) without redirecting to the login page. A redirect to login would indicate the session cookie was injected with incorrect attributes (wrong domain, path, or sameSite) by the rewritten cookie logic.
Route hint: https://news.ycombinator.com/user
Changed file evidence: packages/cookies/src/utils/host-matching.ts, packages/browser/src/create-page.ts
