import { createSignal, onMount, For, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { HealthCheckResult } from "../../lifecycle/health-checks";
import { runHealthChecks } from "../../lifecycle/health-checks";
import { useNavigation, Screen } from "../../context/navigation";
import { useAgent } from "../../context/agent";
import { useToast } from "../../context/toast";
import { Logo } from "../../renderables/logo";
import { Spinner } from "../../renderables/spinner";
import { COLORS } from "../../constants";

const TICK = "\u2714";
const CROSS = "\u2718";

export const StartupScreen = () => {
  const navigation = useNavigation();
  const agent = useAgent();
  const toast = useToast();

  const [results, setResults] = createSignal<readonly HealthCheckResult[] | undefined>(undefined);
  const [running, setRunning] = createSignal(true);

  onMount(async () => {
    try {
      const checkResults = await runHealthChecks(agent.agentBackend());
      setResults(checkResults);
      setRunning(false);

      const allPassed = checkResults.every((result) => result.passed);
      if (allPassed) {
        navigation.setScreen(Screen.Main());
      }
    } catch (error) {
      toast.show(`Startup health check failed: ${String(error)}`);
      setResults([
        {
          name: "Health check",
          passed: false,
          message: `Health checks crashed: ${String(error)}`,
        },
      ]);
      setRunning(false);
    }
  });

  useKeyboard((event) => {
    if (event.name === "return" && !running()) {
      navigation.setScreen(Screen.Main());
    }
  });

  return (
    <box
      flexDirection="column"
      width="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
    >
      <box marginBottom={1}>
        <Logo />
      </box>

      <Show when={running()}>
        <box>
          <Spinner />
          <text style={{ fg: COLORS.SHIMMER_HIGHLIGHT }}>{" Checking prerequisites..."}</text>
        </box>
      </Show>

      <Show when={!running() && results()}>
        {(resultList) => (
          <box flexDirection="column">
            <For each={resultList()}>
              {(result) => (
                <box flexDirection="column">
                  <text>
                    <Show
                      when={result.passed}
                      fallback={<span style={{ fg: COLORS.RED }}>{CROSS}</span>}
                    >
                      <span style={{ fg: COLORS.GREEN }}>{TICK}</span>
                    </Show>
                    <span>{` ${result.name}`}</span>
                  </text>
                  <Show when={!result.passed && result.message}>
                    {(message) => (
                      <text style={{ fg: COLORS.DIM }}>{`  ${message()}`}</text>
                    )}
                  </Show>
                </box>
              )}
            </For>
            <Show when={resultList().some((result) => !result.passed)}>
              <box marginTop={1}>
                <text style={{ fg: COLORS.DIM }}>
                  {"Press "}
                  <span style={{ fg: COLORS.PRIMARY }}>enter</span>
                  {" to continue anyway, "}
                  <span style={{ fg: COLORS.PRIMARY }}>ctrl+q</span>
                  {" to quit"}
                </text>
              </box>
            </Show>
          </box>
        )}
      </Show>
    </box>
  );
};
