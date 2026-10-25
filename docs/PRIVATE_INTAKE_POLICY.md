# Keep identifying support details private

## Failure and scope

Main d550dc1 has per-path protections (`/order` verification, private facts excluded from public model inputs, public redaction and private email requests on several staff-card lanes), but no shared explicit public-reply rule for account email/order details. Ordinary order-card guidance asks for an order number/delivery date while telling staff to reply in the customer's thread; damaged-item intake protects the email but not all order details. Missing model instructions do not authorize public collection.

One shared `PUBLIC_REPLY_PRIVACY_POLICY` reaches answer, planner and review requests, including planned handoffs, answer retry and compact review retry. It prohibits requesting/echoing identifying values publicly, permits useful non-sensitive diagnostics, and requires an available private verification or approved private staff-support path rather than inventing one. Staff order/damage-card wording keeps order details private and avoids re-requesting supplied details. Private commands, authorization, persistence, source selection, safety/handoff decisions, delivery fences and optional switches are unchanged. No data import, prompt self-certification or #82 excerpt contract.

## Verification and limits

- Five original synthetic tests in `test/privateIntakePolicy.test.js`: **0/5 before**, then **5/5 after**. They inspect production request constructors through injected transports and the actual card formatter; no provider calls/customer data.
- All eight representative answer lanes, planned-handoff answer retry, review without a planned handoff/both efforts/compact retry, localized planner handoff and private staff order/damage intake are covered. Review retains exact source links.
- Full979/979 and offline customer evaluation8/8 pass; existing private-order verification and unavailable-command guards remain in that suite.
- Independent scoped review passes117 affected offline checks and independently reproduces all five intended failures against main's runtime loaded in memory with network denied. Current5/5 pass. Exact-head hosted checks remain required. This draft is not a deployment or privacy-feature enablement.
- Published #84/runtime4ca5e53 passes hosted Node20/24 and real Postgres CI40173415114. Later status-only publication changes no runtime/test code; it still requires its own current-head checks. #71's separate failed attempt does not supply this draft's generated-answer evidence or permission for another provider call.

Instructions are not deterministic leak prevention. Injected replies test integration, not whether a real model always obeys; existing redaction does not identify every private value. Keep draft until review and appropriate generated-answer verification are complete. A paid run requires separate Aryan permission and is not part of #71's final comparison. Any eventual deployment needs normal approval/rollback/smoke gates, with Aryan sending every Discord input. No current release/input is requested.
