# Research Brief — Gemma-owns-plan + ReAct single-agent browsing runtime

Date: 2026-04-24 (revised 2026-04-24 to correct target model from Gemma 3n E4B → Gemma 4 E4B)
Scope: `perf-agent-cli` shift from frontier-planner + Gemma-executor to **Gemma 4 E4B** (Ollama tag `gemma4:e4b`) as sole runtime agent running a ReAct loop (Thought → Action → Observation) with optional mid-run replanning.

This brief collects the primary literature and sources cited in `assessment.md` and `architecture-prd.md`. Each entry is ~100 words with the key insight.

**Note on the model correction (2026-04-24).** The original brief was authored against Gemma 3n E4B specs (MatFormer, 32K context, no documented function calling). The actual production target — confirmed via `ollama show gemma4:e4b` and cross-checked against Google's 2026-04-02 Gemma 4 launch — is **Gemma 4 E4B**, a different architecture (dense hybrid-attention, NOT MatFormer), with 128K context and **native function-calling support**. Sections below marked "(revised)" reflect the corrected target. Several Gemma-3n citations are retained for historical context but **do not govern** architecture decisions for this pivot.

## Theme 1 — ReAct and interleaved reasoning

### Yao et al. 2023, ReAct: Synergizing Reasoning and Acting in Language Models (ICLR 2023)
Paper: https://arxiv.org/abs/2210.03629 · Site: https://react-lm.github.io/ · Code: https://github.com/ysymyth/ReAct

The foundational ReAct paper. Prompts the LLM to generate **interleaved** reasoning traces (`Thought:`) and actions (`Action:`) plus environment observations (`Observation:`), so thinking and acting co-evolve each step. On HotpotQA / FEVER it reduces hallucination vs pure chain-of-thought because actions ground reasoning in external data. On ALFWorld / WebShop ReAct beats imitation + RL baselines by 34% / 10% absolute success with only 1–2 in-context examples. Key claim relevant to our pivot: reasoning traces let the model **update action plans mid-run and handle exceptions** — precisely the dynamic-plan behavior we want Gemma to own.

### Shinn et al. 2023, Reflexion: Language Agents with Verbal Reinforcement Learning (NeurIPS 2023)
Paper: https://arxiv.org/abs/2303.11366 · Code: https://github.com/noahshinn/reflexion

Adds a second loop on top of ReAct: after a trial, an LLM-based self-reflection summarizes what went wrong in natural language, appends the summary to an episodic memory buffer, and the agent retries. No gradient updates. Shows meaningful gains on sequential decision-making, coding, and language reasoning. Relevant pattern for us: the **post-trial reflection** format is a good template for per-turn "did my last action move me closer to the sub-goal?" self-assessment Gemma can run cheaply.

### Wang et al. 2023, Voyager: An Open-Ended Embodied Agent with LLMs
Paper: https://arxiv.org/abs/2305.16291 · Site: https://voyager.minedojo.org/

GPT-4 driving Minecraft via (a) automatic curriculum, (b) growing skill library of executable code, (c) iterative prompting that consumes execution errors + self-verification. The iterative-prompting mechanism is the core lesson: when code fails, the error text + a self-verification LLM's critique are folded back into the next attempt's prompt. Compositional skills emerge. Relevant to us mainly via the **"self-verification as a loop exit criterion"** pattern — Gemma should verify goal satisfaction before emitting `RUN_COMPLETED`, exactly the gap that caused the original Volvo bug.

### LangChain 2024, Plan-and-Execute Agents blog
URL: https://blog.langchain.com/planning-agents/ · LangGraph.js tutorial: https://langchain-ai.github.io/langgraphjs/tutorials/plan-and-execute/plan-and-execute/

Industrial take on Plan-and-Execute vs ReAct. Plan-and-Execute's wins: large model consulted only for planning + replanning, sub-steps can use smaller model, explicit up-front thinking improves task completion. Losses: **no dynamic replanning** in the vanilla form unless you add a "Joiner" step that reviews execution results and decides to continue vs replan. Our current runtime is essentially Plan-and-Execute with Gemini as planner and Gemma as executor, and we hit exactly the limitation the blog names: when Gemma gets stuck, there is no mechanism to revisit the plan.

### dev.to, Jamesli 2024, ReAct vs Plan-and-Execute: A Practical Comparison
URL: https://dev.to/jamesli/react-vs-plan-and-execute-a-practical-comparison-of-llm-agent-patterns-4gh9

Practical comparison aligned with our dimensions: ReAct handles **dynamic environments and mid-run discovery** better (because thoughts interleave with observations), while Plan-and-Execute is **cheaper and more predictable** for well-specified workflows. Web-navigation is closer to "dynamic environment" than "well-specified workflow" because sites change and a 4B-static-plan can't predict menu layouts.

## Theme 2 — Browsing agents (benchmarks + methods)

### Zheng et al. 2024, SeeAct / GPT-4V(ision) is a Generalist Web Agent, if Grounded (ICML 2024)
Paper: https://arxiv.org/abs/2401.01614 · Site: https://osu-nlp-group.github.io/SeeAct/

Three grounding methods evaluated: element attributes, textual choices, image annotation (Set-of-Mark style). **SeeActChoice (textual choice grounding over a short shortlist of candidate elements)** beats the alternatives and is comparable to supervised fine-tuning on Mind2Web. Key warning: GPT-4V **hallucinates bounding-box → label mappings severely** on screenshots with rich semantic/spatial relationships. Screen-element count matters. For us (4B model + SOM overlay), the hallucination rate on dense pages is the biggest risk vector.

### He et al. 2024, WebVoyager: Building an End-to-End Web Agent with Large Multimodal Models (ACL 2024)
Paper: https://arxiv.org/abs/2401.13919 · Code: https://github.com/MinorJerry/WebVoyager

End-to-end LMM web agent hitting 59.1% success on 643 curated tasks across 15 websites. Uses Set-of-Mark prompting directly. GPT-4V-based autoevaluator agrees 85.3% with humans. Relevant takeaway: even with frontier multimodal models, 40%+ tasks still fail — long-tail is dominated by ambiguous layouts, state-tracking across navigations, and captchas. A 4B student distilled from teacher traces will inherit those failure modes.

### Koh et al. 2024, VisualWebArena (ACL 2024)
Site: https://jykoh.com/vwa · Code: https://github.com/web-arena-x/visualwebarena

910 tasks requiring visual understanding across Classifieds/Shopping/Reddit environments. Establishes that text-only HTML grounding alone is insufficient for a meaningful slice of real web tasks. Supports our choice of committing to SOM (Wave 2.C) rather than text-only DOM grounding.

### Zhou et al. 2024, WebArena: A Realistic Web Environment for Building Autonomous Agents (ICLR 2024)
Paper: https://arxiv.org/abs/2307.13854 · Site: https://webarena.dev/ · Code: https://github.com/web-arena-x/webarena

812-task benchmark of realistic self-hosted sites. Original GPT-4 agent: **14.41% task success vs 78.24% human**. By 2026 state-of-the-art had climbed to ~60% single-agent SoTA (still well below human). Implication: web navigation is **very hard** even at frontier scale, and a 4B model starting from zero shot will be far below that unless explicitly trained/distilled for the task.

### Deng et al. 2023, Mind2Web: Towards a Generalist Agent for the Web (NeurIPS 2023 Spotlight)
Paper + site: https://osu-nlp-group.github.io/Mind2Web/ · Code: https://github.com/OSU-NLP-Group/Mind2Web

Canonical cross-domain benchmark: 2,350 open-ended tasks over 137 sites / 31 domains. Introduces the key-node evaluation structure we're reusing in Wave 4. Key nodes are small (often ≤5) and reachable via a specific URL/element/value target. This maps cleanly onto our `KeyNode` schema already in `packages/evals/src/task.ts`.

### Pan et al. 2025, An Illusion of Progress? Assessing the Current State of Web Agents (COLM 2025) — introduces Online-Mind2Web
Paper: https://arxiv.org/abs/2504.01382

300 tasks on 136 real production sites (83 easy / 143 medium / 74 hard). Finding: most "SoTA" frontier agents underperform the original 2024 SeeAct once strict eval is applied. Even Claude Computer Use 3.7 and OpenAI Operator hit only ~61% success. Core lesson: **beware of benchmark contamination** — keep our eval closer to the strict Online-Mind2Web style, and assume real-site difficulty dominates synthetic-site difficulty.

### McGill-NLP 2024, WebLlama — Llama-3-8B-Web
Model card: https://huggingface.co/McGill-NLP/Llama-3-8B-Web · Site: https://webllama.github.io/

8B Llama-3 finetuned on WebLINX (100K+ web navigation traces). **Beats GPT-4V zero-shot by 18% on WebLINX out-of-domain** (28.8% vs 10.5%). Direct evidence that a small model explicitly fine-tuned on browsing trajectories can outperform a frontier multimodal zero-shot. Supports the Gemma-distilled-into-`browsing-gemma` path — small model wins when trained on the right data.

### Lai et al. 2024, AutoWebGLM (KDD 2024)
Paper: https://arxiv.org/abs/2404.03648 · Code: https://github.com/THUDM/AutoWebGLM

ChatGLM3-6B fine-tuned via HTML simplification + curriculum learning (single-step → multi-step → long-horizon) + RL + rejection sampling. Outperforms GPT-4 on AutoWebBench. Directly relevant: the **curriculum staging** is exactly the shape we should target for `browsing-gemma` — start with calibration tasks (trivial-1, trivial-2), then moderate, then journey, then hard Volvo.

### Xu et al. 2025, AgentTrek: Agent Trajectory Synthesis via Guiding Replay with Web Tutorials (ICLR 2025 Spotlight)
Paper: https://arxiv.org/abs/2412.09605 · Code: https://github.com/xlang-ai/AgentTrek · Model: https://huggingface.co/xlangai/AgentTrek-1.0-32B

Three-stage pipeline: (1) harvest tutorials from internet via classifier, (2) convert to task specs, (3) VLM agent replays, VLM evaluator verifies. Produces 10,398 trajectories at ~$0.55/trajectory. Trains Qwen-2.5 7B/32B students. Relevant for Wave 5+: shows teacher-trajectory generation can scale cheaply if the evaluator is also a VLM. Our path is closer to WebLLM — teacher = Gemini 3 Pro / Claude on production sites, student = Gemma 4 E4B.

### Lù et al. 2024, WebLINX (ICML 2024) — referenced via WebLlama
Dataset/benchmark: https://mcgill-nlp.github.io/weblinx/

969 human-demonstrated trajectories, 18.8 avg steps per trajectory. Bigger average steps than AgentTrek (12.1) — the benchmark is **more dialogue-heavy and longer-horizon**. Informs our trajectory target: the Volvo EX90 journey we care about is ~10 steps, well within the WebLINX distribution.

## Theme 3 — Small-model agents + function calling (revised for Gemma 4)

### Google 2026, Gemma 4 launch post (Google blog)
URL: https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/ (retrieved 2026-04-24)

Announces Gemma 4 family (released 2026-04-02): **E2B, E4B, 26B-A4B MoE, 31B dense**. Launch claims include "Native support for function-calling, structured JSON output, and native system instructions" enabling "autonomous agents that can interact with different tools and APIs." Edge models (E2B, E4B) ship with **128K context**; larger models up to 256K. All models natively process video+images; E2B/E4B additionally support audio input. License: Apache 2.0. 31B ranks #3 on Arena open-source leaderboard at launch; 26B "outcompetes models 20x its size."

### Google AI for Developers 2026, Gemma 4 model card (authoritative)
URL: https://ai.google.dev/gemma/docs/core/model_card_4 (retrieved 2026-04-24) · HF mirror: https://huggingface.co/google/gemma-4-E4B-it · HF blog: https://huggingface.co/blog/gemma4

**Authoritative card for our production model** (replaces the Gemma 3n model card previously cited here). Confirmed specs for **Gemma 4 E4B-it**:
- **Architecture**: Dense (**not** MoE, **not** MatFormer — a break from Gemma 3n). 42 layers. Hybrid attention interleaving local sliding-window (512 tokens) with full global attention; final layer is always global.
- **Parameters**: 4.5B effective, 8B with embeddings; vocabulary 262K. Vision encoder ≈150M params, audio encoder ≈300M params.
- **Context length**: **128K tokens** (quadruple Gemma 3n's 32K).
- **Modalities**: Text + Image + Audio (max 30s). "Interleaved Multimodal Input — Freely mix text and images in any order within a single prompt."
- **Image token budget**: configurable per request among **70 / 140 / 280 / 560 / 1120** tokens. Lower for classification/captioning; higher for OCR/document parsing. This replaces the "256 tokens per image" assumption from Gemma 3n.
- **Thinking mode**: native, toggled by placing the special `<|think|>` token at the start of the system prompt. Output wrapped in `<|channel>thought\n…<channel|>`. Per the model card: *"In multi-turn conversations, the historical model output should only include the final response. Thoughts from previous model turns must not be added before the next user turn begins."* Special note: E2B and E4B **always emit thought tags** even if thinking is disabled; other Gemma 4 sizes emit an empty thought block.
- **Function calling (native)**: *"Native support for structured tool use, enabling agentic workflows."* Wire format uses special Gemma 4 tokens: `<|tool_call>call:NAME{arg:<|"|>VALUE<|"|>}<tool_call|>` (responses symmetric with `<|tool_response>…<tool_response|>`). Tools are passed via `processor.apply_chat_template(..., tools=[schema])`.
- **Benchmarks (E4B-it)**: MMLU Pro **69.4%**, AIME 2026 (no tools) **42.5%**, LiveCodeBench v6 **52.0%**, GPQA Diamond **58.6%**, BigBench Extra Hard **33.1%**, Codeforces ELO **940**, MMMU Pro (vision) **52.6%**, MATH-Vision **59.5%**, CoVoST (audio) **35.54**, FLEURS (audio, lower better) **0.08**.
- **Sampling defaults**: temperature=1.0, top_p=0.95, top_k=64.
- **Limitations** (model card verbatim): may struggle with "subtle nuances, sarcasm, or figurative language," "may generate incorrect or outdated factual statements," open-ended / highly complex tasks and common-sense reasoning are called out as weaker. *No "not suitable" section explicitly prohibits web browsing* (a change from Gemma 3n's card, which explicitly listed "real-time information retrieval, web browsing" as not suitable).

**Note on published benchmarks we care about but the card doesn't list**: BFCL (Berkeley Function Calling Leaderboard), Mind2Web, Online-Mind2Web, WebArena. As of 2026-04-24 these scores are **not** in Google's official card and were not found on BFCL's public leaderboard by WebSearch. We will have to measure these ourselves via our existing eval harness.

### Gemma 4 prompt & chat-template format
URL: https://ai.google.dev/gemma/docs/core/prompt-formatting-gemma4 + https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4 (retrieved 2026-04-24)

Chat-template turn format: `<|turn>ROLE\nCONTENT<turn|>` with roles `system`, `user`, `model`. No BOS marker documented. Multimodal placeholders `<|image|>` and `<|audio|>`. Tool-use wire format uses the custom `<|tool_call>…<tool_call|>` tokens above. The docs explicitly advise: *"Always validate function names and arguments before execution."* For our pipeline, this means: when constraining output via grammar, we must either (a) preserve the native token format (preferred — matches training distribution) or (b) override with a JSON schema via Ollama's `format` and accept the distributional shift.

### Ollama `gemma4:e4b` library card
URL: https://ollama.com/library/gemma4:e4b (retrieved 2026-04-24)

Confirmed capabilities from `ollama show gemma4:e4b`: `completion, vision, audio, tools, thinking`. Q4_K_M quantization, 9.6 GB download. Requires Ollama ≥ 0.20.0. Context 131,072 (128K). Matches `ollama show` output in our environment.

### Known integration issues — Ollama + Gemma 4 tool calls (critical for calibration explanation)
URLs (retrieved 2026-04-24):
- https://github.com/ollama/ollama/issues/15315 — *"gemma4:e4b with ollama 0.20.1 still has tool parsing errors"* (open). Parser produces `invalid character '` looking for beginning of value` for `call:write{...}` output; the custom `<|tool_call>` token stream is not round-tripped through Ollama's OpenAI-compat `tool_calls` field.
- https://github.com/ml-explore/mlx-lm/issues/1096 — mlx-lm's `_infer_tool_parser()` lacks detection logic for Gemma 4's markers. Result: *"the OpenAI-compatible `tool_calls` field is never populated and the raw tool call text is returned in `message.content` instead."*
- https://github.com/anomalyco/opencode/issues/20995 — OpenCode + Ollama + gemma4:e4b: OpenAI-compat streaming drops `tool_calls`. **Root cause attributed to the client**: *"The AI SDK (`@ai-sdk/openai-compatible`) or opencode is not properly parsing/recognizing the tool calls from gemma4 in streaming mode."* Qwen3 works in the same pipeline; issue is Gemma-4-specific to the custom token format.
- https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html — vLLM requires explicit `--tool-call-parser gemma4 --reasoning-parser gemma4 --chat-template examples/tool_chat_template_gemma4.jinja --enable-auto-tool-choice` to parse Gemma 4 tool calls correctly. Inference without those flags → tool calls end up as raw tokens in `content`.

**Why this matters for us**: our empirical calibration (Wave 4.5-subset, 2026-04-24) showed Gemma 4 E4B returning text-only responses with `turnCount=1`, `0 tool calls`. Across the above sources, that is the **signature failure mode** of an OpenAI-compat pipeline that doesn't know about Gemma 4's `<|tool_call>…<tool_call|>` special tokens. The model likely *is* emitting tool-call tokens, but Ollama's OpenAI-compat layer (or our AI SDK consumer) is dropping them into `content` as raw text, leaving the `tool_calls` array empty. Our tool-loop counts that as "no tool call" and ends the turn.

### Patil et al. 2025, The Berkeley Function Calling Leaderboard (BFCL) V4 (ICML 2025)
Paper: https://openreview.net/pdf?id=2GmDdhBdDk · Site: https://gorilla.cs.berkeley.edu/leaderboard.html · Repo: https://github.com/ShishirPatil/gorilla

De-facto standard for LLM tool use evaluation. 2000+ question-function-answer pairs. Key insight highlighted by authors: **top models ace single-turn function calls but stumble on memory, multi-turn, and "when not to act" decisions** — exactly our premature-termination failure mode. BFCL-v4 adds agentic evaluation covering these multi-turn cases. **No public BFCL score for Gemma 4 E4B as of 2026-04-24** (WebSearch 2026-04-24). Gemma 3 1B historically scored ~31%; Gemma 4 E4B's native tool-call training should beat that, but we need to verify ourselves.

### Google Developer Blog 2024, FunctionGemma
URL: https://blog.google/technology/developers/functiongemma/ · Guide: https://ai.google.dev/gemma/docs/capabilities/function-calling

Gemma-3 270M variant specifically tuned for function-calling. **Out-of-box accuracy 58%, post-finetune 85%**. **Relevance to Gemma 4 E4B is reduced**: FunctionGemma was the *workaround* for base Gemma 3's lack of native tool support. Gemma 4 E4B advertises native function-calling in the base model, making FunctionGemma-style specialization less critical as a starting point. Still useful as a reference point: even with native tool support, fine-tuning on domain trajectories typically adds another 10–30% to function-calling accuracy on narrow distributions — which remains the motivation for the `browsing-gemma` LoRA (Wave 5).

### Qwen 2024 docs, Function Calling
URL: https://qwen.readthedocs.io/en/latest/framework/function_call.html

Qwen-3 uses Hermes-style tool-use format natively and supports parallel function calls. Qwen2.5-Coder-7B has documented tool-call hallucination cases (HuggingFace discussion): https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/discussions/22. Reinforces that **small instruction-tuned models still hallucinate tool calls without grammar constraints or parser support for their specific wire format**.

### Llamacpp / Outlines / Ollama structured outputs
Ollama docs: https://docs.ollama.com/capabilities/structured-outputs · Ollama blog: https://ollama.com/blog/structured-outputs · Outlines: https://dottxt-ai.github.io/outlines/

Ollama v0.5+ accepts a JSON Schema via the `format` field and generates the grammar on the fly (llama.cpp GBNF under the hood). Constrained decoding guarantees schema-valid output at some latency cost. Outlines uses character-DFA → token-DFA. XGrammar / llguidance support recursive CFGs; Outlines does not. For us: **Ollama's `format: <schema>` remains viable** for forcing structured output, but it forces Gemma 4 away from its native `<|tool_call>…<tool_call|>` format. Two paths, to be decided empirically in Phase R2: (a) **native-tokens path** — fix Ollama tool parsing / swap to llama.cpp with PR #21326 template fix so Gemma 4's native format is round-tripped correctly, (b) **grammar-override path** — use `format: <AgentTurn JSON Schema>` and accept the distributional shift away from training format. Path (a) is closer to how Gemma 4 was trained; path (b) is more portable but relies on Gemma 4 generalizing to JSON output despite `<|tool_call>` being the RLHF-favored shape.

### AI SDK (Vercel) Core docs, generateObject + ai-sdk-ollama provider
generateObject: https://ai-sdk.dev/v4/docs/reference/ai-sdk-core/generate-object · ai-sdk-ollama: https://github.com/jagreehal/ai-sdk-ollama

The provider we're already using (`@ai-sdk/google`) plus its Ollama sibling supports structured output via Zod schemas. V4 supports `mode: "tool" | "json" | "auto"`. V5 has known breakage (GitHub #7791). **Additional caveat (from OpenCode issue #20995)**: `@ai-sdk/openai-compatible`'s streaming tool-call parser does not recognize Gemma 4's `<|tool_call>` markers, so streaming mode drops tool calls into content. For our ReAct pivot, either (a) use non-streaming `generateObject` with `mode: "json"` and our own schema (grammar-override path), or (b) ship a Gemma-4-aware streaming tool-call decoder.

## Theme 4 — Self-verification, replanning triggers, and error handling

### Cemri et al. 2025, Why Do Multi-Agent LLM Systems Fail?
Paper: https://arxiv.org/pdf/2503.13657

Systematic failure taxonomy across multi-agent LLM systems. Verification failures are **21.3% of all failures**: premature termination 6.2%, no/incomplete verification 8.2%, incorrect verification 9.1%. Premature termination is **exactly our original Volvo bug**. Weaker models produce more false-positive "I'm done" signals. Fix: LLM-as-judge external verifier catches hallucinated completion. Our Wave 1.B adherence gate is structurally correct — it is the external verifier. The Wave 2.B prompt rewrite addressed the self-reported side.

### Hamen 2024 / various industry reports, Agent infinite loops + context overflow
Survey via e.g. https://futureagi.substack.com/p/why-do-multi-agent-llm-systems-fail

Secondary failure modes: **infinite loops from retrying the same failed tool** (we have `DOOM_LOOP_THRESHOLD = 3` in `tool-loop.ts`) and **context window overflow after long trajectories** (our Wave 4.6 dormant task). Both failure modes escalate in severity as we move to a ReAct loop because thoughts + observations + tool results accumulate faster than tool-only loops.

### Oswald et al. 2025, Event-Triggered Replanning Mechanisms (survey article)
URL via: https://www.emergentmind.com/topics/event-triggered-replanning-mechanisms

Survey of when-to-replan triggers. Three dominant patterns: **(1)** significant deviation from predicted trajectory, **(2)** subtask failure, **(3)** explicit human/user signal. Reactive (post-failure) replanning is cheaper but slower to converge; proactive (observation-surprise-driven) replanning is more robust but harder to calibrate. For us: start with reactive (replan after N consecutive STEP-level failures or ASSERTION_FAILED without abort), add proactive later if data says so.

### JetBrains Research 2025, Cutting Through the Noise: Smarter Context Management for LLM-Powered Agents
URL: https://blog.jetbrains.com/research/2025/12/efficient-context-management/

Empirical study on coding-agent context. **Keeping a 10-turn sliding window beat summarization** for most observation-masking strategies. When summarization was used, summarizing 21 older turns while keeping 10 most recent verbatim was the sweet spot. For our Wave 4.6 rolling-window design: this validates the plan's "last N=3–5 agent turns verbatim, summarize older" — if we need to compress, summarize older 20 and keep latest 10 verbatim.

## Theme 5 — Safety nets (from the project's memory)

### perfagent-cli memory: feedback_avoid_prompt_overfitting.md (2026-04-23)
Key rule: prompts teach reasoning frameworks, NOT site-specific heuristics. Site patterns belong to distillation (Wave 5). This binds our ReAct prompt design: the prompt must say "read the page, identify the next interactive element that advances your sub-goal" — NOT "click the 'Buy' menu on Volvo pages".

### perfagent-cli memory: feedback_types_over_regex.md (2026-04-24)
Prefer imported types/schemas over regex. We parse ReAct output via `Schema.decodeEffect` on a typed ReAct envelope, not regex line matching.

### perfagent-cli memory: project_target_model_gemma.md + project_lora_name.md
Production target = **Gemma 4 E4B** (Ollama tag `gemma4:e4b`, corrected 2026-04-24). Distilled LoRA = `browsing-gemma`. Frontier models are dev-only (eval A:B vs Gemini 3 Flash + teacher data + LLM-judge).

### perfagent-cli memory: project_post_plan_continuation.md
Current post-plan sequence: baseline provision → manual test → A:B vs Gemini Flash 3 → cleanup → distill. The ReAct pivot slots in **before distill** because distill depends on the trajectory shape the new runtime produces.

## Theme 6 — Framework / codebase context (for cross-reference in the PRD)

- Current execution prompt: `packages/shared/src/prompts.ts` (59-line 4B-tuned rewrite from Wave 2.B).
- Plan decomposer: `packages/supervisor/src/plan-decomposer.ts` (`template` + `frontier` via `generateObject` + Zod schema).
- Planner prompt: `packages/supervisor/src/planner-prompt.ts` (Gemini Flash via AI SDK).
- Adherence gate: `packages/supervisor/src/executor.ts:281-323` (Stream.mapAccumEffect, `premature-run-completed` warning).
- Local-agent tool loop: `packages/local-agent/src/tool-loop.ts` (OpenAI-compat chat completions against Ollama).
- Eval runners: `packages/evals/src/runners/real.ts`, `gemma.ts`, `mock.ts`, `dual.ts`.
- Trace recorder: `packages/evals/src/runners/trace-recorder.ts` — the trace format we'll extend for ReAct events.
- Distill exporter: `packages/evals/src/distill/teacher-data-exporter.ts` — consumes traces, emits OpenAI-chat JSONL for Ollama create.

## Sources

- [ReAct paper (Yao et al. 2023)](https://arxiv.org/abs/2210.03629)
- [ReAct site](https://react-lm.github.io/)
- [ReAct code](https://github.com/ysymyth/ReAct)
- [Reflexion paper (Shinn et al. 2023)](https://arxiv.org/abs/2303.11366)
- [Reflexion code](https://github.com/noahshinn/reflexion)
- [Voyager paper (Wang et al. 2023)](https://arxiv.org/abs/2305.16291)
- [Voyager site](https://voyager.minedojo.org/)
- [LangChain Plan-and-Execute blog](https://blog.langchain.com/planning-agents/)
- [LangGraph.js Plan-and-Execute tutorial](https://langchain-ai.github.io/langgraphjs/tutorials/plan-and-execute/plan-and-execute/)
- [ReAct vs Plan-and-Execute comparison](https://dev.to/jamesli/react-vs-plan-and-execute-a-practical-comparison-of-llm-agent-patterns-4gh9)
- [SeeAct paper (Zheng et al. 2024)](https://arxiv.org/abs/2401.01614)
- [SeeAct site](https://osu-nlp-group.github.io/SeeAct/)
- [WebVoyager paper (He et al. 2024)](https://arxiv.org/abs/2401.13919)
- [WebVoyager code](https://github.com/MinorJerry/WebVoyager)
- [VisualWebArena site](https://jykoh.com/vwa)
- [WebArena paper (Zhou et al. 2024)](https://arxiv.org/abs/2307.13854)
- [WebArena site](https://webarena.dev/)
- [Mind2Web site](https://osu-nlp-group.github.io/Mind2Web/)
- [Mind2Web code](https://github.com/OSU-NLP-Group/Mind2Web)
- [Online-Mind2Web: An Illusion of Progress? (Pan et al. 2025)](https://arxiv.org/abs/2504.01382)
- [WebLlama (Llama-3-8B-Web)](https://huggingface.co/McGill-NLP/Llama-3-8B-Web)
- [WebLlama site](https://webllama.github.io/)
- [AutoWebGLM paper (Lai et al. 2024)](https://arxiv.org/abs/2404.03648)
- [AutoWebGLM code](https://github.com/THUDM/AutoWebGLM)
- [AgentTrek paper (Xu et al. 2025)](https://arxiv.org/abs/2412.09605)
- [AgentTrek code](https://github.com/xlang-ai/AgentTrek)
- [AgentTuning paper](https://huggingface.co/papers/2310.12823)
- [Agent-FLAN paper](https://arxiv.org/html/2403.12881v1)
- [Gemma 4 launch post (Google)](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)
- [Gemma 4 model card (ai.google.dev)](https://ai.google.dev/gemma/docs/core/model_card_4)
- [Gemma 4 E4B-it HuggingFace card](https://huggingface.co/google/gemma-4-E4B-it)
- [Welcome Gemma 4 (HF blog)](https://huggingface.co/blog/gemma4)
- [Gemma 4 DeepMind page](https://deepmind.google/models/gemma/gemma-4/)
- [Agentic Skills on the edge with Gemma 4 (Google Dev blog)](https://developers.googleblog.com/bring-state-of-the-art-agentic-skills-to-the-edge-with-gemma-4/)
- [Gemma 4 function calling docs](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4)
- [Gemma 4 prompt formatting docs](https://ai.google.dev/gemma/docs/core/prompt-formatting-gemma4)
- [Ollama gemma4:e4b library card](https://ollama.com/library/gemma4:e4b)
- [Ollama tool-parsing bug for gemma4:e4b (issue #15315)](https://github.com/ollama/ollama/issues/15315)
- [mlx-lm Gemma 4 tool-call parser missing (issue #1096)](https://github.com/ml-explore/mlx-lm/issues/1096)
- [OpenCode + Ollama Gemma 4 streaming drops tool_calls (issue #20995)](https://github.com/anomalyco/opencode/issues/20995)
- [vLLM Gemma 4 recipe (parser flags)](https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html)
- [Berkeley Function Calling Leaderboard site](https://gorilla.cs.berkeley.edu/leaderboard.html)
- [BFCL paper](https://openreview.net/pdf?id=2GmDdhBdDk)
- [FunctionGemma blog](https://blog.google/technology/developers/functiongemma/)
- [Gemma function calling guide](https://ai.google.dev/gemma/docs/capabilities/function-calling)
- [Qwen function calling docs](https://qwen.readthedocs.io/en/latest/framework/function_call.html)
- [Qwen2.5-Coder-7B tool hallucination report](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/discussions/22)
- [Ollama structured outputs docs](https://docs.ollama.com/capabilities/structured-outputs)
- [Ollama structured outputs blog](https://ollama.com/blog/structured-outputs)
- [AI SDK generateObject (v4)](https://ai-sdk.dev/v4/docs/reference/ai-sdk-core/generate-object)
- [ai-sdk-ollama provider](https://github.com/jagreehal/ai-sdk-ollama)
- [OS-ATLAS paper](https://arxiv.org/abs/2410.23218)
- [Why Multi-Agent LLM Systems Fail (Cemri et al. 2025)](https://arxiv.org/pdf/2503.13657)
- [JetBrains efficient context management](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)
- [Scene Graph-Guided Proactive Replanning](https://arxiv.org/abs/2508.11286)
