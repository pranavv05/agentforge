# Grounding and compliance

## Grounding verifier

When a design describes existing code, each statement is stored as a structured claim:

```json
{ "file": "src/tax/tds.ts", "line_start": 10, "line_end": 17, "symbol": "computeTds" }
```

The verifier is plain code, not a model. It returns one of four results:

| Result | Meaning |
|---|---|
| `verified` | The file exists, the range is valid and the symbol appears inside it |
| `file_not_found` | No such file in the repository |
| `range_invalid` | The range is outside the file or inverted |
| `symbol_not_in_range` | The file and range exist but the symbol is not in those lines |

The **unverified-claim rate** is the share of claims that failed. It is shown on the dashboard and at the top of every Design tab, so you can see it before you approve.

### Try it

Open **Grounding lab** in the dashboard. Run retrieval on a feature description, or check a single claim by hand. Try a made-up path to see `file_not_found`.

## Compliance pack

The pack contains seven rules in two families.

| Family | Rules |
|---|---|
| GST | `GST-01` e-invoice mandatory fields, `GST-02` applicability threshold, `GST-03` IRN persistence and immutability |
| TDS | `TDS-01` Section 393 mapping, `TDS-02` technical and professional fee rates, `TDS-03` contractor rates, `TDS-04` versioned rate table |

A rule fires when your description contains one of its trigger words, such as `gst`, `invoice`, `tds` or `vendor`. Each fired rule becomes an EARS requirement with a testable acceptance criterion, and the task list traces it to a test.

### Legacy section lint

Section 393 of the Income-tax Act 2025 replaces the old 194-series sections. The lint rejects any design text that references `194`, `194J` and similar. Use **Compliance pack** in the dashboard to test a sentence.

> **Verify before production use.** Rates and thresholds in the pack are illustrative. Confirm them against the official CBDT and Income Tax portal before encoding them in a real system.
