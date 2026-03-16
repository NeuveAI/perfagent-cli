// HACK: esbuild injects this before all imports so react-reconciler detects the hook on load.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";

process.setSourceMapsEnabled(true);

const _fiberRoots = new Set();
if (!globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    supportsFlight: true,
    hasUnsupportedRendererAttached: false,
    checkDCE() {},
    renderers: new Map(),
    inject(renderer) {
      const renderId = this.renderers.size + 1;
      this.renderers.set(renderId, renderer);
      return renderId;
    },
    onCommitFiberRoot(_renderId, root) {
      _fiberRoots.add(root);
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    _instrumentationIsActive: true,
    _fiberRoots,
  };
}

// HACK: Ink only calls reconciler.injectIntoDevTools() when DEV=true.
let directory = dirname(fileURLToPath(import.meta.url));
for (let depth = 0; depth < 10; depth++) {
  const candidate = resolve(directory, "node_modules", "ink", "build", "reconciler.js");
  if (existsSync(candidate)) {
    import(pathToFileURL(candidate).href).then((module) => {
      const reconciler = module.default ?? module;
      reconciler?.injectIntoDevTools?.({});
    });
    break;
  }
  directory = dirname(directory);
}

export { _fiberRoots as __inkGrabFiberRoots };
