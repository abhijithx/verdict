"""
history_compressor.py — Compress prior session turns into a token-efficient summary.

When a user edits code and resubmits within the same session, we need to
provide the AI with context about what was already found — without sending
the entire prior conversation (which would waste tokens and eventually
exceed context limits).

Strategy:
  - Keep the last full turn verbatim (most relevant context)
  - Summarize everything older into 3-6 bullet lines
  - Include: problem restated, issues found, complexity determined, suggestions given
  - Store in sessions.history_summary for both "first" and "second" Gemini requests

This prevents the AI from:
  - Repeating suggestions already given
  - Contradicting earlier findings without acknowledging the change
  - Generating redundant test cases for areas already tested
"""

from typing import Optional


def compress_history(problem_description: str,
                     prior_analysis: Optional[dict] = None,
                     prior_test_summary: Optional[dict] = None) -> str:
    """
    Compress prior session context into a concise summary string.
    
    The summary is formatted as bullet points that the AI can quickly
    parse to understand what has already been determined about this
    submission. This keeps token usage bounded regardless of how many
    times the user resubmits.
    
    Args:
        problem_description: The original problem statement (restated concisely)
        prior_analysis: Dict from the previous AnalysisResult, containing:
            - verdict: str ("optimal", "needs_improvement", "incorrect")
            - time_complexity: str (e.g., "O(n log n)")
            - space_complexity: str (e.g., "O(n)")
            - correctness_summary: str
            - optimization_suggestions: list[str]
            - quality_issues: list[dict]
        prior_test_summary: Dict summarizing previous test execution:
            - total_tests: int
            - passed: int
            - failed: int
            - failing_test_ids: list[str]
    
    Returns:
        str: A compact summary string (3-6 bullet lines) for the AI
    """
    lines = []

    # Line 1: Problem restated (truncated to keep it brief)
    problem_brief = problem_description[:200]
    if len(problem_description) > 200:
        problem_brief += "..."
    lines.append(f"• Problem: {problem_brief}")

    # Lines 2-3: Prior analysis findings (if any)
    if prior_analysis:
        verdict = prior_analysis.get("verdict", "unknown")
        time_c = prior_analysis.get("time_complexity", "unknown")
        space_c = prior_analysis.get("space_complexity", "unknown")
        lines.append(
            f"• Prior verdict: {verdict} | "
            f"Complexity: time={time_c}, space={space_c}"
        )

        # Include correctness summary if available
        corr_summary = prior_analysis.get("correctness_summary", "")
        if corr_summary:
            # Truncate to keep it brief
            corr_brief = corr_summary[:150]
            if len(corr_summary) > 150:
                corr_brief += "..."
            lines.append(f"• Correctness: {corr_brief}")

        # Include key suggestions (first 2 only, to save tokens)
        suggestions = prior_analysis.get("optimization_suggestions", [])
        if suggestions:
            top_suggestions = suggestions[:2]
            lines.append(f"• Prior suggestions: {'; '.join(top_suggestions)}")

    # Lines 4-5: Prior test execution summary (if any)
    if prior_test_summary:
        total = prior_test_summary.get("total_tests", 0)
        passed = prior_test_summary.get("passed", 0)
        failed = prior_test_summary.get("failed", 0)
        lines.append(f"• Prior tests: {passed}/{total} passed, {failed} failed")

        # Note which test IDs failed (for targeted retesting)
        failing_ids = prior_test_summary.get("failing_test_ids", [])
        if failing_ids:
            lines.append(f"• Failed test IDs: {', '.join(failing_ids[:5])}")

    # If we have no prior context, just include the problem statement
    if not prior_analysis and not prior_test_summary:
        lines.append("• This is the first submission for this session")

    return "\n".join(lines)


def build_test_summary(test_cases: list, exec_results: list) -> dict:
    """
    Build a summary dict of test execution results for compression.
    
    Used as input to compress_history() when preparing for a resubmission.
    
    Args:
        test_cases: List of GeneratedTestCase objects
        exec_results: List of ExecutionResult objects
    
    Returns:
        dict: Summary with total_tests, passed, failed, failing_test_ids
    """
    total = len(exec_results)
    passed = sum(1 for r in exec_results if r.passed)
    failed = total - passed

    # Find IDs of failing test cases
    failing_ids = []
    # Build test_id → test_case_id mapping
    tc_map = {tc.test_id: tc.test_case_id or str(tc.test_id) for tc in test_cases}
    for r in exec_results:
        if not r.passed:
            failing_ids.append(tc_map.get(r.test_id, str(r.test_id)))

    return {
        "total_tests": total,
        "passed": passed,
        "failed": failed,
        "failing_test_ids": failing_ids,
    }


def build_analysis_summary(analysis) -> dict:
    """
    Build a summary dict from an AnalysisResult for compression.
    
    Extracts the key fields needed by compress_history().
    
    Args:
        analysis: AnalysisResult ORM object
    
    Returns:
        dict: Summary with verdict, complexity, suggestions, etc.
    """
    return {
        "verdict": analysis.verdict,
        "time_complexity": analysis.time_complexity,
        "space_complexity": analysis.space_complexity,
        "correctness_summary": analysis.correctness_summary,
        "optimization_suggestions": analysis.optimization_suggestions_json or [],
        "quality_issues": analysis.quality_issues_json or [],
    }
