/**
 * Every tunable parameter for the matching engine lives here.
 *
 * Rationale for each number is in comments — if a judge asks "why 0.5?" I want
 * to point at the reason, not shrug. All of these are live-editable during the
 * demo without touching the algorithm.
 */

module.exports = {
  // --- BM25 ---
  bm25: {
    k1: 1.5, // standard tuning; controls term-frequency saturation
    b: 0.75, // standard tuning; controls length normalisation
  },

  // --- Fusion ---
  // alpha = weight on the LEXICAL side. (1 - alpha) is the semantic weight.
  // 0.5 is the hybrid default. Ablation runs at 1.0 (lexical-only) and 0.0
  // (semantic-only) to prove both signals genuinely matter.
  alpha: 0.5,

  // --- Must-have gate ---
  // A MUST requirement scoring below this after fusion counts as "missing".
  // 0.35 is deliberately low — we only want to gate on real absences, not
  // near-misses. Every miss compounds the gate penalty.
  gateThreshold: 0.35,
  // Multiplicative penalty per missing MUST. 0.75 means 1 miss = 25% off,
  // 2 misses = ~44% off, 3 misses = ~58% off. Enough to reshuffle the top
  // of the pool but not to zero anyone out.
  gatePenaltyPerMiss: 0.75,

  // --- Explanation surface ---
  // A requirement is "satisfied" if its fused score clears this. Used by
  // explain.js and by matchedBy.
  satisfyThreshold: 0.5,
  // Both signals count as "both" if both z-normed scores exceed this.
  // Above zero because a positive z-score means above-pool-average.
  matchBothThreshold: 0.0,

  // --- Score calibration ---
  // Min-max scaling target for finalScore.
  scoreMin: 0,
  scoreMax: 100,
};
