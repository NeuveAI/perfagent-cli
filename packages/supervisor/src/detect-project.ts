import { Effect, FileSystem } from "effect";
import { join } from "node:path";
import { FRAMEWORK_DEFAULT_PORTS } from "./constants";

type Framework =
  | "next"
  | "vite"
  | "angular"
  | "remix"
  | "astro"
  | "nuxt"
  | "sveltekit"
  | "gatsby"
  | "create-react-app"
  | "unknown";

interface ProjectDetection {
  framework: Framework;
  defaultPort: number;
  customPort: number | undefined;
}

const FRAMEWORK_DETECTION_ORDER: Array<[string, Framework]> = [
  ["next", "next"],
  ["@angular/core", "angular"],
  ["@remix-run/react", "remix"],
  ["astro", "astro"],
  ["nuxt", "nuxt"],
  ["@sveltejs/kit", "sveltekit"],
  ["gatsby", "gatsby"],
  ["react-scripts", "create-react-app"],
  ["vite", "vite"],
];

const VITE_BASED_FRAMEWORKS = new Set<Framework>(["vite", "remix", "astro", "sveltekit"]);
const PORT_FLAG_REGEX = /(?:--port|-p)\s+(\d+)/;
const VITE_PORT_REGEX = /port\s*:\s*(\d+)/;

const hasDependency = (packageJson: Record<string, unknown>, name: string): boolean => {
  const deps = packageJson["dependencies"];
  const devDeps = packageJson["devDependencies"];
  return Boolean(
    (deps && typeof deps === "object" && name in deps) ||
    (devDeps && typeof devDeps === "object" && name in devDeps),
  );
};

const detectFramework = (packageJson: Record<string, unknown> | undefined): Framework => {
  if (!packageJson) return "unknown";

  for (const [dependency, framework] of FRAMEWORK_DETECTION_ORDER) {
    if (hasDependency(packageJson, dependency)) return framework;
  }

  return "unknown";
};

const readPackageJson = Effect.fn("detectProject.readPackageJson")(function* (projectRoot: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const packageJsonPath = join(projectRoot, "package.json");

  const content = yield* fileSystem
    .readFileString(packageJsonPath)
    .pipe(Effect.catchTag("PlatformError", () => Effect.succeed(undefined)));

  if (!content) return undefined;

  return yield* Effect.try({
    try: () => JSON.parse(content) as Record<string, unknown>,
    catch: () => undefined,
  });
});

const detectPortFromDevScript = (
  packageJson: Record<string, unknown> | undefined,
): number | undefined => {
  if (!packageJson) return undefined;
  const scripts = packageJson["scripts"];
  if (!scripts || typeof scripts !== "object") return undefined;
  const devScript = (scripts as Record<string, unknown>)["dev"];
  if (typeof devScript !== "string") return undefined;
  const flagMatch = PORT_FLAG_REGEX.exec(devScript);
  if (flagMatch) return Number(flagMatch[1]);
  return undefined;
};

const detectPortFromViteConfig = Effect.fn("detectProject.detectPortFromViteConfig")(function* (
  projectRoot: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;

  const entries = yield* fileSystem
    .readDirectory(projectRoot)
    .pipe(Effect.catchTag("PlatformError", () => Effect.succeed([] as string[])));

  const viteConfig = entries.find((entry) => entry.startsWith("vite.config."));
  if (!viteConfig) return undefined;

  const content = yield* fileSystem
    .readFileString(join(projectRoot, viteConfig))
    .pipe(Effect.catchTag("PlatformError", () => Effect.succeed(undefined)));

  if (!content) return undefined;

  const portMatch = VITE_PORT_REGEX.exec(content);
  if (portMatch) return Number(portMatch[1]);
  return undefined;
});

export const detectProject = Effect.fn("detectProject")(function* (projectRoot?: string) {
  const root = projectRoot ?? process.cwd();
  const packageJson = yield* readPackageJson(root);
  const framework = detectFramework(packageJson);
  const defaultPort = FRAMEWORK_DEFAULT_PORTS[framework] ?? 3000;

  const scriptPort = detectPortFromDevScript(packageJson);
  let customPort: number | undefined = scriptPort;

  if (!customPort && VITE_BASED_FRAMEWORKS.has(framework)) {
    customPort = yield* detectPortFromViteConfig(root);
  }

  return { framework, defaultPort, customPort } satisfies ProjectDetection;
});
