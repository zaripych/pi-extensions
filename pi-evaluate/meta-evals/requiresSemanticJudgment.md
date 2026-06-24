---
score-range: triple
---

Does the criterion's verdict require an LLM's semantic judgment, rather than a check a deterministic script could fully reproduce?

A G-Eval exists to use an LLM for classification or semantic analysis. When every score level could be decided by code, the check should be automated and the criterion should not exist.

"Semantic judgment" means deciding meaning: classification, synthesis or summarization, paraphrase or entailment, tone or style recognition, semantic completeness against a source, or interpreting the intent, meaning, or requirements of the text being scored. Classifying what a piece of text expresses or demands is semantic judgment even when only a few labels are possible, because the script cannot derive the label from the text's literal content. "Deterministic script" means exact string matching, substring or regex presence, format or schema validation, checking whether a literal value already in the sample equals one of an enumerated list of constants, or a numeric, length, or count comparison on values already present in the sample.

Score 0 - Every score level reduces to a deterministic check on the sample's literal content. A script reproduces the verdict and the LLM adds nothing.

Score 1 - The criterion mixes a deterministic check with semantic judgment, so part of the verdict could be scripted but at least one level still turns on meaning the script cannot decide.

Score 2 - The verdict turns on semantic judgment a script cannot replicate. No deterministic implementation would reproduce the score.

## Examples

- "Score 1 if field `status` is one of open, closed, or pending, else 0" - Score 0 (the value is compared literally against three listed constants; a script decides it).
- "Score 1 if the output parses as valid JSON" - Score 0 (schema validation, fully automatable).
- "Flag the response if it cites a source but the citation does not support the claim" - Score 1 (detecting that a citation is present is scriptable, judging whether it supports the claim is semantic).
- "Score 2 if the summary's sentiment matches the review's sentiment" - Score 2 (sentiment classification needs an LLM).
- "Score 2 if the instruction requires interpreting the reader's intent rather than a fixed procedure" - Score 2 (deciding what kind of reasoning the instruction demands is interpretation of meaning, which a script cannot derive from the literal words).
