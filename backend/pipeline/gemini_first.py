"""
gemini_first.py — Gemini AI "first" call: test case generation.

Refactored to use shared PromptBuilder, JSONValidator, and Config.
Given a user's code and problem statement, generates 4-8 test cases.
"""

import json
import asyncio
import google.generativeai as genai
from typing import Optional

from config import settings
from schemas import GeminiFirstResponse, GeminiTestCase
from services.prompt_builder import PromptBuilder
from services.json_validator import JSONValidator
from services.logger import get_logger

logger = get_logger("GeminiFirst")

if settings.GEMINI_API_KEY:
    genai.configure(api_key=settings.GEMINI_API_KEY)


async def generate_test_cases(
    code: str,
    language: str,
    problem_statement: str,
    history_summary: Optional[str] = None,
    max_retries: int = 2
) -> GeminiFirstResponse:
    """
    Call Gemini to generate test cases for the submitted code.
    """
    prompt = PromptBuilder.build_evaluation_test_prompt(
        code=code,
        language=language,
        problem_statement=problem_statement,
        history_summary=history_summary
    )

    model = genai.GenerativeModel(
        model_name=settings.GEMINI_MODEL,
        system_instruction=PromptBuilder.EVALUATION_SYSTEM_INSTRUCTION
    )

    last_error = None

    for attempt in range(max_retries + 1):
        try:
            response = await asyncio.to_thread(
                model.generate_content,
                prompt,
                generation_config=genai.GenerationConfig(
                    response_mime_type="application/json",
                    temperature=0.3,
                )
            )

            raw_text = response.text.strip()
            is_valid, parsed_data, err_msg = JSONValidator.parse_and_validate(raw_text, expected_type="first")

            if is_valid and parsed_data:
                first_response = GeminiFirstResponse(**parsed_data)
                if first_response.test_cases:
                    return first_response

            last_error = err_msg or "Empty test cases list"
            logger.warning(f"Attempt {attempt + 1} validation error: {last_error}")

        except Exception as e:
            last_error = str(e)
            logger.error(f"Gemini first call error (Attempt {attempt + 1}): {str(e)}")
            if attempt < max_retries:
                await asyncio.sleep(1)

    logger.warning(f"Using fallback test cases due to error: {last_error}")
    return GeminiFirstResponse(
        response_type="first",
        problem_understanding="Problem evaluation using standard verification test suite.",
        clarifications_needed=[],
        test_cases=[
            GeminiTestCase(id="tc_1", description="Standard input case", stdin="4 9\n2 7 11 15\n", expected_stdout="0 1\n", edge_case=False),
            GeminiTestCase(id="tc_2", description="Sequential input case", stdin="3 6\n3 2 4\n", expected_stdout="0 2\n", edge_case=False),
            GeminiTestCase(id="tc_3", description="Edge case with identical values", stdin="2 6\n3 3\n", expected_stdout="0 1\n", edge_case=True),
        ],
        notes="Evaluated with fallback test cases."
    )
