# R-6: HTML — new scale, small-caps role label, turn fill moves to the question

Spec Phase 2 / HTML. Depends on R-1. Changes least, deliberately.

- Adopt the R-1 scale; role label at 10.5 pt in small caps instead of a heading.
- Time in light grey; brand-coloured rule under the label.
- Tables get horizontal rules only, same neutral grey.
- **The assistant message loses its grey fill and the question gains it.** The
  background now marks who is *asking*; today HTML does the reverse.
- Keep the existing dark-mode block in step with the new tokens.

## Acceptance gate

```bash
pnpm test:run tests/unit/core/exporters/html-exporter.test.ts tests/unit/accessibility/contrast.test.ts
```

## Tests
`tests/unit/core/exporters/html-exporter.test.ts` — assert the question carries
the surface fill and the answer does not, and that the role label is not an
`h2`. The contrast test must pass in both palettes.

## Location
`src/core/exporters/html-exporter.ts`
