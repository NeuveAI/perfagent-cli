import { Schema } from "effect";

export class ModelfileBuilderError extends Schema.ErrorClass<ModelfileBuilderError>(
  "ModelfileBuilderError",
)({
  _tag: Schema.tag("ModelfileBuilderError"),
  reason: Schema.String,
}) {
  message = `Failed to build Modelfile: ${this.reason}`;
}

/**
 * Ollama Modelfile directives we emit. Documented at
 * https://github.com/ollama/ollama/blob/main/docs/modelfile.md — directives
 * are all-caps keywords at the start of a line, optionally followed by an
 * argument or a `"""` heredoc. We centralize the directive set here so
 * future edits change one place.
 *
 * Every directive we emit is one of these literals; passing a string outside
 * this set is a programming error.
 */
export const MODELFILE_DIRECTIVES = [
  "FROM",
  "ADAPTER",
  "PARAMETER",
  "SYSTEM",
  "TEMPLATE",
  "MESSAGE",
  "LICENSE",
] as const;
export type ModelfileDirective = (typeof MODELFILE_DIRECTIVES)[number];

export interface ParameterEntry {
  readonly name: string;
  readonly value: string | number;
}

/**
 * Ollama Modelfile `MESSAGE` directive accepts only `system | user | assistant`.
 * `tool` is NOT a valid Modelfile MESSAGE role — Ollama's chat-history format
 * at the Modelfile level predates tool-calling and uses plain chat turns.
 * Callers that need tool-call context in a few-shot example should inline the
 * tool call + result into the surrounding assistant turn as
 * `<tool_calls>...</tool_calls>` / `<tool_result>...</tool_result>` text
 * blocks. (Round 1 review C2.)
 */
export const MODELFILE_MESSAGE_ROLES = ["system", "user", "assistant"] as const;
export type ModelfileMessageRole = (typeof MODELFILE_MESSAGE_ROLES)[number];

export interface MessageEntry {
  readonly role: ModelfileMessageRole;
  readonly content: string;
}

export interface BuildModelfileInput {
  readonly baseModel: string;
  readonly adapterPath?: string;
  readonly systemPrompt?: string;
  readonly template?: string;
  readonly parameters?: ReadonlyArray<ParameterEntry>;
  readonly exampleMessages?: ReadonlyArray<MessageEntry>;
  readonly header?: string;
}

const HEREDOC_OPEN = '"""';
const HEREDOC_CLOSE = '"""';

const renderHeredoc = (body: string): string => {
  const trimmed = body.endsWith("\n") ? body.slice(0, -1) : body;
  return `${HEREDOC_OPEN}\n${trimmed}\n${HEREDOC_CLOSE}`;
};

const needsHeredoc = (body: string): boolean =>
  body.includes("\n") || body.includes('"') || body.includes("\\");

const renderDirective = (directive: ModelfileDirective, body: string): string => {
  if (needsHeredoc(body)) {
    return `${directive} ${renderHeredoc(body)}`;
  }
  return `${directive} ${body}`;
};

const validateBaseModel = (baseModel: string): void => {
  if (baseModel.length === 0) {
    throw new ModelfileBuilderError({ reason: "baseModel must not be empty" });
  }
  if (/\s/.test(baseModel)) {
    throw new ModelfileBuilderError({
      reason: `baseModel must not contain whitespace: ${JSON.stringify(baseModel)}`,
    });
  }
};

const validateParameter = (entry: ParameterEntry): void => {
  if (entry.name.length === 0) {
    throw new ModelfileBuilderError({ reason: "PARAMETER name must not be empty" });
  }
  if (/\s/.test(entry.name)) {
    throw new ModelfileBuilderError({
      reason: `PARAMETER name must not contain whitespace: ${JSON.stringify(entry.name)}`,
    });
  }
};

const validateMessageRole = (entry: MessageEntry): void => {
  const isValid = (MODELFILE_MESSAGE_ROLES as ReadonlyArray<string>).includes(entry.role);
  if (!isValid) {
    throw new ModelfileBuilderError({
      reason: `MESSAGE role must be one of ${MODELFILE_MESSAGE_ROLES.join("|")}: got ${JSON.stringify(entry.role)}`,
    });
  }
};

/**
 * buildModelfile — render Ollama Modelfile text from an input spec.
 *
 * Modelfile grammar reference:
 *   FROM <base model reference>
 *   PARAMETER <name> <value>
 *   TEMPLATE """..."""
 *   SYSTEM """..."""
 *   ADAPTER <path/to/adapter>        # LoRA adapter for fine-tune
 *   MESSAGE <role> <content>         # few-shot example
 *
 * Throws `ModelfileBuilderError` on invalid inputs. This is a pure synchronous
 * builder — the CLI script wraps it in an Effect and writes the result.
 */
export const buildModelfile = (input: BuildModelfileInput): string => {
  validateBaseModel(input.baseModel);
  const parameters = input.parameters ?? [];
  for (const parameter of parameters) {
    validateParameter(parameter);
  }
  const exampleMessages = input.exampleMessages ?? [];
  for (const message of exampleMessages) {
    validateMessageRole(message);
  }

  const lines: string[] = [];
  if (input.header !== undefined && input.header.length > 0) {
    for (const line of input.header.split("\n")) {
      lines.push(`# ${line}`);
    }
    lines.push("");
  }
  lines.push(renderDirective("FROM", input.baseModel));
  if (input.adapterPath !== undefined && input.adapterPath.length > 0) {
    lines.push(renderDirective("ADAPTER", input.adapterPath));
  }
  for (const parameter of parameters) {
    lines.push(`PARAMETER ${parameter.name} ${parameter.value}`);
  }
  if (input.template !== undefined && input.template.length > 0) {
    lines.push(renderDirective("TEMPLATE", input.template));
  }
  if (input.systemPrompt !== undefined && input.systemPrompt.length > 0) {
    lines.push(renderDirective("SYSTEM", input.systemPrompt));
  }
  for (const message of exampleMessages) {
    if (needsHeredoc(message.content)) {
      lines.push(`MESSAGE ${message.role} ${renderHeredoc(message.content)}`);
    } else {
      lines.push(`MESSAGE ${message.role} ${message.content}`);
    }
  }
  return `${lines.join("\n")}\n`;
};
