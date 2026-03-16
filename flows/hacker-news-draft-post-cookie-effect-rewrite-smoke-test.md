---
format_version: 2
title: "Hacker News Draft Post — Cookie Effect Rewrite Smoke Test"
description: "Unstaged changes on cookie-effect-rewrite: 74 files changed (+4258/-4798). Core deletions in packages/cookies (SQLite a…"
slug: "hacker-news-draft-post-cookie-effect-rewrite-smoke-test"
saved_target_scope: "unstaged"
saved_target_display_name: "unstaged changes on cookie-effect-rewrite"
plan: {"title":"Hacker News Draft Post — Cookie Effect Rewrite Smoke Test","rationale":"The diff rewrites the cookies package substantially (deleting SQLite adapters, browser profile detectors, CDP helpers, and normalization utilities) while modifying create-page.ts in the browser package. The user's journey (visit HN, draft a post without submitting) exercises page navigation and form interaction — both surfaces touched by create-page.ts changes. Since the cookies rewrite strips out local-browser cookie extraction in favor of a new approach, verifying that a page loads and a form can be filled without auth errors or cookie-related crashes is the highest-value smoke check for this diff.","targetSummary":"Unstaged changes on cookie-effect-rewrite: 74 files changed (+4258/-4798). Core deletions in packages/cookies (SQLite adapters, browser profile detection, CDP extraction, normalization utils). Key modification in packages/browser/src/create-page.ts. The rewrite likely changes how cookies are sourced/applied when creating browser pages.","assumptions":["Hacker News (news.ycombinator.com) is accessible from the test environment without a proxy or firewall block.","Submitting a post on HN requires a logged-in account; the test explicitly avoids submission, but even drafting the 'submit' form may require authentication to reach the form page at /submit.","cookieSync is set to false because the journey only navigates to public pages and fills a form — it does not require a persisted HN session to assert the UI is reachable and form fields are writable.","If /submit redirects unauthenticated users to /login, the test will hit the login page instead; this is captured as a risk area.","The browser package's create-page.ts changes affect how a new page/tab is initialized; any regression there would surface as a failure to navigate or a thrown exception before the page loads.","No specific HN account credentials are available; the plan assumes the submit form is reachable or that the login redirect itself is an observable, assertable outcome."],"riskAreas":["create-page.ts modification: if the new page initialization logic regresses, navigation to any URL may silently fail or throw — covered by step 1.","Cookie application during page creation: the rewritten cookies package no longer uses SQLite/profile extraction; if the new path has a bug, cookies may not be applied to the page context, causing auth state loss — covered by cookieSync=false decision and step 2.","HN /submit requires login: unauthenticated users are redirected; this means the form-fill steps may never reach the submit form — mitigated by asserting the redirect page is also a valid observable outcome.","Deleted normalization utils (normalize-expiration, normalize-same-site, dedupe-cookies): if these are called anywhere in the new code path, runtime errors could surface during cookie handling mid-navigation.","host-matching.ts was modified (not deleted): any regression in domain matching could cause cookies to be applied to wrong origins or dropped entirely."],"targetUrls":["https://news.ycombinator.com","https://news.ycombinator.com/submit"],"cookieSync":{"required":false,"reason":"Hacker News is a public site. Navigating to the homepage and attempting to reach the submit form does not require a pre-authenticated session to produce meaningful browser assertions. The test deliberately stops before submission. If the submit page redirects to login, that redirect itself is an assertable outcome. No org-gated or account-specific data is needed."},"steps":[{"id":"step-1-homepage","title":"Navigate to Hacker News homepage","instruction":"Open a new browser page and navigate to https://news.ycombinator.com. Wait for the page to fully load.","expectedOutcome":"The Hacker News homepage is visible with the orange header bar, 'Hacker News' logo, and a list of story links. No JavaScript errors or navigation exceptions are thrown during page creation.","routeHint":"https://news.ycombinator.com","changedFileEvidence":["packages/browser/src/create-page.ts","packages/cookies/src/index.ts"]},{"id":"step-2-verify-page-context","title":"Confirm page context and cookie handling are stable","instruction":"Check that the page title contains 'Hacker News' and that the document is interactive (e.g., links are clickable). Optionally inspect document.cookie or network request headers to confirm no cookie-related console errors.","expectedOutcome":"document.title equals 'Hacker News' or contains that string. No uncaught errors appear in the browser console related to cookie parsing, normalization, or host matching.","routeHint":"https://news.ycombinator.com","changedFileEvidence":["packages/cookies/src/utils/host-matching.ts","packages/cookies/src/index.ts"]},{"id":"step-3-navigate-submit","title":"Navigate to the post submission form","instruction":"Click the 'submit' link in the HN navigation bar, or navigate directly to https://news.ycombinator.com/submit.","expectedOutcome":"Either (a) the submission form page loads with fields for 'title', 'url', and 'text', indicating the user is logged in, OR (b) the user is redirected to https://news.ycombinator.com/login, indicating the unauthenticated redirect works correctly. In both cases the page loads without a crash.","routeHint":"https://news.ycombinator.com/submit","changedFileEvidence":["packages/browser/src/create-page.ts"]},{"id":"step-4-login-if-redirected","title":"Handle login redirect (conditional)","instruction":"If the current URL contains '/login', locate the username and password fields. Type a placeholder username (e.g., 'testuser') into the username field and a placeholder password into the password field. Do NOT submit the form.","expectedOutcome":"The login form fields accept keyboard input. The 'login' button is visible. No page crash or unhandled exception occurs during form interaction. This step is skipped if /submit loaded directly.","routeHint":"https://news.ycombinator.com/login","changedFileEvidence":["packages/browser/src/create-page.ts"]},{"id":"step-5-fill-title","title":"Fill in the post title field (if submit form is accessible)","instruction":"If the submit form at /submit is loaded, locate the 'title' input field and type a draft post title such as 'Draft test post — do not submit'.","expectedOutcome":"The title input field shows the typed text 'Draft test post — do not submit'. The field is editable and accepts input without errors.","routeHint":"https://news.ycombinator.com/submit","changedFileEvidence":["packages/browser/src/create-page.ts","packages/cookies/src/index.ts"]},{"id":"step-6-fill-url","title":"Fill in the post URL field","instruction":"Locate the 'url' input field on the submit form and type a placeholder URL such as 'https://example.com/draft'.","expectedOutcome":"The URL field displays 'https://example.com/draft'. Both the title and URL fields retain their values simultaneously, confirming form state is maintained.","routeHint":"https://news.ycombinator.com/submit","changedFileEvidence":["packages/browser/src/create-page.ts"]},{"id":"step-7-verify-no-submit","title":"Verify the submit button is present but do not click it","instruction":"Locate the submit button (input[type=submit] or button with text 'submit') on the form. Assert it is visible and enabled. Do not click it.","expectedOutcome":"The submit button is present and visible in the DOM. The form has not been submitted — the URL remains https://news.ycombinator.com/submit and no confirmation or error page has loaded.","routeHint":"https://news.ycombinator.com/submit","changedFileEvidence":["packages/browser/src/create-page.ts","packages/cookies/src/utils/host-matching.ts"]}],"userInstruction":"go to hackernews and draft a post but dont send it"}
environment: {}
---

# Hacker News Draft Post — Cookie Effect Rewrite Smoke Test

Unstaged changes on cookie-effect-rewrite: 74 files changed (+4258/-4798). Core deletions in packages/cookies (SQLite a…

## User Instruction

go to hackernews and draft a post but dont send it

## Target

- Scope: unstaged
- Display name: unstaged changes on cookie-effect-rewrite
- Current branch: cookie-effect-rewrite
- Main branch: main

## Cookie Sync

- Required: No
- Reason: Hacker News is a public site. Navigating to the homepage and attempting to reach the submit form does not require a pre-authenticated session to produce meaningful browser assertions. The test deliberately stops before submission. If the submit page redirects to login, that redirect itself is an assertable outcome. No org-gated or account-specific data is needed.
- Enabled for this saved flow: No

## Target URLs

- https://news.ycombinator.com
- https://news.ycombinator.com/submit

## Risk Areas

- create-page.ts modification: if the new page initialization logic regresses, navigation to any URL may silently fail or throw — covered by step 1.
- Cookie application during page creation: the rewritten cookies package no longer uses SQLite/profile extraction; if the new path has a bug, cookies may not be applied to the page context, causing auth state loss — covered by cookieSync=false decision and step 2.
- HN /submit requires login: unauthenticated users are redirected; this means the form-fill steps may never reach the submit form — mitigated by asserting the redirect page is also a valid observable outcome.
- Deleted normalization utils (normalize-expiration, normalize-same-site, dedupe-cookies): if these are called anywhere in the new code path, runtime errors could surface during cookie handling mid-navigation.
- host-matching.ts was modified (not deleted): any regression in domain matching could cause cookies to be applied to wrong origins or dropped entirely.

## Assumptions

- Hacker News (news.ycombinator.com) is accessible from the test environment without a proxy or firewall block.
- Submitting a post on HN requires a logged-in account; the test explicitly avoids submission, but even drafting the 'submit' form may require authentication to reach the form page at /submit.
- cookieSync is set to false because the journey only navigates to public pages and fills a form — it does not require a persisted HN session to assert the UI is reachable and form fields are writable.
- If /submit redirects unauthenticated users to /login, the test will hit the login page instead; this is captured as a risk area.
- The browser package's create-page.ts changes affect how a new page/tab is initialized; any regression there would surface as a failure to navigate or a thrown exception before the page loads.
- No specific HN account credentials are available; the plan assumes the submit form is reachable or that the login redirect itself is an observable, assertable outcome.

## Steps

### 1. Navigate to Hacker News homepage

Instruction: Open a new browser page and navigate to https://news.ycombinator.com. Wait for the page to fully load.
Expected outcome: The Hacker News homepage is visible with the orange header bar, 'Hacker News' logo, and a list of story links. No JavaScript errors or navigation exceptions are thrown during page creation.
Route hint: https://news.ycombinator.com
Changed file evidence: packages/browser/src/create-page.ts, packages/cookies/src/index.ts

### 2. Confirm page context and cookie handling are stable

Instruction: Check that the page title contains 'Hacker News' and that the document is interactive (e.g., links are clickable). Optionally inspect document.cookie or network request headers to confirm no cookie-related console errors.
Expected outcome: document.title equals 'Hacker News' or contains that string. No uncaught errors appear in the browser console related to cookie parsing, normalization, or host matching.
Route hint: https://news.ycombinator.com
Changed file evidence: packages/cookies/src/utils/host-matching.ts, packages/cookies/src/index.ts

### 3. Navigate to the post submission form

Instruction: Click the 'submit' link in the HN navigation bar, or navigate directly to https://news.ycombinator.com/submit.
Expected outcome: Either (a) the submission form page loads with fields for 'title', 'url', and 'text', indicating the user is logged in, OR (b) the user is redirected to https://news.ycombinator.com/login, indicating the unauthenticated redirect works correctly. In both cases the page loads without a crash.
Route hint: https://news.ycombinator.com/submit
Changed file evidence: packages/browser/src/create-page.ts

### 4. Handle login redirect (conditional)

Instruction: If the current URL contains '/login', locate the username and password fields. Type a placeholder username (e.g., 'testuser') into the username field and a placeholder password into the password field. Do NOT submit the form.
Expected outcome: The login form fields accept keyboard input. The 'login' button is visible. No page crash or unhandled exception occurs during form interaction. This step is skipped if /submit loaded directly.
Route hint: https://news.ycombinator.com/login
Changed file evidence: packages/browser/src/create-page.ts

### 5. Fill in the post title field (if submit form is accessible)

Instruction: If the submit form at /submit is loaded, locate the 'title' input field and type a draft post title such as 'Draft test post — do not submit'.
Expected outcome: The title input field shows the typed text 'Draft test post — do not submit'. The field is editable and accepts input without errors.
Route hint: https://news.ycombinator.com/submit
Changed file evidence: packages/browser/src/create-page.ts, packages/cookies/src/index.ts

### 6. Fill in the post URL field

Instruction: Locate the 'url' input field on the submit form and type a placeholder URL such as 'https://example.com/draft'.
Expected outcome: The URL field displays 'https://example.com/draft'. Both the title and URL fields retain their values simultaneously, confirming form state is maintained.
Route hint: https://news.ycombinator.com/submit
Changed file evidence: packages/browser/src/create-page.ts

### 7. Verify the submit button is present but do not click it

Instruction: Locate the submit button (input[type=submit] or button with text 'submit') on the form. Assert it is visible and enabled. Do not click it.
Expected outcome: The submit button is present and visible in the DOM. The form has not been submitted — the URL remains https://news.ycombinator.com/submit and no confirmation or error page has loaded.
Route hint: https://news.ycombinator.com/submit
Changed file evidence: packages/browser/src/create-page.ts, packages/cookies/src/utils/host-matching.ts
