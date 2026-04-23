import { EvalTask, KeyNode } from "../src/task";

export const calibration1SingleNavPythonDocs = new EvalTask({
  id: "calibration-1-single-nav-python-docs",
  prompt:
    "Open the official Python 3 documentation landing page and confirm the home page rendered.",
  keyNodes: [
    new KeyNode({
      urlPattern: "^https://docs\\.python\\.org/3/?$",
      domAssertion: "h1",
      perfCapture: "optional",
    }),
  ],
  expectedFinalState: {
    urlPattern: "^https://docs\\.python\\.org/3/?$",
    domAssertion: "Python",
  },
});
