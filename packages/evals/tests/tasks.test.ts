import { assert, describe, it } from "vite-plus/test";
import { EvalTask } from "../src/task";
import { calibration1SingleNavPythonDocs } from "../tasks/calibration-1-single-nav-python-docs";
import { calibration2SingleNavNews } from "../tasks/calibration-2-single-nav-news";
import { calibration3TwoStepDocs } from "../tasks/calibration-3-two-step-docs";
import { calibration4TwoStepEcom } from "../tasks/calibration-4-two-step-ecom";
import { calibration5ThreeStepSearch } from "../tasks/calibration-5-three-step-search";
import { hardVolvoEx90 } from "../tasks/hard-volvo-ex90";
import { journey1CarConfiguratorBmw } from "../tasks/journey-1-car-configurator-bmw";
import { journey10MarketplaceFilter } from "../tasks/journey-10-marketplace-filter";
import { journey2EcomCheckout } from "../tasks/journey-2-ecom-checkout";
import { journey3FlightSearch } from "../tasks/journey-3-flight-search";
import { journey4AccountSignup } from "../tasks/journey-4-account-signup";
import { journey5InsuranceQuote } from "../tasks/journey-5-insurance-quote";
import { journey6MediaStreaming } from "../tasks/journey-6-media-streaming";
import { journey7DashboardFilter } from "../tasks/journey-7-dashboard-filter";
import { journey8HelpCenter } from "../tasks/journey-8-help-center";
import { journey9FormWizard } from "../tasks/journey-9-form-wizard";
import { moderate1 } from "../tasks/moderate-1";
import { moderate2 } from "../tasks/moderate-2";
import { trivial1 } from "../tasks/trivial-1";
import { trivial2 } from "../tasks/trivial-2";

const calibrationFixtures = [
  calibration1SingleNavPythonDocs,
  calibration2SingleNavNews,
  calibration3TwoStepDocs,
  calibration4TwoStepEcom,
  calibration5ThreeStepSearch,
];

const journeyFixtures = [
  journey1CarConfiguratorBmw,
  journey2EcomCheckout,
  journey3FlightSearch,
  journey4AccountSignup,
  journey5InsuranceQuote,
  journey6MediaStreaming,
  journey7DashboardFilter,
  journey8HelpCenter,
  journey9FormWizard,
  journey10MarketplaceFilter,
];

const fixtures = [
  trivial1,
  trivial2,
  moderate1,
  moderate2,
  hardVolvoEx90,
  ...calibrationFixtures,
  ...journeyFixtures,
];

describe("EvalTask fixtures", () => {
  for (const fixture of fixtures) {
    it(`decodes fixture ${fixture.id} via Schema.Class`, () => {
      const encoded = EvalTask.make({
        id: fixture.id,
        prompt: fixture.prompt,
        keyNodes: fixture.keyNodes,
        expectedFinalState: fixture.expectedFinalState,
        perfBudget: fixture.perfBudget,
      });
      assert.strictEqual(encoded.id, fixture.id);
      assert.isAbove(encoded.keyNodes.length, 0);
    });
  }

  it("has 2 trivial, 2 moderate, and 1 hard fixture with calibrated key-node counts", () => {
    assert.strictEqual(trivial1.keyNodes.length, 1);
    assert.strictEqual(trivial2.keyNodes.length, 1);
    assert.isAtLeast(moderate1.keyNodes.length, 2);
    assert.isAtMost(moderate1.keyNodes.length, 3);
    assert.isAtLeast(moderate2.keyNodes.length, 2);
    assert.isAtMost(moderate2.keyNodes.length, 3);
    assert.isAtLeast(hardVolvoEx90.keyNodes.length, 5);
  });

  it("has 5 calibration fixtures with calibrated key-node counts", () => {
    assert.strictEqual(calibrationFixtures.length, 5);
    assert.strictEqual(calibration1SingleNavPythonDocs.keyNodes.length, 1);
    assert.strictEqual(calibration2SingleNavNews.keyNodes.length, 1);
    assert.strictEqual(calibration3TwoStepDocs.keyNodes.length, 2);
    assert.strictEqual(calibration4TwoStepEcom.keyNodes.length, 2);
    assert.strictEqual(calibration5ThreeStepSearch.keyNodes.length, 3);
  });

  it("has 10 journey fixtures with 4-8 key nodes each", () => {
    assert.strictEqual(journeyFixtures.length, 10);
    for (const fixture of journeyFixtures) {
      assert.isAtLeast(fixture.keyNodes.length, 4);
      assert.isAtMost(fixture.keyNodes.length, 8);
    }
  });

  it("every journey fixture has at least one perfCapture=required key node", () => {
    for (const fixture of journeyFixtures) {
      const hasRequired = fixture.keyNodes.some((node) => node.perfCapture === "required");
      assert.isTrue(hasRequired, `journey ${fixture.id} missing required perfCapture`);
    }
  });

  it("at least half of fixtures have a perfBudget", () => {
    const withBudget = fixtures.filter((fixture) => fixture.perfBudget !== undefined);
    assert.isAtLeast(withBudget.length, Math.ceil(fixtures.length / 2));
  });

  it("totals 20 fixtures", () => {
    assert.strictEqual(fixtures.length, 20);
  });
});
