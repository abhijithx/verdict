"""
prompt_builder.py — Reusable prompt templates for Verdict AI Platform.

Never hardcode prompts inside router files. This builder constructs structured
prompts for both Recommendation and Evaluation modules.
"""

import json
from typing import Optional, List, Dict, Any


class PromptBuilder:
    """Prompt Builder for constructing structured Gemini prompts."""

    RECOMMENDATION_SYSTEM_INSTRUCTION = (
        "You are an expert competitive programming coach and algorithm designer. "
        "When given a problem, you MUST: "
        "(1) identify the exact algorithm category and specific named algorithm, "
        "(2) choose the programming language that will produce the fastest execution time for this specific problem type, "
        "(3) provide complete, working, production-ready code — NEVER a stub or placeholder, "
        "(4) explain the core logic step-by-step so a student understands WHY this algorithm works, "
        "(5) analyze time and space complexity with justification. "
        "You MUST respond ONLY with a single valid JSON object. "
        "Do NOT include markdown fences or any text outside the JSON."
    )

    EVALUATION_SYSTEM_INSTRUCTION = (
        "You are an expert code reviewer embedded in an advanced web IDE. "
        "You review code in Python, C++, or Java against a user-supplied problem statement. "
        "You must always respond with a single valid JSON object and nothing else — "
        "no markdown fences, no commentary outside the JSON."
    )

    @staticmethod
    def build_recommendation_prompt(
        problem: str,
        constraints: Optional[str] = None,
        sample_input: Optional[str] = None,
        sample_output: Optional[str] = None,
        preferred_language: Optional[str] = None
    ) -> str:
        """
        Build JSON request prompt for Solution Recommendation.
        """
        if preferred_language and preferred_language.strip():
            lang_instruction = (
                f"The user requested {preferred_language}. Write the solution in {preferred_language}. "
                f"Set recommended_language to '{preferred_language}'."
            )
        else:
            lang_instruction = (
                "No preferred language was specified. You MUST choose the single best language "
                "for this specific problem based on execution speed and suitability: "
                "- Use C++ for problems requiring raw speed, heavy computation, or low-level memory control. "
                "- Use Python for string manipulation, prototyping, or problems where built-in libraries give an edge. "
                "- Use Java for enterprise patterns, concurrent processing, or when strong typing helps correctness. "
                "Set recommended_language to your chosen language and explain WHY it gives the fastest execution time "
                "for this problem in the explanation field."
            )

        payload = {
            "request_type": "recommendation",
            "problem_statement": problem,
            "constraints": constraints or "None provided",
            "sample_input": sample_input or "None provided",
            "sample_output": sample_output or "None provided",
            "preferred_language": preferred_language or "Auto-select best",
            "instructions": (
                "Analyze this problem deeply and return a structured recommendation.\n"
                f"{lang_instruction}\n\n"
                "CRITICAL REQUIREMENTS:\n"
                "1. The 'optimized_code' field MUST contain a COMPLETE, WORKING solution that reads from stdin "
                "and writes to stdout. NEVER return a stub, placeholder, or 'pass' statement.\n"
                "2. The 'explanation' field MUST contain a DETAILED walkthrough of the core algorithm logic:\n"
                "   - What is the key insight that makes this approach work?\n"
                "   - Step-by-step trace through the algorithm with a small example\n"
                "   - Why this is the optimal approach (prove it by comparing to brute force)\n"
                "   - If language was auto-selected: why this language gives the fastest execution\n"
                "3. The 'recommended_algorithm' MUST be a specific named algorithm (e.g., 'Two Pointers', "
                "'Kadane\\'s Algorithm', 'Dijkstra\\'s Shortest Path'), NOT a vague description.\n"
                "4. The 'recommended_data_structure' MUST name a specific structure (e.g., 'Hash Map', "
                "'Min-Heap / Priority Queue', 'Disjoint Set / Union-Find').\n\n"
                "Output JSON MUST contain exactly these fields:\n"
                "- category: (string) Algorithm family, e.g. 'Dynamic Programming', 'Graph Theory', 'Greedy', 'Sorting & Searching'\n"
                "- recommended_algorithm: (string) Specific named algorithm\n"
                "- recommended_data_structure: (string) Primary data structure used\n"
                "- recommended_language: (string) The programming language\n"
                "- time_complexity: (string) Big-O notation with variable explanation, e.g. 'O(N log N) where N = array length'\n"
                "- space_complexity: (string) Big-O notation, e.g. 'O(N)'\n"
                "- optimized_code: (string) COMPLETE working code — reads stdin, writes stdout, handles edge cases\n"
                "- explanation: (string) DETAILED algorithm walkthrough — the core logic, key insight, step-by-step reasoning\n"
                "- alternative_approaches: (array) [{name, time_complexity, space_complexity, trade_offs}]"
            )
        }
        return json.dumps(payload, indent=2)

    @staticmethod
    def build_evaluation_test_prompt(
        code: str,
        language: str,
        problem_statement: str,
        history_summary: Optional[str] = None
    ) -> str:
        """
        Build JSON request prompt for Evaluation (Stage 1: Test case generation).
        """
        payload = {
            "type": "first",
            "language": language,
            "code": code,
            "problem_statement": problem_statement,
            "history_summary": history_summary or "",
            "instructions": (
                "Generate between 4 and 8 test cases for this code and problem. "
                "You MUST include: (1) at least one standard/happy-path case, "
                "(2) at least one edge case (empty input, single element, zero, or boundary value "
                "per the stated constraints), (3) at least one case that would stress the claimed "
                "time complexity (larger input near constraint limits). "
                "Mark edge_case=true for any case in category (2) or (3). "
                "Each test case must have realistic stdin/stdout matching the exact I/O format "
                "described in the problem statement."
            )
        }
        return json.dumps(payload, indent=2)

    @staticmethod
    def build_evaluation_analysis_prompt(
        code: str,
        language: str,
        problem_statement: str,
        test_results_summary: List[Dict[str, Any]],
        history_summary: Optional[str] = None
    ) -> str:
        """
        Build JSON request prompt for Evaluation (Stage 2: Code analysis with real execution results).
        """
        payload = {
            "type": "second",
            "language": language,
            "code": code,
            "problem_statement": problem_statement,
            "history_summary": history_summary or "",
            "execution_results": test_results_summary,
        }
        return json.dumps(payload, indent=2)
