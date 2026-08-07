"""
scorer.py — Deterministic scoring engine for CodeScore AI.

This module is the heart of "this is a real system, not an AI wrapper":
  - The scoring formula is pure math, not an AI decision
  - Weights come from the user-configured Evaluation Profile
  - Individual signal scores are derived from verified execution data
  - The COMPLEXITY_SCORE_MAP is a transparent, documented config

The scoring process:
  1. derive_signals() computes 6 individual scores (0-100) from:
     - Real test execution results (correctness)
     - COMPLEXITY_SCORE_MAP lookup (performance)
     - AI's is_optimal signal (optimization)
     - AI's quality/readability/documentation ratings
  2. compute_final_score() applies the profile weights to get a single 0-100 score

The COMPLEXITY_SCORE_MAP is deliberately stored here as a named constant
(not inline in a function) to make it easy to find, explain, and adjust.
"""

from typing import Optional

# ============================================================================
# Complexity Score Mapping
# ============================================================================
# Maps time complexity strings (from AI analysis) to a score out of 100.
# Better complexity = higher score. This is a config-level constant,
# not hardcoded in a function, for easy adjustment and defense.
#
# Rationale for scores:
#   O(1)       → 100 : Constant time — best possible
#   O(log n)   →  95 : Logarithmic — nearly optimal (binary search, etc.)
#   O(n)       →  90 : Linear — optimal for most single-pass problems
#   O(n log n) →  80 : Linearithmic — optimal for sorting-based solutions
#   O(n^2)     →  60 : Quadratic — acceptable for small inputs, not scalable
#   O(n^3)     →  40 : Cubic — brute force, usually improvable
#   O(2^n)     →  15 : Exponential — only acceptable for NP-hard problems
#   O(n!)      →   5 : Factorial — almost always wrong approach

COMPLEXITY_SCORE_MAP = {
    "O(1)": 100,
    "O(log n)": 95,
    "O(√n)": 90,
    "O(n)": 90,
    "O(n log n)": 80,
    "O(n√n)": 70,
    "O(n^2)": 60,
    "O(n^2 log n)": 55,
    "O(n^3)": 40,
    "O(2^n)": 15,
    "O(n!)": 5,
}

# Default score when the AI returns a complexity string we don't recognize
# 50 is a neutral "we don't know" score — neither punishes nor rewards
DEFAULT_COMPLEXITY_SCORE = 50

# Score for non-optimal solutions when is_optimal is False
# 60 = "room for improvement" — not terrible, but clearly not optimal
NON_OPTIMAL_SCORE = 60

# Score for optimal solutions
OPTIMAL_SCORE = 100


def normalize_complexity(complexity_str: str) -> str:
    """
    Normalize a complexity string for lookup in COMPLEXITY_SCORE_MAP.
    
    Handles variations in how the AI might report complexity:
      - "O(n log n)" / "O(nlogn)" / "O(n*log(n))" → "O(n log n)"
      - "O(n^2)" / "O(n²)" → "O(n^2)"
      - Case insensitive
    
    Args:
        complexity_str: Raw complexity string from AI analysis
    
    Returns:
        str: Normalized complexity string for COMPLEXITY_SCORE_MAP lookup
    """
    if not complexity_str:
        return ""
    
    # Strip whitespace and convert to lowercase for initial processing
    s = complexity_str.strip()
    
    # Normalize common variations
    # Replace unicode superscripts with caret notation
    s = s.replace("²", "^2").replace("³", "^3")
    
    # Normalize "nlogn" variations to "n log n"
    s = s.replace("nlogn", "n log n")
    s = s.replace("n*log(n)", "n log n")
    s = s.replace("n*logn", "n log n")
    s = s.replace("n log(n)", "n log n")
    
    # Normalize "sqrt" to "√"
    s = s.replace("sqrt(n)", "√n")
    s = s.replace("sqrt n", "√n")
    
    # Ensure proper spacing
    # "O( n )" → "O(n)"
    if s.startswith("O(") and s.endswith(")"):
        inner = s[2:-1].strip()
        s = f"O({inner})"
    
    return s


def _compute_timing_score(exec_results, threshold_ms: float = 2000.0) -> int:
    """Return 0-100 score based on average execution time relative to a threshold."""
    if not exec_results:
        return 100
    times = []
    for r in exec_results:
        t = r.get("time_ms") if isinstance(r, dict) else getattr(r, "time_ms", None)
        if t is not None:
            times.append(t)
    if not times:
        return 100
    avg_ms = sum(times) / len(times)
    if avg_ms <= threshold_ms * 0.25:
        return 100
    if avg_ms <= threshold_ms * 0.5:
        return 85
    if avg_ms <= threshold_ms:
        return 65
    return 40


def derive_signals(exec_results: list, second_response) -> dict:
    """
    Derive the 6 individual scoring signals from execution data and AI analysis.
    
    This function translates raw data into 0-100 scores for each dimension:
      - correctness_score:   tests_passed / tests_total × 100
      - performance_score:   70% COMPLEXITY_SCORE_MAP + 30% measured execution timing
      - optimization_score:  100 if optimal, 60 if not
      - quality_score:       directly from AI (0-100)
      - readability_score:   directly from AI (0-100)
      - documentation_score: directly from AI (0-100)
    
    Args:
        exec_results: List of ExecutionResult objects (or dicts with 'passed' key)
        second_response: Parsed Gemini "second" response (GeminiSecondResponse or dict)
    
    Returns:
        dict: Six keys, each mapping to an int 0-100
    """
    # --- Correctness Score ---
    # Straightforward: what fraction of test cases passed?
    # This is derived purely from real execution data
    if exec_results:
        tests_passed = sum(1 for r in exec_results if _get_passed(r))
        tests_total = len(exec_results)
        correctness_score = round((tests_passed / tests_total) * 100) if tests_total else 0
    else:
        correctness_score = 0

    # --- Performance Score ---
    # Blend Big-O theoretical complexity map (70%) with measured execution timing (30%)
    time_complexity = _get_attr(second_response, "complexity", {})
    if isinstance(time_complexity, dict):
        time_str = time_complexity.get("time", "")
    else:
        time_str = getattr(time_complexity, "time", "")
    
    normalized = normalize_complexity(time_str)
    complexity_score = COMPLEXITY_SCORE_MAP.get(normalized, DEFAULT_COMPLEXITY_SCORE)
    timing_score = _compute_timing_score(exec_results)
    performance_score = round(0.70 * complexity_score + 0.30 * timing_score)

    # --- Optimization Score ---
    # Binary signal: is this the optimal known approach?
    # 100 if optimal, NON_OPTIMAL_SCORE if not
    # Note: This is a simplified v1 approach — a graded scale based on
    # gap-to-optimal is noted as a future refinement
    if isinstance(time_complexity, dict):
        is_optimal = time_complexity.get("is_optimal", False)
    else:
        is_optimal = getattr(time_complexity, "is_optimal", False)
    
    optimization_score = OPTIMAL_SCORE if is_optimal else NON_OPTIMAL_SCORE

    # --- Quality, Readability, Documentation Scores ---
    # These come directly from the AI's analysis (each 0-100)
    # The AI is instructed to provide honest assessments, not inflated scores
    quality_score = _get_attr(second_response, "quality_score", 50)
    readability_score = _get_attr(second_response, "readability_score", 50)
    documentation_score = _get_attr(second_response, "documentation_score", 50)

    # Clamp all scores to 0-100 range (defensive programming)
    return {
        "correctness_score": _clamp(correctness_score),
        "performance_score": _clamp(performance_score),
        "optimization_score": _clamp(optimization_score),
        "quality_score": _clamp(quality_score),
        "readability_score": _clamp(readability_score),
        "documentation_score": _clamp(documentation_score),
    }


def compute_final_score(profile, signals: dict) -> int:
    """
    Compute the weighted final score using the evaluation profile.
    
    This is the core scoring formula — pure deterministic math:
      final = Σ (signal_score × profile_weight) for each of the 6 dimensions
    
    The result is rounded to the nearest integer (0-100).
    
    Args:
        profile: EvaluationProfile object (or dict with weight keys)
        signals: dict from derive_signals() with 6 score keys (each 0-100)
    
    Returns:
        int: Final weighted score (0-100)
    
    Example:
        Profile: College Default (50% correctness, 20% perf, 15% opt, 10% quality, 0% read, 5% doc)
        Signals: {correctness: 80, performance: 90, optimization: 100, quality: 70, readability: 60, documentation: 50}
        Final = 80*0.50 + 90*0.20 + 100*0.15 + 70*0.10 + 60*0.00 + 50*0.05
             = 40 + 18 + 15 + 7 + 0 + 2.5 = 82.5 → 83
    """
    # Get weights from the profile (support both ORM objects and dicts)
    cw = _get_attr(profile, "correctness_weight", 0.40)
    pw = _get_attr(profile, "performance_weight", 0.20)
    ow = _get_attr(profile, "optimization_weight", 0.15)
    qw = _get_attr(profile, "quality_weight", 0.15)
    rw = _get_attr(profile, "readability_weight", 0.05)
    dw = _get_attr(profile, "documentation_weight", 0.05)

    # Compute weighted sum
    final = (
        signals.get("correctness_score", 0)   * cw +
        signals.get("performance_score", 0)    * pw +
        signals.get("optimization_score", 0)   * ow +
        signals.get("quality_score", 0)        * qw +
        signals.get("readability_score", 0)    * rw +
        signals.get("documentation_score", 0)  * dw
    )

    # Round and clamp to 0-100
    return _clamp(round(final))


# ============================================================================
# Helper Functions
# ============================================================================

def _clamp(value: int, min_val: int = 0, max_val: int = 100) -> int:
    """Clamp an integer to the [min_val, max_val] range."""
    return max(min_val, min(max_val, value))


def _get_attr(obj, attr: str, default=None):
    """
    Get an attribute from an object, supporting both dict and object access.
    This lets the scorer work with both ORM models and plain dicts.
    """
    if isinstance(obj, dict):
        return obj.get(attr, default)
    return getattr(obj, attr, default)


def _get_passed(result) -> bool:
    """Get the 'passed' field from an execution result (dict or object)."""
    if isinstance(result, dict):
        return result.get("passed", False)
    return getattr(result, "passed", False)
