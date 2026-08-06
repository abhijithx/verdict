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
        "You are an expert AI Full-Stack Software Architect and Competitive Programming Coach. "
        "Your task is to analyze programming problems and provide structured, optimal approach recommendations. "
        "You MUST respond ONLY with a single valid JSON object strictly matching the required schema. "
        "Do NOT include markdown fences (```json ... ```) or any introductory/concluding prose outside the JSON."
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
        preferred_language: str = "Python"
    ) -> str:
        """
        Build JSON request prompt for Solution Recommendation.
        """
        payload = {
            "request_type": "recommendation",
            "problem_statement": problem,
            "constraints": constraints or "None provided",
            "sample_input": sample_input or "None provided",
            "sample_output": sample_output or "None provided",
            "preferred_language": preferred_language,
            "instructions": (
                "Analyze the problem statement and return a comprehensive recommendation JSON. "
                "The output JSON MUST contain exactly these fields:\n"
                "- category: (string, e.g. Dynamic Programming, Graph Theory, Greedy, Sliding Window, Array/String, etc.)\n"
                "- recommended_algorithm: (string, e.g. Dijkstra's Algorithm, Two Pointers, Binary Search)\n"
                "- recommended_data_structure: (string, e.g. Priority Queue (Min-Heap), Hash Map, Trie)\n"
                "- recommended_language: (string, preferred language requested)\n"
                "- time_complexity: (string, Big-O notation e.g. O(N log N))\n"
                "- space_complexity: (string, Big-O notation e.g. O(N))\n"
                "- optimized_code: (string, complete, production-ready, clean, well-commented code in the preferred language)\n"
                "- explanation: (string, detailed breakdown of why this approach works, step-by-step logic, key edge cases)\n"
                "- alternative_approaches: (array of objects: [{ name: string, time_complexity: string, space_complexity: string, trade_offs: string }])"
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
