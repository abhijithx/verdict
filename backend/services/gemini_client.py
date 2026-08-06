"""
gemini_client.py — Shared Gemini API Client for Verdict AI Platform.

Centralizes all calls to Google Gemini API with system instructions,
structured JSON response configuration, retry logic, and error handling.
"""

import json
import asyncio
import google.generativeai as genai
from typing import Dict, Any, Optional

from config import settings
from services.logger import get_logger
from services.prompt_builder import PromptBuilder
from services.json_validator import JSONValidator

logger = get_logger("GeminiClient")

# Configure Gemini global API key
if settings.GEMINI_API_KEY:
    genai.configure(api_key=settings.GEMINI_API_KEY)


class GeminiClient:
    """Client wrapper for Gemini API operations."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.GEMINI_API_KEY
        if self.api_key:
            genai.configure(api_key=self.api_key)

    async def generate_recommendation(
        self,
        problem: str,
        constraints: Optional[str] = None,
        sample_input: Optional[str] = None,
        sample_output: Optional[str] = None,
        preferred_language: str = "Python"
    ) -> Dict[str, Any]:
        """
        Generate a solution recommendation from Gemini API.
        Includes 1 automatic retry if JSON validation fails.
        """
        prompt = PromptBuilder.build_recommendation_prompt(
            problem=problem,
            constraints=constraints,
            sample_input=sample_input,
            sample_output=sample_output,
            preferred_language=preferred_language
        )

        model = genai.GenerativeModel(
            model_name=settings.GEMINI_MODEL,
            system_instruction=PromptBuilder.RECOMMENDATION_SYSTEM_INSTRUCTION
        )

        max_attempts = 2
        last_error = None
        raw_response_text = ""

        for attempt in range(1, max_attempts + 1):
            try:
                logger.info(f"Generating recommendation (Attempt {attempt}/{max_attempts})...")
                
                response = await asyncio.to_thread(
                    model.generate_content,
                    prompt,
                    generation_config=genai.GenerationConfig(
                        response_mime_type="application/json",
                        temperature=0.2,
                    )
                )

                raw_response_text = response.text.strip()
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

            except Exception as e:
                logger.error(f"Gemini API error on attempt {attempt}: {str(e)}")
                last_error = str(e)
                if attempt < max_attempts:
                    await asyncio.sleep(1)

        # Fallback response if API key is missing or quota/rate limit exhausted
        logger.error(f"Failed to generate valid recommendation after {max_attempts} attempts: {last_error}")
        return self._get_recommendation_fallback(problem, preferred_language, last_error)

    def _get_recommendation_fallback(
        self,
        problem: str,
        preferred_language: str,
        error_reason: Optional[str]
    ) -> Dict[str, Any]:
        """Provide a structured fallback recommendation when API calls fail."""
        lang = preferred_language.capitalize()
        return {
            "category": "Algorithm Strategy & Optimization",
            "recommended_algorithm": "Optimal Approach Analysis",
            "recommended_data_structure": "Standard Library Data Structures",
            "recommended_language": preferred_language,
            "time_complexity": "O(N)",
            "space_complexity": "O(1)",
            "optimized_code": f"# Fallback solution for: {problem[:50]}...\n# Preferred Language: {lang}\n\ndef solve():\n    # Implement solution using optimal data structures\n    pass\n\nif __name__ == '__main__':\n    solve()\n",
            "explanation": f"Evaluation system generated a fallback report. Reason: {error_reason or 'API temporarily unavailable'}. Review problem constraints and re-analyze.",
            "alternative_approaches": [
                {
                    "name": "Brute Force Approach",
                    "time_complexity": "O(N^2)",
                    "space_complexity": "O(1)",
                    "trade_offs": "Simpler to write but inefficient for large input constraints."
                }
            ]
        }


gemini_client = GeminiClient()
