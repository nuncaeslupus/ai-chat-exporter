# Specification tail (sections 5–6)

> `design` appends these sections to the `status/specification.md` that
> `specify` created (sections 1–4). Keep the same heading levels so the
> file reads as one document. Contracts and risks live in the spec —
> not the plan — because `review` and `ship` audit the diff against them.

## 5. Contracts

### API contracts

#### `METHOD /v1/path`

- **Auth**: required / internal only
- **Request**:
  ```json
  {}
  ```
- **Response (200)**:
  ```json
  {}
  ```
- **Errors**: 400, 401, 404, 500
- **Backwards compatible**: yes / no

### Inter-service contracts

| Caller | Callee | Protocol | Contract | Failure handling |
|--------|--------|----------|----------|-----------------|
| | | HTTP / message-queue | | retry / dead-letter |

### Database migrations

| Service | Database | Change | Reversible | Forward-compatible |
|---------|----------|--------|------------|-------------------|
| | | | yes/no | yes/no |

## 6. Risks & Validation

| Risk | Likelihood | Impact | Mitigation | Validation |
|------|-----------|--------|------------|------------|
| | Low/Med/High | Low/Med/High | | <unit/integration/manual/perf/security> |
