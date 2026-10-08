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

    RECOMMENDATION_CHAT_SYSTEM_INSTRUCTION = (
        "You are an elite competitive programming mentor and algorithms expert at Verdict AI. "
        "Your mission is to resolve every doubt, confusion, or technical question the user has regarding "
        "the problem, algorithmic strategy, data structures, code implementation, Big-O bounds, and edge cases.\n"
        "Guidelines:\n"
        "1. Educational Clarity: Explain concepts clearly and concisely with intuitive analogies, bullet points, and code snippets.\n"
        "2. Step-by-Step Tracing & Dry Runs: When asked to explain or trace, provide clear step-by-step state changes or mini trace tables.\n"
        "3. Resolving Doubts: Directly answer 'why' questions (e.g., why this data structure, why not greedy/DP, how to handle negative numbers or empty inputs).\n"
        "4. Code Updates: If the user asks for code modifications, bug fixes, optimizations, or translations to another language, provide the complete, ready-to-run replacement in 'code_update'. Otherwise set 'code_update' to null.\n"
        "5. Follow-up Suggestions: Always provide 2-4 concise, clickable follow-up doubts or questions in 'suggested_improvements' that help the user deepen their mastery.\n"
        "6. Output Format: You MUST output ONLY a valid JSON object with keys: 'answer' (string), 'suggested_improvements' (list of strings), and 'code_update' (string or null)."
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
                "- title: (string) Canonical, concise problem title (e.g. 'Two Sum', 'LRU Cache', 'Valid Parentheses')\n"
                "- difficulty: (string) 'easy', 'medium', or 'hard'\n"
                "- category: (string) Algorithm family, e.g. 'Dynamic Programming', 'Graph Theory', 'Greedy', 'Sorting & Searching'\n"
                "- recommended_algorithm: (string) Specific named algorithm\n"
                "- recommended_data_structure: (string) Primary data structure used\n"
                "- recommended_language: (string) The programming language\n"
                "- time_complexity: (string) Big-O notation with variable explanation, e.g. 'O(N log N) where N = array length'\n"
                "- space_complexity: (string) Big-O notation, e.g. 'O(N)'\n"
                "- optimized_code: (string) COMPLETE working code — reads stdin, writes stdout, handles edge cases\n"
                "- explanation: (string) DETAILED algorithm walkthrough — the core logic, key insight, step-by-step reasoning\n"
                "- alternative_approaches: (array) [{name, time_complexity, space_complexity, trade_offs}]\n"
                "- sample_test_cases: (array) 1 to 3 test cases for code execution: [{stdin: (string), expected_stdout: (string), description: (string)}]"
            )
        }
        return json.dumps(payload, indent=2)

    @staticmethod
    def build_recommendation_chat_prompt(
        problem: str,
        question: str,
        code: Optional[str] = None,
        algorithm: Optional[str] = None,
        language: Optional[str] = None,
        chat_history: Optional[List[Dict[str, str]]] = None,
    ) -> str:
        """
        Build JSON request prompt for interactive AI Copilot Q&A on recommendation.
        """
        payload = {
            "request_type": "recommendation_chat",
            "problem_statement": problem,
            "current_algorithm": algorithm or "Optimal Algorithm",
            "language": language or "Python",
            "current_reference_code": code or "None provided",
            "user_question": question,
            "recent_chat_history": chat_history[-6:] if chat_history else [],
            "instructions": (
                "You are an elite competitive programming mentor and algorithms expert at Verdict AI. "
                "The user is asking a question or seeking doubt resolution about this problem and algorithm. "
                "Directly resolve their doubt with intuitive explanations, step-by-step logic, edge-case analysis, or dry-run traces. "
                "Use clean markdown formatting (headers, bold text, bullet points, and code blocks). "
                "If the user asks for code changes, optimizations, bug fixes, or translations to another language, provide the full, "
                "clean, working updated code in 'code_update'. Otherwise set 'code_update' to null. "
                "Always provide 2 to 4 concise, clickable follow-up doubts or questions in 'suggested_improvements' that the user can explore next.\n"
                "Return JSON with keys: 'answer' (string), 'suggested_improvements' (list of strings), 'code_update' (string or null)."
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
                "described in the problem statement.\n\n"
                "CRITICAL FORMAT RULE FOR TEST CASES:\n"
                "- If the user's code uses a LeetCode style Solution class or function (e.g. def twoSum(self, nums, target)), "
                "format 'stdin' matching the function's arguments (e.g. 'nums = [2,7,11,15], target = 9' or line-by-line '[2,7,11,15]\\n9'), "
                "and format 'expected_stdout' matching the function's return value (e.g. '[0, 1]' or 'true').\n"
                "- If the user's code reads standard input directly (sys.stdin/cin/Scanner), format stdin and expected_stdout matching raw I/O.\n\n"
                "You MUST respond with a single valid JSON object containing exactly these fields:\n"
                "- response_type: (string) must be 'first'\n"
                "- problem_understanding: (string) brief explanation of what the problem requires\n"
                "- clarifications_needed: (array of strings) list of clarifications or assumptions, or empty list if none\n"
                "- test_cases: (array) a list of test cases, each containing:\n"
                "  - id: (string) unique ID for the test case (e.g. 'tc_1', 'tc_2', NOT an integer)\n"
                "  - description: (string) explanation of what this test case verifies\n"
                "  - stdin: (string) exact standard input string to pass to the program\n"
                "  - expected_stdout: (string) exact expected standard output string from the program\n"
                "  - edge_case: (boolean) true if it's an edge case or complexity case, false otherwise\n"
                "- notes: (string) any additional notes or commentary, or empty string"
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
            "instructions": (
                "Analyze this code against the problem statement using the REAL execution results provided above. "
                "You MUST respond with a single valid JSON object containing exactly these fields:\n\n"
                "- verdict: (string) one of 'optimal', 'needs_improvement', or 'incorrect'\n"
                "- correctness_summary: (string) 2-3 sentence summary of correctness based on test results\n"
                "- failing_cases: (array) [{id, why_it_fails, fix_suggestion}] for each failing test\n"
                "- complexity: (object) {time: string, space: string, is_optimal: bool, optimal_time: string, optimal_space: string}\n"
                "- complexity_chart: (object) {type: 'bar', labels: [string], datasets: [{label: string, values: [number]}]}\n"
                "- optimization_suggestions: (array of strings) specific actionable improvements\n"
                "- code_explanation: (string) step-by-step walkthrough of the code logic\n"
                "- quality_score: (int 0-100) code quality rating\n"
                "- readability_score: (int 0-100) readability rating\n"
                "- documentation_score: (int 0-100) documentation rating\n"
                "- quality_issues: (array) [{issue: string, severity: 'low'|'medium'|'high', suggestion: string}]\n"
                "- final_notes: (string) brief closing remarks\n\n"
                "IMPORTANT: Base your verdict on the ACTUAL execution results. "
                "If all tests passed, verdict should be 'optimal' or 'needs_improvement'. "
                "If any tests failed, analyze WHY they failed."
            )
        }
        return json.dumps(payload, indent=2)
