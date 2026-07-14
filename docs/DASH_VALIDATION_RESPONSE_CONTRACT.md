# DASH Validation Response Contract

Use this format for final validation responses after dashboard changes.

## Required Sections

1. `Status`
- One of: `PASS`, `PARTIAL`, `FAIL`

2. `Summary`
- Short plain-language description of what was changed.

3. `Files`
- Flat list of changed workspace files relevant to the task.

4. `Validation`
- Flat list of validation actions that were actually run.
- Include concrete commands or executed browser checks.

5. `Results`
- Flat list of observed outcomes from the validations.
- Call out any requirement that was proven.

6. `Risks`
- Flat list.
- Use `None.` when there are no remaining known risks.

## Output Template

```md
Status
PASS|PARTIAL|FAIL

Summary
- ...

Files
- path/to/file

Validation
- Ran: ...

Results
- ...

Risks
- None.
```
