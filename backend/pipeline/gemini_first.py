"""
gemini_first.py — AI "first" call: test case generation.

Refactored to use shared AI provider (supports Gemini + Groq).
Given a user's code and problem statement, generates 4-8 test cases.
"""

import json
import asyncio
from typing import Optional

from config import settings
from schemas import GeminiFirstResponse, GeminiTestCase
from services.prompt_builder import PromptBuilder
from services.json_validator import JSONValidator
from services.ai_provider import call_ai, AIProviderError
from services.logger import get_logger

logger = get_logger("GeminiFirst")


class TestGenerationFailedError(Exception):
    """Raised when AI cannot generate valid test cases after retries."""
    pass


async def generate_test_cases(
    code: str,
    language: str,
    problem_statement: str,
    history_summary: Optional[str] = None,
    max_retries: int = 2
) -> GeminiFirstResponse:
    """
    Call AI provider to generate test cases for the submitted code.
    """
    prompt = PromptBuilder.build_evaluation_test_prompt(
        code=code,
        language=language,
        problem_statement=problem_statement,
        history_summary=history_summary
    )

    last_error = None

    for attempt in range(max_retries + 1):
        try:
            raw_text = await call_ai(
                system_instruction=PromptBuilder.EVALUATION_SYSTEM_INSTRUCTION,
                prompt=prompt,
                temperature=0.3
            )

            is_valid, parsed_data, err_msg = JSONValidator.parse_and_validate(raw_text, expected_type="first")

            if is_valid and parsed_data:
                first_response = GeminiFirstResponse(**parsed_data)
                if first_response.test_cases:
                    return first_response

            last_error = err_msg or "Empty test cases list"
            logger.warning(f"Attempt {attempt + 1} validation error: {last_error}")

        except AIProviderError as e:
            last_error = str(e)
            logger.error(f"AI provider error (Attempt {attempt + 1}): {str(e)}")
            if attempt < max_retries:
                await asyncio.sleep(1)
        except Exception as e:
            last_error = str(e)
            logger.error(f"AI first call error (Attempt {attempt + 1}): {str(e)}")
            if attempt < max_retries:
                await asyncio.sleep(1)

    logger.error(f"Test case generation failed after {max_retries + 1} attempts: {last_error}")
    raise TestGenerationFailedError(f"Failed to generate valid AI test cases: {last_error}")
