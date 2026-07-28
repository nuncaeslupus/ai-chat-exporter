# Payload: lo-5af6 — Unused message contracts and `any` in the pipeline

**Gate**: message payloads are typed at both ends; `convertMessage` takes a real type.

- `src/shared/messages.ts:18` declares typed contracts for the chrome messages — and neither sender nor receiver imports them. Both ends hand-roll object literals across a boundary the compiler cannot check, which is exactly where the dead `show_export_dialog` message (`lo-aee0`) came from.
- `src/core/services/conversation-structure-service.ts:46` — `convertMessage(message: any)` hides that `StructuredMessage.timestamp` (required `Date`) can receive `undefined` from the optional `Message.timestamp`. `exactOptionalPropertyTypes` is on and this bypasses it.

Fix: import and use the declared contracts at both ends, and give `convertMessage` its real parameter type. Doing this makes the whole class of message-mismatch bugs a compile error rather than a runtime silence.
