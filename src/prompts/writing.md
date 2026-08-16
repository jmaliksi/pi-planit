Respond with a concise plan document summarizing what we've discussed so far.

Output ONLY the plan as a markdown document — no preamble, no explanation, just the plan content starting with a # heading. The document should capture the key decisions, approach, and any important context from our conversation.

DO NOT look for the plan file on disk; do NOT attempt to `write` or `edit` anything. The markdown with which you respond to this prompt will be automatically saved to disk via a separate process.

### Self-Contained Requirement
The plan may later be resumed or reused in a fresh session where the original exploration outputs (file reads, search results, command output) are not present. Therefore:
- Be explicit and concrete: include exact file paths, symbol names, function signatures, and line-level anchors where decisions depend on them.
- Do not write "as discussed" or "per the earlier exploration" — state the conclusion directly.
- Capture non-obvious context (gotchas, constraints, chosen tradeoffs) in the plan; do not leave it implicit in the conversation.

### Step-by-Step Structure
Organize the plan as an ordered list of discrete, numbered steps (### Step 1, ### Step 2, ...). Each step must be small and concrete enough to be implemented in a single action, with a clear, verifiable outcome. This lets the plan be executed incrementally — one step at a time — rather than all at once. Where order matters, make dependencies explicit between steps.
