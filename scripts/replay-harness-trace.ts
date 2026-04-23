import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";

const printUsage = (): void => {
  process.stderr.write(
    [
      "Usage: pnpm tsx scripts/replay-harness-trace.ts <trace.ndjson>",
      "",
      "Reads a harness trace ndjson file and re-emits every line verbatim to stdout.",
      "The replay is byte-equivalent to the original file content excluding trailing whitespace-only lines.",
      "",
    ].join("\n"),
  );
};

const parseArgs = (argv: readonly string[]): string | undefined => {
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  return positional[0];
};

const main = (): void => {
  const tracePath = parseArgs(process.argv.slice(2));
  if (tracePath === undefined) {
    printUsage();
    process.exit(2);
    return;
  }

  const absolutePath = path.resolve(process.cwd(), tracePath);
  if (!fs.existsSync(absolutePath)) {
    process.stderr.write(`Trace file not found: ${absolutePath}\n`);
    process.exit(1);
    return;
  }

  const raw = fs.readFileSync(absolutePath, "utf8");
  const lines = raw.split("\n");

  let emittedCount = 0;
  for (const line of lines) {
    if (line.length === 0) continue;
    try {
      JSON.parse(line);
    } catch (cause) {
      process.stderr.write(
        `Malformed ndjson at line ${emittedCount + 1}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      );
      process.exit(1);
      return;
    }
    process.stdout.write(line);
    process.stdout.write("\n");
    emittedCount += 1;
  }

  process.stderr.write(`Replayed ${emittedCount} events from ${absolutePath}\n`);
};

main();
