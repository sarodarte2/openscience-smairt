# Runner, notebooks, and provenance

## One controlled runner

GUI, CLI, agent tool, and future workers invoke one application service:

```text
canonical request
→ bind project/track/iteration/foundation
→ evaluate policy
→ record intent
→ obtain approval when required
→ hash code/config/inputs/environment
→ spawn with argv and filtered environment
→ stream structured progress and stdout/stderr
→ record success/failure/timeout/cancel/loss
→ hash outputs and link artifacts
```

The runner records exact argv/cwd, actor/delegation, Git commit and dirty snapshot, protocol revision, environment snapshot, input/output hashes, timestamps/duration, exit/signal, seeds when declared, resource metadata, runner version, and capture confidence.

Retries always create new run IDs. The runner journals intent before side effects. TeeLogger may remain a convenience but is never authoritative.

## Risk gates

Protocol freeze, destructive actions, network/external mutation, material spend, amendments, interpretation, evidence integration, foundation promotion and public export require human approval. Ordinary runs inside an approved envelope are one-click.

## Notebooks

- Persistent kernels remain exploratory scratch work.
- Scratch cells never count as formal evidence.
- Formal execution starts a clean kernel inside the selected Conda environment.
- A pinned Jupyter/nbclient adapter executes the saved `.ipynb` and preserves original plus executed copy, cell outputs, environment snapshot and artifacts.
- Hidden interactive state cannot be promoted silently.

## Requirements

- `RUN-001`: commands use argv spawning, never interpolated shell text.
- `RUN-002`: stdout, stderr, nonzero exit, signal, timeout, cancellation and unknown status are distinct.
- `RUN-003`: two retries never overwrite evidence.
- `RUN-004`: observed outputs are hashed after completion; partial outputs remain attached to failed attempts.
- `NOTEBOOK-001`: formal notebooks reproduce from saved inputs in a clean kernel or fail with explicit missing state.
- `PROV-001`: capture completeness never implies scientific validity.
