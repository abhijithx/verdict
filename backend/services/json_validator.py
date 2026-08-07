"""
json_validator.py — JSON Response Validator for Gemini AI outputs.

Validates structured JSON output from Gemini calls, checking required fields,
non-empty strings, code availability, and complexity specifications.
"""

import json
from typing import Dict, Any, List, Tuple, Optional
from services.logger import get_logger

logger = get_logger("JSONValidator")


class JSONValidator:
    """Validator for verifying structure and completeness of AI responses."""

    RECOMMENDATION_REQUIRED_FIELDS = [
        "category",
        "recommended_algorithm",
        "recommended_data_structure",
        "recommended_language",
        "time_complexity",
        "space_complexity",
        "optimized_code",
        "explanation",
        "alternative_approaches"
    ]

    @classmethod
    def clean_json_string(cls, raw_text: str) -> str:
        """
        Clean markdown fences or stray commentary around JSON text.
        """
        text = raw_text.strip()
        if text.startswith("```"):
            first_newline = text.find("\n")
            if first_newline != -1:
                text = text[first_newline + 1:]
            if text.endswith("```"):
                text = text[:-3]
            elif "```" in text:
                last_fence = text.rfind("```")
                text = text[:last_fence]
        return text.strip()

    @classmethod
    def parse_and_validate(
        cls,
        raw_text: str,
        expected_type: str = "recommendation"
    ) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """
        Parse and validate raw JSON text from Gemini.
        
        Args:
            raw_text: Raw string returned from model
            expected_type: 'recommendation', 'first', or 'second'
            
        Returns:
            Tuple[is_valid, parsed_json_or_none, error_message_or_none]
        """
        cleaned = cls.clean_json_string(raw_text)
        
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as e:
            logger.warning(f"JSON decode failed: {str(e)}")
            return False, None, f"Invalid JSON format: {str(e)}"

        if not isinstance(data, dict):
            return False, None, "Response must be a JSON object"

        if expected_type == "recommendation":
            return cls._validate_recommendation(data)
        elif expected_type == "first":
            return cls._validate_first(data)
        elif expected_type == "second":
            return cls._validate_second(data)
        
        return True, data, None

    @classmethod
    def _validate_recommendation(cls, data: Dict[str, Any]) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """Validate Solution Recommendation JSON schema."""
        missing = []
        for field in cls.RECOMMENDATION_REQUIRED_FIELDS:
            if field not in data:
                missing.append(field)

        if missing:
            return False, data, f"Missing required fields: {', '.join(missing)}"

        # Check empty string values
        empty_fields = []
        for field in ["category", "recommended_algorithm", "time_complexity", "space_complexity", "optimized_code", "explanation"]:
            val = data.get(field)
            if not val or not isinstance(val, str) or not val.strip():
                empty_fields.append(field)

        if empty_fields:
            return False, data, f"Fields cannot be empty: {', '.join(empty_fields)}"

        # Validate alternative_approaches list
        alts = data.get("alternative_approaches")
        if not isinstance(alts, list):
            data["alternative_approaches"] = []

        return True, data, None

    @classmethod
    def _validate_first(cls, data: Dict[str, Any]) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """Validate Evaluation Stage 1 JSON schema."""
        test_cases = data.get("test_cases")
        if not test_cases or not isinstance(test_cases, list) or len(test_cases) == 0:
            return False, data, "Generated test_cases list must not be empty"
        if len(test_cases) < 4:
            return False, data, f"Only {len(test_cases)} test cases generated; minimum 4 required"
        return True, data, None

    @classmethod
    def _validate_second(cls, data: Dict[str, Any]) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """Validate Evaluation Stage 2 JSON schema."""
        if "verdict" not in data or "complexity" not in data:
            return False, data, "Missing verdict or complexity analysis"
        return True, data, None
