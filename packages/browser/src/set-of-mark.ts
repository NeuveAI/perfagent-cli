import { Effect, Layer, Ref, Schema, ServiceMap } from "effect";
import { DevToolsClient } from "./devtools-client";

export const SOM_MAX_IMAGE_WIDTH_PX = 768;
export const SOM_JPEG_QUALITY = 70;
export const SOM_OVERLAY_ID = "__neuve_som_overlay__";
export const SOM_REF_DATA_ATTRIBUTE = "data-neuve-som-ref";

export type SomMimeType = "image/png" | "image/jpeg";

export const SomRefBounds = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type SomRefBounds = typeof SomRefBounds.Type;

export const SomRef = Schema.Struct({
  id: Schema.String,
  selector: Schema.String,
  role: Schema.String,
  bounds: SomRefBounds,
  accessibleName: Schema.optional(Schema.String),
});
export type SomRef = typeof SomRef.Type;

export interface SomRenderResult {
  readonly image: Uint8Array;
  readonly mimeType: SomMimeType;
  readonly refs: ReadonlyArray<SomRef>;
}

export interface SomRenderOptions {
  readonly maxWidth?: number;
  readonly jpegQuality?: number;
  readonly format?: SomMimeType;
}

export interface SomResolvedRef {
  readonly id: string;
  readonly selector: string;
  readonly role: string;
  readonly bounds: SomRefBounds;
  readonly accessibleName?: string;
}

export class RefStaleError extends Schema.ErrorClass<RefStaleError>("RefStaleError")({
  _tag: Schema.tag("RefStaleError"),
  refId: Schema.String,
  reason: Schema.String,
}) {
  message = `Ref "${this.refId}" is stale: ${this.reason}`;
}

export class SomRenderError extends Schema.ErrorClass<SomRenderError>("SomRenderError")({
  _tag: Schema.tag("SomRenderError"),
  cause: Schema.String,
}) {
  message = `Set-of-Mark render failed: ${this.cause}`;
}

interface RefRegistry {
  readonly renderId: number;
  readonly pageUrl: string;
  readonly refs: ReadonlyMap<string, SomRef>;
}

const EMPTY_REGISTRY: RefRegistry = {
  renderId: 0,
  pageUrl: "",
  refs: new Map<string, SomRef>(),
};

export interface SomDomNode {
  readonly tagName: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: ReadonlyArray<SomDomNode>;
  readonly bounds: SomRefBounds;
  readonly visible: boolean;
  readonly accessibleName?: string;
}

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea"]);
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "menuitem",
  "tab",
  "option",
  "combobox",
  "searchbox",
  "textbox",
]);

const isInteractive = (node: SomDomNode): boolean => {
  const tag = node.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  const role = node.attributes.get("role");
  if (role !== undefined && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;
  if (node.attributes.has("onclick")) return true;
  const tabIndex = node.attributes.get("tabindex");
  if (tabIndex !== undefined && tabIndex !== "-1") return true;
  const contentEditable = node.attributes.get("contenteditable");
  if (contentEditable === "" || contentEditable === "true") return true;
  return false;
};

const isExcludedByAria = (node: SomDomNode): boolean => {
  const ariaHidden = node.attributes.get("aria-hidden");
  if (ariaHidden === "true") return true;
  const disabled = node.attributes.get("disabled");
  if (disabled === "" || disabled === "true") return true;
  return false;
};

const deriveRole = (node: SomDomNode): string => {
  const explicit = node.attributes.get("role");
  if (explicit !== undefined && explicit.length > 0) return explicit.toLowerCase();
  const tag = node.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "select") return "select";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const type = node.attributes.get("type")?.toLowerCase() ?? "text";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "submit" || type === "button" || type === "reset") return "button";
    return "textbox";
  }
  return tag;
};

interface EnumeratedNode {
  readonly id: string;
  readonly selector: string;
  readonly role: string;
  readonly bounds: SomRefBounds;
  readonly accessibleName?: string;
}

export const enumerateInteractiveFromTree = (root: SomDomNode): ReadonlyArray<EnumeratedNode> => {
  const out: Array<EnumeratedNode> = [];
  let counter = 0;
  const walk = (node: SomDomNode, selector: string): void => {
    if (isExcludedByAria(node)) return;
    if (!node.visible) return;
    if (isInteractive(node)) {
      counter += 1;
      const role = deriveRole(node);
      const accessibleName = node.accessibleName;
      out.push({
        id: String(counter),
        selector,
        role,
        bounds: node.bounds,
        ...(accessibleName !== undefined ? { accessibleName } : {}),
      });
    }
    const tagCounts = new Map<string, number>();
    for (const child of node.children) {
      const childTag = child.tagName.toLowerCase();
      const index = (tagCounts.get(childTag) ?? 0) + 1;
      tagCounts.set(childTag, index);
      const childSelector = `${selector} > ${childTag}:nth-of-type(${index})`;
      walk(child, childSelector);
    }
  };
  walk(root, root.tagName.toLowerCase());
  return out;
};

interface PageEnumerationResult {
  readonly pageUrl: string;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly refs: ReadonlyArray<SomRef>;
}

const PageEnumerationSchema = Schema.Struct({
  pageUrl: Schema.String,
  viewportWidth: Schema.Number,
  viewportHeight: Schema.Number,
  refs: Schema.Array(SomRef),
});

const buildEnumerationScript = (refAttribute: string, overlayId: string): string => {
  return `
(() => {
  const INTERACTIVE_TAGS = new Set(${JSON.stringify([...INTERACTIVE_TAGS])});
  const INTERACTIVE_ROLES = new Set(${JSON.stringify([...INTERACTIVE_ROLES])});
  const REF_ATTR = ${JSON.stringify(refAttribute)};
  const OVERLAY_ID = ${JSON.stringify(overlayId)};

  const prior = document.getElementById(OVERLAY_ID);
  if (prior) prior.remove();
  document.querySelectorAll("[" + REF_ATTR + "]").forEach((element) => {
    element.removeAttribute(REF_ATTR);
  });

  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom < 0 || rect.right < 0) return false;
    if (rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
    return true;
  };

  const isExcluded = (element) => {
    if (element.getAttribute("aria-hidden") === "true") return true;
    if (element.hasAttribute("disabled")) return true;
    return false;
  };

  const isInteractive = (element) => {
    const tag = element.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) return true;
    const role = element.getAttribute("role");
    if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;
    if (element.hasAttribute("onclick")) return true;
    const tabIndex = element.getAttribute("tabindex");
    if (tabIndex !== null && tabIndex !== "-1") return true;
    const editable = element.getAttribute("contenteditable");
    if (editable === "" || editable === "true") return true;
    return false;
  };

  const deriveRole = (element) => {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit.toLowerCase();
    const tag = element.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "select";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button" || type === "reset") return "button";
      return "textbox";
    }
    return tag;
  };

  const deriveSelector = (element) => {
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      let index = 1;
      for (const sibling of parent.children) {
        if (sibling === node) break;
        if (sibling.tagName.toLowerCase() === tag) index += 1;
      }
      parts.unshift(tag + ":nth-of-type(" + index + ")");
      node = parent;
    }
    return "html > " + parts.join(" > ");
  };

  const accessibleName = (element) => {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    const ariaLabelledby = element.getAttribute("aria-labelledby");
    if (ariaLabelledby) {
      const labelledElement = document.getElementById(ariaLabelledby);
      if (labelledElement) return (labelledElement.textContent || "").trim();
    }
    const text = (element.textContent || "").trim();
    if (text.length > 0) return text.slice(0, 120);
    const title = element.getAttribute("title");
    if (title) return title.trim();
    return undefined;
  };

  const refs = [];
  let counter = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let element = walker.currentNode;
  while (element) {
    if (element.nodeType === 1 && !isExcluded(element) && isVisible(element) && isInteractive(element)) {
      counter += 1;
      const id = String(counter);
      element.setAttribute(REF_ATTR, id);
      const rect = element.getBoundingClientRect();
      const name = accessibleName(element);
      const ref = {
        id,
        selector: deriveSelector(element),
        role: deriveRole(element),
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
      if (name) ref.accessibleName = name;
      refs.push(ref);
    }
    element = walker.nextNode();
  }

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";
  for (const ref of refs) {
    const box = document.createElement("div");
    box.style.cssText = "position:absolute;left:" + ref.bounds.x + "px;top:" + ref.bounds.y + "px;width:" + ref.bounds.width + "px;height:" + ref.bounds.height + "px;outline:2px solid #facc15;background:rgba(250,204,21,0.12);box-sizing:border-box;";
    const label = document.createElement("div");
    label.textContent = ref.id;
    label.style.cssText = "position:absolute;top:-2px;left:-2px;min-width:16px;height:16px;padding:0 4px;background:#facc15;color:#000;font:700 12px/16px monospace;text-align:center;border:1px solid #000;border-radius:2px;";
    box.appendChild(label);
    overlay.appendChild(box);
  }
  document.body.appendChild(overlay);

  return {
    pageUrl: window.location.href,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    refs,
  };
})()
`.trim();
};

const buildCleanupScript = (refAttribute: string, overlayId: string): string => {
  return `
(() => {
  const overlay = document.getElementById(${JSON.stringify(overlayId)});
  if (overlay) overlay.remove();
  document.querySelectorAll("[${refAttribute}]").forEach((element) => {
    element.removeAttribute(${JSON.stringify(refAttribute)});
  });
  return { cleared: true };
})()
`.trim();
};

const parseEvaluateScriptResult = (result: unknown): Effect.Effect<unknown, SomRenderError> =>
  Effect.gen(function* () {
    const content = (result as { content?: ReadonlyArray<{ type: string; text?: string }> })
      .content;
    if (!content || content.length === 0) {
      return yield* new SomRenderError({ cause: "evaluate_script returned empty content" });
    }
    const textEntry = content.find((entry) => entry.type === "text" && entry.text !== undefined);
    if (!textEntry || textEntry.text === undefined) {
      return yield* new SomRenderError({
        cause: "evaluate_script returned no text content",
      });
    }
    const parsed = yield* Effect.try({
      try: () => JSON.parse(textEntry.text as string) as unknown,
      catch: (cause) =>
        new SomRenderError({
          cause: `evaluate_script returned non-JSON: ${String(cause)}`,
        }),
    });
    return parsed;
  });

const decodePageEnumeration = (
  raw: unknown,
): Effect.Effect<PageEnumerationResult, SomRenderError> =>
  Schema.decodeUnknownEffect(PageEnumerationSchema)(raw).pipe(
    Effect.catchTag("SchemaError", (error) =>
      new SomRenderError({
        cause: `enumeration payload failed schema: ${error.message}`,
      }).asEffect(),
    ),
  );

interface ScreenshotPayload {
  readonly image: Uint8Array;
  readonly mimeType: SomMimeType;
}

const parseScreenshotResult = (
  result: unknown,
  requestedFormat: SomMimeType,
): Effect.Effect<ScreenshotPayload, SomRenderError> =>
  Effect.gen(function* () {
    const content = (
      result as {
        content?: ReadonlyArray<{ type: string; data?: string; mimeType?: string; text?: string }>;
      }
    ).content;
    if (!content || content.length === 0) {
      return yield* new SomRenderError({ cause: "take_screenshot returned empty content" });
    }
    const imageEntry = content.find((entry) => entry.type === "image" && entry.data !== undefined);
    if (!imageEntry || imageEntry.data === undefined) {
      return yield* new SomRenderError({
        cause: "take_screenshot returned no image payload",
      });
    }
    const bytes = yield* Effect.try({
      try: () => Uint8Array.from(Buffer.from(imageEntry.data as string, "base64")),
      catch: (cause) =>
        new SomRenderError({
          cause: `failed to decode screenshot base64: ${String(cause)}`,
        }),
    });
    const reportedMime = imageEntry.mimeType;
    const mimeType: SomMimeType =
      reportedMime === "image/png" || reportedMime === "image/jpeg"
        ? reportedMime
        : requestedFormat;
    return { image: bytes, mimeType };
  });

export class SetOfMark extends ServiceMap.Service<
  SetOfMark,
  {
    readonly render: (options?: SomRenderOptions) => Effect.Effect<SomRenderResult, SomRenderError>;
    readonly resolveRef: (refId: string) => Effect.Effect<SomResolvedRef, RefStaleError>;
    readonly getCurrentPageUrl: () => Effect.Effect<string>;
  }
>()("@devtools/SetOfMark", {
  make: Effect.gen(function* () {
    const devtools = yield* DevToolsClient;
    const registry = yield* Ref.make<RefRegistry>(EMPTY_REGISTRY);

    const render = Effect.fn("SetOfMark.render")(function* (options?: SomRenderOptions) {
      const format: SomMimeType = options?.format ?? "image/jpeg";
      const quality = options?.jpegQuality ?? SOM_JPEG_QUALITY;
      yield* Effect.annotateCurrentSpan({ format, quality });

      const enumerationScript = buildEnumerationScript(SOM_REF_DATA_ATTRIBUTE, SOM_OVERLAY_ID);
      const enumerationRaw = yield* devtools.evaluateScript(enumerationScript).pipe(
        Effect.catchTag("DevToolsToolError", (error) =>
          new SomRenderError({
            cause: `evaluate_script failed: ${error.cause}`,
          }).asEffect(),
        ),
      );
      const enumerationParsed = yield* parseEvaluateScriptResult(enumerationRaw);
      const enumeration = yield* decodePageEnumeration(enumerationParsed);

      const screenshotRaw = yield* devtools
        .takeScreenshot({
          format: format === "image/jpeg" ? "jpeg" : "png",
          ...(format === "image/jpeg" ? { quality } : {}),
        })
        .pipe(
          Effect.catchTag("DevToolsToolError", (error) =>
            new SomRenderError({
              cause: `take_screenshot failed: ${error.cause}`,
            }).asEffect(),
          ),
        );
      const screenshot = yield* parseScreenshotResult(screenshotRaw, format);

      const cleanupScript = buildCleanupScript(SOM_REF_DATA_ATTRIBUTE, SOM_OVERLAY_ID);
      yield* devtools
        .evaluateScript(cleanupScript)
        .pipe(
          Effect.catchTag("DevToolsToolError", (error) =>
            Effect.logWarning("SetOfMark cleanup failed", { cause: error.cause }),
          ),
        );

      const refMap = new Map<string, SomRef>();
      for (const ref of enumeration.refs) refMap.set(ref.id, ref);

      yield* Ref.update(registry, (prior) => ({
        renderId: prior.renderId + 1,
        pageUrl: enumeration.pageUrl,
        refs: refMap,
      }));

      yield* Effect.logInfo("SetOfMark rendered", {
        refCount: enumeration.refs.length,
        pageUrl: enumeration.pageUrl,
      });

      return {
        image: screenshot.image,
        mimeType: screenshot.mimeType,
        refs: enumeration.refs,
      };
    });

    const resolveRef = Effect.fn("SetOfMark.resolveRef")(function* (refId: string) {
      const current = yield* Ref.get(registry);
      yield* Effect.annotateCurrentSpan({ refId, renderId: current.renderId });

      if (current.renderId === 0) {
        return yield* new RefStaleError({
          refId,
          reason: "no active Set-of-Mark render — call render() first",
        });
      }

      const pageUrlRaw = yield* devtools.evaluateScript("window.location.href").pipe(
        Effect.catchTag("DevToolsToolError", (error) =>
          new RefStaleError({
            refId,
            reason: `page URL probe failed: ${error.cause}`,
          }).asEffect(),
        ),
      );
      const parsedUrl = yield* parseEvaluateScriptResult(pageUrlRaw).pipe(
        Effect.catchTag("SomRenderError", (error) =>
          new RefStaleError({ refId, reason: error.cause }).asEffect(),
        ),
      );
      const currentUrl = typeof parsedUrl === "string" ? parsedUrl : String(parsedUrl);
      if (currentUrl !== current.pageUrl) {
        return yield* new RefStaleError({
          refId,
          reason: `page navigated from ${current.pageUrl} to ${currentUrl}`,
        });
      }

      const ref = current.refs.get(refId);
      if (ref === undefined) {
        return yield* new RefStaleError({
          refId,
          reason: `ref id not in current render (known ids: ${[...current.refs.keys()].join(",") || "<none>"})`,
        });
      }
      const resolved: SomResolvedRef =
        ref.accessibleName !== undefined
          ? {
              id: ref.id,
              selector: ref.selector,
              role: ref.role,
              bounds: ref.bounds,
              accessibleName: ref.accessibleName,
            }
          : { id: ref.id, selector: ref.selector, role: ref.role, bounds: ref.bounds };
      return resolved;
    });

    const getCurrentPageUrl = Effect.fn("SetOfMark.getCurrentPageUrl")(function* () {
      const current = yield* Ref.get(registry);
      return current.pageUrl;
    });

    return { render, resolveRef, getCurrentPageUrl } as const;
  }),
}) {
  static layerWithoutDevTools = Layer.effect(this)(this.make);
  static layer = this.layerWithoutDevTools.pipe(Layer.provide(DevToolsClient.layer));
}
