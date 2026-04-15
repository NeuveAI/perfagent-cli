import * as React from "react";
import { Box, Text } from "ink";
import figures from "figures";

interface ErrorBoundaryProps {
  label: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  message: string | undefined;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { message: undefined };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error);
    return { message };
  }

  componentDidCatch(error: unknown): void {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[${this.props.label}] ${message}`);
  }

  render(): React.ReactNode {
    if (this.state.message !== undefined) {
      return (
        <Box flexDirection="column" paddingX={1} paddingY={1}>
          <Text color="red" bold>
            {figures.warning} {this.props.label} crashed
          </Text>
          <Box marginTop={1}>
            <Text color="gray">{this.state.message}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">
              Press <Text color="red">esc</Text> to return
            </Text>
          </Box>
        </Box>
      );
    }
    return this.props.children;
  }
}
