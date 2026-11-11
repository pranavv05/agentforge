-- Record whether a call's cost was measured or estimated.
--
-- The project's headline cost claims are only worth as much as their provenance. Two
-- things now produce a figure in `llm_calls.cost_usd`:
--
--   * `computed` — derived from the list prices in MODEL_PRICING. An estimate.
--   * `reported` — the exact charge the gateway returned with the response. OpenRouter
--     puts a per-request `cost` in its usage object, which is a measurement rather than
--     a model of one.
--   * `none` — a cassette replay, which cost nothing.
--
-- Without this column a report could not honestly distinguish "we measured $0.03" from
-- "we calculated $0.03 from a price list", and those are different claims.

ALTER TABLE llm_calls
  ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'computed'
  CHECK (cost_source IN ('reported', 'computed', 'none'));
