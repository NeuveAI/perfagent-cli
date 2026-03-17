---
name: onboarding-is-the-problem
description: When Dia (or any Chromium fork) doesn't show a page target in CDP, it means onboarding/first-run UI is blocking. The absence of a page target IS the onboarding problem, not a separate "headless doesn't create pages" issue.
type: feedback
---

When a Chromium-based browser doesn't produce a `page` target in headless CDP mode, do NOT assume "the browser just doesn't create page targets in headless mode." The real cause is onboarding/first-run UI intercepting the normal flow. Fix the onboarding, and the page target will appear.

**Why:** The user corrected this multiple times. Chrome headless always creates a page target. If a Chromium fork doesn't, something (onboarding, setup wizard) is blocking it.

**How to apply:** When debugging CDP issues with missing page targets, focus on finding and disabling the onboarding mechanism rather than working around the missing target.
