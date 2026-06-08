---
score-range: triple
---

Score the criteria based on LLM capabilities it would require to evaluate.

Score 0 - Asking LLM to perform tasks similar to: exact string operations (icontains, manipulating characters, spelling, etc), arithmetic on large integers or any floating-point numbers, sorting, nested if-then conditionals, counting large number of quantities (e.g., "exactly 11 items")

Score 1 - Asking LLM to perform tasks similar to: temporal reasoning or exact text extraction, asking LLM to perform arithmetics on small whole numbers (<5), counting small quantities (<5), comparison of small quantities (<5)

Score 2 - Only relies on strong LLM capabilities like: synthesis and summarization, semantic understanding, adapting/recognizing tone and style, classification, or semantic completeness checking (e.g., "output should reflect the key points found in source" — this is classification and semantic comparison, NOT counting)

## Examples

- "Count exactly N items" or "verify the list has 16 entries" - Score 0
- ">2 mistakes made" - Score 1 (arithmetics on small whole numbers).
- "Check whether output faithfully covers the topics from source" - Score 2 (semantic comparison/classification).
