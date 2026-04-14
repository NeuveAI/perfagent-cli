# Tool-Call Healing, Function-Call Repair & Schema-Guided Decoding — Literature Survey

Scope: academic + industry literature on why LLM tool calls go wrong at the
schema boundary — especially in small, open-weight models — and what the
field has proposed to heal them. Framed against perf-agent-cli's concrete
problem (Gemma 4 E4B emitting `{"command":"start"}` when the schema demands
`{"action":{"command":"start"}}`).

## 1. Summary (TL;DR)

- **Wrong-shape tool-call errors are a recognized, well-studied failure
  class.** BFCL, NESTFUL, JSONSchemaBench, TOOLDEC, and "Schema First Tool
  APIs" all document that small/local models trip on nested or wrapped
  schemas long before semantics.
- **Two mitigation families dominate: hard (constrained decoding) and soft
  (repair / re-prompt / few-shot).** The hard family (Outlines, XGrammar,
  TOOLDEC, LM-Format-Enforcer) makes malformed JSON literally impossible
  but needs logit access — unavailable over Ollama's OpenAI-format
  endpoint. The soft family (Instructor, LangChain retry parsers,
  structured reflection) works over any API but costs extra round-trips.
- **Flattening nested schemas is the most-cited single intervention.**
  NESTFUL (GPT-4o @ 28% on nested API chains) and the samchon/typia
  harness writeup ("10 variants × 3 levels = 1,000 paths") argue flat
  schemas are the highest-leverage fix.
- **Few-shot wire-shape examples in tool descriptions measurably help.**
  Manduzio et al. 2024, He 2024, and the Instructor docs converge on:
  show the model the literal JSON it must emit, not just a schema.
- **No paper isolates the "single-key wrapper around a discriminated
  union" failure mode**, but samchon and Sigdel & Baral 2026 are strong
  indirect evidence that this exact wrapper pattern is hard for small
  models.

## 2. Annotated Bibliography

### Willard & Louf (2023) — *Efficient Guided Generation for LLMs*
Brandon T. Willard, Rémi Louf. arXiv, July 2023. [arXiv:2307.09702](https://arxiv.org/abs/2307.09702).
Reformulates constrained generation as FSM transitions over the
vocabulary, masking tokens that would violate a regex/CFG at each decode
step. Implemented as Outlines; guarantees JSON validity. Foundational for
the whole "hard" mitigation family. *Relevance:* would make our wrapper
key un-droppable — but requires logit access we don't have via Ollama's
OpenAI endpoint.

### Dong et al. (2024) — *XGrammar*
Yixin Dong, Charlie Ruan, Yaxing Cai, Ruihang Lai, et al. arXiv / MLSys
2025. [arXiv:2411.15100](https://arxiv.org/abs/2411.15100).
Pushdown-automaton grammar decoder precomputing context-independent token
validity; up to 100× speed-up vs Outlines, near-zero overhead vs
unconstrained decoding. *Relevance:* proves grammar-guided decoding is
production-viable. Option if perf-agent-cli ever moves off the OpenAI
shim onto vLLM / llama.cpp direct.

### Geng et al. (2025) — *JSONSchemaBench*
Saibo Geng, Hudson Cooper, Michał Moskal, Samuel Jenkins, Julian Berman,
Nathan Ranchin, Robert West, Eric Horvitz, Harsha Nori. arXiv, Jan 2025.
[arXiv:2501.10868](https://arxiv.org/abs/2501.10868).
10K real-world JSON schemas across six frameworks (Guidance, Outlines,
llama.cpp, XGrammar, OpenAI, Gemini). Coverage varies sharply per
constraint type and framework. *Relevance:* counterweight to "just use
Outlines" — even SOTA decoders drop coverage on complex features.

### Zhang et al. (2023) — *TOOLDEC: Don't Fine-Tune, Decode*
Kexun Zhang, Hongqiao Chen, Lei Li, William Wang. arXiv, Oct 2023.
[arXiv:2310.07075](https://arxiv.org/abs/2310.07075).
FSM-constrained decoding for tool syntax. Lifts Mistral-Instruct from 0%
to 52% on tool-use benchmarks — matching fine-tuned ToolLLM without any
training. *Relevance:* strong evidence that small-model tool failures are
*structural* before they're semantic.

### Basu et al. (2024/25) — *NESTFUL*
Kinjal Basu, Ibrahim Abdelaziz, Kiran Kate, Mayank Agarwal, Maxwell
Crouse, Yara Rizk, et al. (IBM). EMNLP 2025.
[arXiv:2409.03797](https://arxiv.org/abs/2409.03797) ·
[ACL](https://aclanthology.org/2025.emnlp-main.1702/).
1,800+ executable nested-API sequences. GPT-4o — the best model — hits
only 28% full-sequence accuracy and 60% win-rate; models "falter as the
complexity of the nesting increases, particularly in scenarios requiring
intricate data dependencies." *Relevance:* most direct empirical support
for P2. If GPT-4o is at 28%, Gemma 4 E4B has no chance on our 15-branch
discriminated union.

### Su et al. (2025) — *Failure Makes the Agent Stronger*
Junhao Su, Yuanliang Wan, Junwei Yang, Hengyu Shi, Tianyang Han, Junfeng
Luo, Yurui Qiu. arXiv, Sep 2025.
[arXiv:2509.18847](https://arxiv.org/abs/2509.18847).
Trains the model to explicitly diagnose failures, generate structured
reflection, then emit a repaired call. Introduces Tool-Reflection-Bench;
meaningful multi-turn gains on BFCL v3. *Relevance:* cautions that plain
error-in-loop (what our tool-loop already does) plateaus without a
structured reflection step.

### Manduzio et al. (2024) — *Improving Small-Scale LLMs Function Calling*
Graziano A. Manduzio, Federico A. Galatolo, Mario G. C. A. Cimino, Enzo
Pasquale Scilingo, Lorenzo Cominelli. arXiv, Oct 2024.
[arXiv:2410.18890](https://arxiv.org/abs/2410.18890).
Injects function descriptions *and examples* in the prompt, then
fine-tunes small models via DPO on correct/incorrect chains distilled
from a large model. *Relevance:* direct evidence for P1 — examples in
the prompt improve small-model FC.

### Sigdel & Baral (2026) — *Schema First Tool APIs for LLM Agents*
Akshey Sigdel, Rista Baral. arXiv, March 2026.
[arXiv:2603.13404](https://arxiv.org/abs/2603.13404).
A/B/C controlled study: free-form docs vs strict JSON Schema vs schema
+ validation diagnostics. Schema conditions "reduce interface misuse but
fail to improve semantic action quality or task success." Recovery and
budget are first-class metrics. *Relevance:* strict schemas alone aren't
enough — pair with semantic hints (P1 on top of P0).

### He (2024) — *Prompt-Engineering-Only Tool Calling*
Shengtao He (Hunan University). arXiv, July 2024.
[arXiv:2407.04997](https://arxiv.org/abs/2407.04997).
Readable in-prompt tool spec (name / description / params / required)
plus regex extraction; 100% extraction across four models.
*Relevance:* prompt-layer P1 scales to small models when examples are in
literal wire shape.

### Patil et al. — *Berkeley Function-Calling Leaderboard (BFCL)*
Shishir G. Patil et al. OpenReview 2024–2026. [paper](https://openreview.net/pdf?id=2GmDdhBdDk) ·
[leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html).
AST-based eval of serial / parallel / multi-lingual FC. Shows a
performance cliff on sub-13B open-weight models; "prompting and parsing
techniques" materially lift open models. *Relevance:* industry-standard
ruler for the class of failure we're hitting.

### Schick et al. (2023) — *Toolformer*
Schick, Dwivedi-Yu, Dessì, Raileanu, Lomeli, Zettlemoyer, Cancedda,
Scialom. NeurIPS 2023. [arXiv:2302.04761](https://arxiv.org/abs/2302.04761).
Self-supervised training that lets a model decide which APIs to call and
how to weave results into generation. *Relevance:* historical anchor.
Shows that tool-call reliability has been a first-class concern since
the earliest tool-use papers.

### Industry writeups (practitioner evidence)

- **samchon / typia** — ["Function Calling Harness: 6.75% → 100%"](https://dev.to/samchon/qwen-meetup-function-calling-harness-from-675-to-100-3830).
  Lenient parse + type coercion + error-annotated re-prompting brought
  Qwen 3.5 from 6.75% to 100% on a 30-variant recursive-union schema.
  Verbatim: *"Recursive union types cause combinatorial explosion. 10
  variants nested 3 levels deep create 1,000 paths."* Supports P0 + P2.
- **["3 Patterns That Fix LLM API Calling"](https://dev.to/docat0209/3-patterns-that-fix-llm-api-calling-stop-getting-hallucinated-parameters-4n3b)** (2026).
  Verbatim: flattening is *"the single highest-impact change you can
  make,"* reducing parameter hallucination *"roughly 40–60% on complex
  APIs."* Supports P2.
- **[Instructor docs](https://python.useinstructor.com/concepts/reask_validation/)** —
  Pydantic validation-error re-ask loop. Same pattern our tool-loop
  uses at the MCP-error level.
- **[LangChain RetryWithErrorOutputParser](https://python.langchain.com/v0.2/docs/how_to/output_parser_retry/)** —
  Industry-standard retry-with-error-context.
- **[LM-Format-Enforcer](https://github.com/noamgat/lm-format-enforcer)** —
  Logit-level JSON-Schema enforcement; works with llama.cpp / vLLM /
  transformers but not Ollama's OpenAI endpoint.

## 3. Taxonomy of Healing Strategies

| Class | Representative work | Perf-agent-cli relationship |
|-------|--------------------|-----------------------------|
| Constrained decoding (hard) | Outlines, XGrammar, LM-Format-Enforcer, TOOLDEC, llguidance | Blocked — no logit access via Ollama OAI endpoint |
| Post-hoc JSON repair (heuristic) | samchon/typia lenient parse, LangChain `OutputFixingParser` | **P0** = targeted instance of this class |
| Re-prompt with error (retry) | Instructor re-ask; LangChain `RetryWithErrorOutputParser`; Su et al. 2025 | Partially present in tool-loop; Su 2025 says plain retry plateaus |
| Fine-tuning on tool-use data | Manduzio 2024 (DPO); ToolLLaMA; BFCL | Out of scope today |
| Prompt engineering (wire-shape examples) | He 2024; Manduzio 2024; Sigdel & Baral 2026 | **P1** — best evidence-to-cost ratio |
| Schema simplification / flattening | NESTFUL; samchon; docat0209 | **P2** — most consistently cited high-leverage change |

## 4. What the field recommends for small models specifically

- **Flatten aggressively.** Single-key wrappers are exactly what the
  literature says to drop unless load-bearing (NESTFUL; samchon;
  docat0209).
- **Show wire-shape, not just schema.** A literal example in the tool
  description outperforms a formally perfect JSON Schema for sub-13B
  models (He 2024; Manduzio 2024).
- **Pair schema + validation diagnostic + semantic hint.** Strict schemas
  alone reduce misuse but don't lift success (Sigdel & Baral 2026).
- **If you own the logit stream, decode under a grammar.** Outlines /
  XGrammar / TOOLDEC remove the problem by construction.
- **Structured reflection, not generic retry.** Su et al. 2025 — plain
  error-in-loop plateaus; make the repair step explicit.
- **Budget matters.** Sigdel & Baral 2026 and BFCL explicitly score
  budget-constrained runs; every heal round costs a token hop. Prefer
  pre-emptive fixes over reactive ones when cycles are scarce.

## 5. Applicability to P0 / P1 / P2

### P0 — Auto-wrap in the bridge (post-hoc heuristic repair)
- **Supported by:** samchon/typia (lenient parse is the same class);
  Instructor re-ask; LangChain `OutputFixingParser`.
- **Cautioned by:** Geng et al. 2025 — heuristic repair has uneven
  coverage; false positives possible if an outer single key is
  semantically real.
- **Net:** evidence-supported as a short-circuit fix. Heuristic repair is
  industry-standard. Keep conservative matcher (`shape accepts "command"`
  sub-check) so we don't mis-wrap.

### P1 — Explicit wire-shape examples in tool descriptions
- **Strongly supported by:** Manduzio et al. 2024; He 2024; Sigdel &
  Baral 2026.
- **Cautioned by:** none — at worst it's extra tokens.
- **Net:** highest evidence-to-cost ratio. Do this regardless.

### P2 — Flatten into ~27 narrow tools
- **Strongly supported by:** NESTFUL 2024/25; samchon; docat0209.
- **Cautioned by:** BFCL hints that large tool manifests cost tokens and
  can hurt small models; Sigdel & Baral 2026 on budget sensitivity. There
  is a sweet spot between 3 macros and 30 flat tools.
- **Net:** strongest architectural answer. Defer only if the
  skill/prompt rewrite cost is real. If P0+P1 don't stabilize Gemma 4,
  P2 is where the literature points.

### A fourth option the literature surfaces
- **Grammar-constrained decoding at the Ollama layer** (llguidance,
  XGrammar, llama.cpp GBNF, LM-Format-Enforcer). Would eliminate the
  shape-error class entirely, but requires moving off the OpenAI-format
  endpoint to a grammar-aware API. Out of scope today; worth filing as
  future direction.

## 6. Citations

1. Willard, B. T., & Louf, R. (2023). *Efficient Guided Generation for
   LLMs.* arXiv:2307.09702. https://arxiv.org/abs/2307.09702
2. Zhang, K., Chen, H., Li, L., & Wang, W. (2023). *Don't Fine-Tune,
   Decode.* arXiv:2310.07075. https://arxiv.org/abs/2310.07075
3. Basu, K., et al. (2024/25). *NESTFUL.* EMNLP 2025 /
   arXiv:2409.03797. https://arxiv.org/abs/2409.03797 ·
   https://aclanthology.org/2025.emnlp-main.1702/
4. Manduzio, G. A., Galatolo, F. A., et al. (2024). *Improving
   Small-Scale LLMs Function Calling.* arXiv:2410.18890.
   https://arxiv.org/abs/2410.18890
5. He, S. (2024). *Achieving Tool Calling Functionality via Prompt
   Engineering.* arXiv:2407.04997. https://arxiv.org/abs/2407.04997
6. Dong, Y., et al. (2024). *XGrammar.* arXiv:2411.15100.
   https://arxiv.org/abs/2411.15100
7. Geng, S., et al. (2025). *JSONSchemaBench.* arXiv:2501.10868.
   https://arxiv.org/abs/2501.10868
8. Su, J., et al. (2025). *Failure Makes the Agent Stronger.*
   arXiv:2509.18847. https://arxiv.org/abs/2509.18847
9. Sigdel, A., & Baral, R. (2026). *Schema First Tool APIs for LLM
   Agents.* arXiv:2603.13404. https://arxiv.org/abs/2603.13404
10. Patil, S. G., et al. (BFCL). OpenReview 2024–2026.
    https://openreview.net/pdf?id=2GmDdhBdDk ·
    https://gorilla.cs.berkeley.edu/leaderboard.html
11. Schick, T., et al. (2023). *Toolformer.* arXiv:2302.04761.
    https://arxiv.org/abs/2302.04761
12. Gat, N. *LM Format Enforcer.*
    https://github.com/noamgat/lm-format-enforcer
13. Instructor (library docs).
    https://python.useinstructor.com/concepts/reask_validation/
14. LangChain — *RetryWithErrorOutputParser.*
    https://python.langchain.com/v0.2/docs/how_to/output_parser_retry/
15. samchon. *Function Calling Harness: 6.75% to 100%.* dev.to, 2025.
    https://dev.to/samchon/qwen-meetup-function-calling-harness-from-675-to-100-3830
16. *3 Patterns That Fix LLM API Calling* (2026). dev.to.
    https://dev.to/docat0209/3-patterns-that-fix-llm-api-calling-stop-getting-hallucinated-parameters-4n3b

## 7. Questions for peer review

1. **Does any paper isolate the "single-key wrapper around a
   discriminated union" failure mode?** Searches surfaced
   recursive-union and nested-chain evidence but nothing that cleanly
   A/B's `{action:{command}}` vs `{command}` for an otherwise identical
   tool. Worth a targeted search on "wrapper key" / "tagged variant" /
   "schema unwrapping."
2. **Quantitative cost of 27 flat tools vs 3 macros for small models.**
   BFCL and Sigdel & Baral 2026 hint at budget sensitivity but neither
   directly benchmarks tool-count scaling on sub-13B. Before committing
   to P2 we should measure or find the token-budget vs accuracy curve.
3. **Is Ollama's OpenAI endpoint incompatible with grammar-constrained
   decoding?** llama.cpp supports GBNF natively; Ollama exposes JSON-mode
   but it's unclear whether it routes tool-call JSON Schemas through a
   grammar. A 15-minute spike on Ollama docs + a test would tell us
   whether the "fourth option" is available today.
