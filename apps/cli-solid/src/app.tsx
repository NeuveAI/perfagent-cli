import { Logo } from "./renderables/logo";

const App = () => {
  return (
    <box flexDirection="column" width="100%" height="100%">
      <Logo />
      <box paddingLeft={2}>
        <text>perf-agent solid TUI — hello</text>
      </box>
    </box>
  );
};

export default App;
