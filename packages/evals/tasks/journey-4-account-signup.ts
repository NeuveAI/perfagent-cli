import { EvalTask, KeyNode } from "../src/task";

export const journey4AccountSignup = new EvalTask({
  id: "journey-4-account-signup",
  prompt:
    "Starting from the Figma landing page, begin creating a new free account by entering a plausible email address, a password, and accepting the terms of service. Stop just before final submission so no real account is created.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://www\\.figma\\.com/?$",
      domAssertion: "a[href*='signup'], a[href*='sign_up'], a:has-text('Sign up')",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.figma\\.com/(signup|login/signup)",
      domAssertion: "input[type='email'], input[name='email']",
      perfCapture: "required",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.figma\\.com/(signup|login/signup)",
      domAssertion: "input[type='password']",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.figma\\.com/(signup|login/signup)",
      domAssertion: "input[type='checkbox'], [role='checkbox']",
    }),
    new KeyNode({
      urlPattern: "^https://www\\.figma\\.com/(signup|login/signup)",
      domAssertion: "button[type='submit']",
      perfCapture: "optional",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://www\\.figma\\.com/(signup|login/signup)",
    domAssertion: "account",
  },
});
