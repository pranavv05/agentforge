# Grounding and compliance

## The grounding verifier

When an agent describes existing code, the statement is stored as a structured claim
rather than prose:

```json
{
  "file": "src/tax/tds.ts",
  "line_start": 10,
  "line_end": 17,
  "symbol": "computeTds",
  "claim": "TDS is computed here before the payment is written"
}
```

The verifier is plain deterministic code. It cannot be argued out of a verdict, which is
the entire point: a model that is confidently wrong about a file cannot talk its way past
a function that opens the file.

| Result | Meaning |
|---|---|
| `verified` | The file exists inside the repository, the range is valid, and the symbol appears in those lines |
| `file_not_found` | No such file in the repository |
| `not_a_file` | The path exists but is a directory or another non-file |
| `path_escapes_repo` | The path resolved outside the repository root, including via a symlink |
| `line_range_invalid` | The range is inverted or otherwise not a range |
| `line_range_past_eof` | The range extends beyond the end of the file |
| `symbol_not_in_range` | The file and range are fine, but the symbol is not in those lines |
| `file_unreadable` | The file could not be read, for example a binary |

### The unverified-claim rate

The share of claims that failed. It is reported for every brownfield run, shown above
`context.md` with each failed claim and its reason, and recorded in the database — so it
can be quoted as a measurable hallucination metric rather than an impression.

On a live scan of this repository it was **11.1%**, across 15 of an allowed 25 tool calls,
for $0.0133.

A claim that fails is flagged before it reaches a document. It is not silently dropped:
a reviewer needs to see that the agent believed something false.

### Adversarial cases

The verifier's test suite drives invented files, off-by-one ranges, ranges past EOF,
symbols present only in a comment, symlinks escaping the repository root, CRLF files and
binaries. Repository content is treated as data and never as instructions — a `CLAUDE.md`
inside a scanned repository has no authority over the agent reading it.

## The compliance pack

A versioned pack of 15 rules covering GST e-invoice obligations and TDS under the
Income-tax Act 2025. Each rule carries an EARS requirement, at least one testable
Given/When/Then criterion, a citation, and the terms it supersedes.

The injector adds those criteria to generated requirements, and the trace matrix links
each one **rule → requirement → design section → task → test**, so a reviewer can ask
"where is this obligation satisfied?" and get a path rather than an assurance.

### Superseded-term detection

The Income-tax Act 2025 took effect on 1 April 2026. Sections 194C, 194I and 194J no
longer exist as separate sections; each is a row within Section 393. A document citing
`194J` is caught and mapped to the Section 393 row, which is asserted by a test so the
behaviour cannot quietly regress.

### Recorded disagreements

Where sources disagree — most notably on a threshold given as ₹50,000 by most sources and
₹30,000 by one, with differing payment codes — the pack records the conflict against the
rule instead of resolving it silently. Tests assert those notes stay put, so they cannot
be tidied away, and the site shows them.

### What this pack is not

**It has not been reviewed by a tax professional.** Rates and payment codes are encoded
only where the source research states them; everything else is a structural obligation
rather than an invented number.

Confirm every rate, threshold and code against the CBDT portal and the current NIC
e-invoice schema before any real use. The versioning exists precisely because these
change.
