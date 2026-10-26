# Optional real-path answer-stage evidence (#62)

This diagnostic observes the existing pipeline; it does not format, review, clip or send a second answer. It changes no prompt, routing, source selection, filter policy, model request or judgment rule. It cannot reconstruct stages absent from historical saved results or improve accuracy merely by existing.

## Activation and privacy boundary

`answerStageEvidence.createStageEvidence().run(operation)` explicitly collects only that asynchronous operation. Production handlers do not create collectors. There is no environment flag, process event, console logger, database table or background job. With no collector, each hook returns its input unchanged before measuring or hashing it.

The future separately authorized `scripts/live-eval.js --stage-evidence` path creates one collector per case turn around the **actual** `handleMessage`. A baseline lacking the module is marked `unavailable`, not silently traced. Without the option the existing result shape and operation remain unchanged. Do not launch a paid evaluation just to use this option.

Each record contains a fixed stage label, UTF-16 code-unit count (`chars`), UTF-8 byte count, line count and HMAC-SHA256 fingerprint. The harness adds only its existing synthetic turn ordinal. No stage text, question, source URL, message/customer/channel ID, timestamp, error body or key is stored by the collector. A fresh random key is private to each collector and zeroed when the operation settles; equal text can be compared **within that turn**, not joined across turns/runs. Metadata is not a claim of anonymization and stays in private authorized evaluation artifacts, not public issue comments.

At most64 records and131072 UTF-16 units per measured value are allowed. Overflow sets `truncated`; missing records are not interpreted as unchanged text. Returned snapshots are detached copies. Late work inheriting the asynchronous context cannot append after the operation closes. Underlying operation values/errors propagate unchanged. No raw error is added to the trace.

## Actual boundaries

| Label | Observed boundary, not an alternative implementation |
| --- | --- |
| `generated` | Parsed `queryAgent` result received by the handler; not raw provider JSON or proof the model actually ran |
| `draft_input` → `draft_safety` | Existing `prepareDraftForReviewWithAudit` filters |
| `review_parsed` → `review_safety` | Actual review JSON answer before/after `technicalReviewSafety`; source-line/staff-lie cleanup follows |
| `review_returned` | Actual first/second `reviewWithSecondLook` result, in invocation order |
| `review_selected` | Handler's approved/safe-handoff/rejection selection; later application policy may still replace it |
| `presentation_input` → `presentation_filtered` → `presentation_output` | Existing narration/public privacy, Discord formatting and fitting, without a new formatter |
| `clip_input` → `clip_output` | Existing `fitPublicReply`, including calls that do not shorten anything; repeated pairs preserve order |
| `handoff_input` → `handoff_output` | Existing `escalateReply` composition/privacy and application-owned delivery footer |
| `send_input` → `send_payload` | Final `replySafe` privacy/fitting/mention projection; `send_payload` is **attempted content, not a delivery receipt** |

A deterministic/canned/suppressed/error path legitimately omits some model stages. A captured empty trace is not proof of valid model generation or a passing quality result; execution-validity diagnostics remain #56/E2. Fingerprint/length changes locate a boundary, not whether the text was correct or why a remote provider failed. Existing timing/token metadata remains separate.

## Verification and release scope

Observed behavioral red before wiring: the real draft/presentation integration has no required stage records. After wiring, synthetic checks exercise actual draft/presentation/clipping functions, actual technical reviewer with an injected provider response, the actual handler and handoff, the harness adapter, parallel collections, bounded overflow, late work, exceptions, absent-module compatibility and enabled/disabled reply-byte parity. No provider or Discord request is used.

Merged as #88 / `884fb46` after full1174/no-model8/current-head CI and independent35-check scoped review. #67/#80 own the completed clause-preservation behavior; this change does not reimplement it or import the closed #77 filter diff. Check merged-main evidence before closing #62's scoped repair/evidence work. No separate deployment, paid rerun, customer-data use or operational metadata policy is authorized here.
