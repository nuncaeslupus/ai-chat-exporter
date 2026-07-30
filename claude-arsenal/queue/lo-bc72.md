# R-9: contrast gate — new ink, five code tokens, greyscale separation

The mechanical acceptance gate for the redesign as a whole. Depends on R-1 and R-8.

`tests/unit/accessibility/contrast.test.ts` already reads real colour
declarations out of `style-tokens.ts` and `html-exporter.ts`, resolves CSS
custom properties, and asserts WCAG AA in both light and dark palettes. Extend
it to cover:

1. The new ink palette, light and dark.
2. The five code tokens against the code-block background (AA, 4.5:1).
3. **Greyscale separation between the five tokens.** The design claims they stay
   distinguishable printed in black and white — assert a minimum relative
   luminance gap between each pair rather than trusting the claim.

## Acceptance gate

```bash
pnpm test:run tests/unit/accessibility/contrast.test.ts
```

## Tests
`tests/unit/accessibility/contrast.test.ts` (exists — extend).

## Location
`tests/unit/accessibility/contrast.test.ts`
