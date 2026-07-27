# Payload: lo-b59b — DOM-drift regression tests

**Gate**: each parser has tests proving it degrades gracefully when the target site's DOM shifts.

For a scraper, the likeliest real-world failure is the target site renaming a class or moving an attribute. Current edge-case tests (`tests/unit/core/parsers/chatgpt.test.ts:282-314`) cover empty and malformed HTML but not *plausible near-miss* HTML.

## Tests

Per parser, from a mutated copy of the real fixture:
- `it('reports failure when the message-role attribute is renamed')`
- `it('does not mis-pair turns when a wrapper div is removed')`
- `it('returns success:false rather than an empty conversation when selectors match nothing')`

The distinction that matters: silently exporting an empty or half-parsed conversation is worse than failing loudly. Assert on the failure signal, not just on absence of a crash.
