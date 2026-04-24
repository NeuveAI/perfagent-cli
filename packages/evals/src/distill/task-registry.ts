import type { EvalTask } from "../task";
import { calibration1SingleNavPythonDocs } from "../../tasks/calibration-1-single-nav-python-docs";
import { calibration2SingleNavNews } from "../../tasks/calibration-2-single-nav-news";
import { calibration3TwoStepDocs } from "../../tasks/calibration-3-two-step-docs";
import { calibration4TwoStepEcom } from "../../tasks/calibration-4-two-step-ecom";
import { calibration5ThreeStepSearch } from "../../tasks/calibration-5-three-step-search";
import { hardVolvoEx90 } from "../../tasks/hard-volvo-ex90";
import { journey1CarConfiguratorBmw } from "../../tasks/journey-1-car-configurator-bmw";
import { journey10MarketplaceFilter } from "../../tasks/journey-10-marketplace-filter";
import { journey2EcomCheckout } from "../../tasks/journey-2-ecom-checkout";
import { journey3FlightSearch } from "../../tasks/journey-3-flight-search";
import { journey4AccountSignup } from "../../tasks/journey-4-account-signup";
import { journey5InsuranceQuote } from "../../tasks/journey-5-insurance-quote";
import { journey6MediaStreaming } from "../../tasks/journey-6-media-streaming";
import { journey7DashboardFilter } from "../../tasks/journey-7-dashboard-filter";
import { journey8HelpCenter } from "../../tasks/journey-8-help-center";
import { journey9FormWizard } from "../../tasks/journey-9-form-wizard";
import { moderate1 } from "../../tasks/moderate-1";
import { moderate2 } from "../../tasks/moderate-2";
import { trivial1 } from "../../tasks/trivial-1";
import { trivial2 } from "../../tasks/trivial-2";

/**
 * allEvalTasks — full 20-task registry used by distill scripts to resolve
 * `traces/<runner>__<taskId>.ndjson` back to the original EvalTask (and its
 * user prompt) at export time. Kept explicit — no glob, no re-export barrel —
 * so a missing task fails to compile rather than silently dropping.
 */
export const allEvalTasks: ReadonlyArray<EvalTask> = [
  trivial1,
  trivial2,
  moderate1,
  moderate2,
  hardVolvoEx90,
  calibration1SingleNavPythonDocs,
  calibration2SingleNavNews,
  calibration3TwoStepDocs,
  calibration4TwoStepEcom,
  calibration5ThreeStepSearch,
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
