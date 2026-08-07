"""
gemini_client.py — Shared AI Client for Verdict AI Platform.

Uses the ai_provider module to support both Gemini and Groq backends.
Centralizes recommendation calls with retry logic and JSON validation.
"""

import json
import asyncio
from typing import Dict, Any, Optional

from config import settings
from services.logger import get_logger
from services.prompt_builder import PromptBuilder
from services.json_validator import JSONValidator
from services.ai_provider import call_ai, AIProviderError

logger = get_logger("AIClient")


class GeminiAPIError(Exception):
    """Raised when AI API calls fail after all retries."""
    pass


class GeminiClient:
    """Client wrapper for AI API operations (supports Gemini + Groq)."""

    async def generate_recommendation(
        self,
        problem: str,
        constraints: Optional[str] = None,
        sample_input: Optional[str] = None,
        sample_output: Optional[str] = None,
        preferred_language: str = "Python"
    ) -> Dict[str, Any]:
        """
        Generate a solution recommendation via AI provider.
        Includes 1 automatic retry if JSON validation fails.
        """
        prompt = PromptBuilder.build_recommendation_prompt(
            problem=problem,
            constraints=constraints,
            sample_input=sample_input,
            sample_output=sample_output,
            preferred_language=preferred_language
        )

        max_attempts = 2
        last_error = None

        for attempt in range(1, max_attempts + 1):
            try:
                logger.info(f"Generating recommendation (Attempt {attempt}/{max_attempts}) via {settings.AI_PROVIDER}...")

                raw_response_text = await call_ai(
                    system_instruction=PromptBuilder.RECOMMENDATION_SYSTEM_INSTRUCTION,
                    prompt=prompt,
                    temperature=0.2
                )

                is_valid, parsed_data, err_msg = JSONValidator.parse_and_validate(
                    raw_response_text, expected_type="recommendation"
                )

                if is_valid and parsed_data:
                    logger.info("Recommendation successfully generated and validated.")
                    return parsed_data

                logger.warning(f"Attempt {attempt} validation error: {err_msg}")
                last_error = err_msg

                # If first attempt failed validation, adjust prompt slightly for retry
                if attempt < max_attempts:
                    prompt += "\n\nCRITICAL FIX: Ensure all required fields are populated with non-empty string values and valid JSON."
                    await asyncio.sleep(1)

            except AIProviderError as e:
                logger.error(f"AI provider error on attempt {attempt}: {str(e)}")
                last_error = str(e)
                if attempt < max_attempts:
                    await asyncio.sleep(1)
            except Exception as e:
                logger.error(f"AI API error on attempt {attempt}: {str(e)}")
                last_error = str(e)
                if attempt < max_attempts:
                    await asyncio.sleep(1)

        # Do NOT return fake results — raise so the caller knows it failed
        logger.error(f"Failed to generate valid recommendation after {max_attempts} attempts: {last_error}")
        raise GeminiAPIError(
            f"Could not analyze this problem right now. Reason: {last_error or 'API temporarily unavailable'}. "
            f"Please wait a minute and try again."
        )


gemini_client = GeminiClient()
