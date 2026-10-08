"""
ai_provider.py — Unified AI Provider for Verdict AI Platform.

Supports Gemini and Groq backends with identical interface.
Switch via AI_PROVIDER env var ('gemini' or 'groq').
Auto-fallback: if primary fails, tries the secondary provider.
"""

import json
import asyncio
import httpx
from typing import Dict, Any, Optional

from config import settings
from services.logger import get_logger

logger = get_logger("AIProvider")


class AIProviderError(Exception):
    """Raised when all AI providers fail after retries."""
    pass


async def _call_gemini(
    system_instruction: str,
    prompt: str,
    temperature: float = 0.2
) -> str:
    """Call Google Gemini API with automatic model cascading if a model is unavailable."""
    from google import genai
    from google.genai import types

    if not settings.GEMINI_API_KEY:
        raise AIProviderError("GEMINI_API_KEY not configured")

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    candidate_models = [settings.GEMINI_MODEL, "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite"]
    seen = set()
    models_to_try = [m for m in candidate_models if m and not (m in seen or seen.add(m))]

    last_err = None
    for model_name in models_to_try:
        def _sync_call(m_name=model_name):
            response = client.models.generate_content(
                model=m_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    response_mime_type="application/json",
                    temperature=temperature,
                ),
            )
            return response.text.strip()

        try:
            return await asyncio.wait_for(asyncio.to_thread(_sync_call), timeout=35)
        except Exception as e:
            last_err = e
            logger.warning(f"Gemini model '{model_name}' encountered issue ({e}); trying next fallback model if available...")

    raise AIProviderError(f"All Gemini candidate models failed. Last error: {last_err}")


async def _call_groq(
    system_instruction: str,
    prompt: str,
    temperature: float = 0.2
) -> str:
    """Call Groq API (OpenAI-compatible) with fallback model support."""
    if not settings.GROQ_API_KEY:
        raise AIProviderError("GROQ_API_KEY not configured")

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    
    sys_msg = system_instruction
    if "json" not in sys_msg.lower():
        sys_msg += "\nYou MUST respond with a single valid JSON object."

    candidate_models = [settings.GROQ_MODEL, "openai/gpt-oss-120b", "qwen/qwen3.8-27b"]
    seen = set()
    models_to_try = [m for m in candidate_models if m and not (m in seen or seen.add(m))]

    last_err = None
    async with httpx.AsyncClient(timeout=45.0) as client:
        for model_name in models_to_try:
            payload = {
                "model": model_name,
                "messages": [
                    {"role": "system", "content": sys_msg},
                    {"role": "user", "content": prompt},
                ],
                "temperature": temperature,
                "max_tokens": 4096,
                "response_format": {"type": "json_object"}
            }
            try:
                resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code == 400:
                    payload.pop("response_format", None)
                    resp = await client.post(url, headers=headers, json=payload)

                if resp.status_code == 200:
                    data = resp.json()
                    return data["choices"][0]["message"]["content"].strip()
                elif resp.status_code in (429, 503):
                    logger.warning(f"Groq model '{model_name}' rate limited/unavailable ({resp.status_code}), trying next model...")
                    continue
                else:
                    last_err = f"Status {resp.status_code}: {resp.text[:200]}"
            except Exception as ex:
                last_err = str(ex)
                continue

    raise AIProviderError(f"All Groq models failed. Last error: {last_err}")


async def call_ai(
    system_instruction: str,
    prompt: str,
    temperature: float = 0.2
) -> str:
    """
    Call the configured AI provider. If it fails, try the fallback.
    Returns raw JSON string response.
    """
    primary = settings.AI_PROVIDER.lower()
    providers = {
        "gemini": _call_gemini,
        "groq": _call_groq,
    }

    # Determine primary and fallback
    if primary not in providers:
        primary = "gemini"
    fallback = "groq" if primary == "gemini" else "gemini"

    # Try primary
    try:
        logger.info(f"Calling AI provider: {primary}")
        result = await providers[primary](system_instruction, prompt, temperature)
        logger.info(f"AI provider '{primary}' responded successfully.")
        return result
    except Exception as e:
        logger.warning(f"Primary provider '{primary}' failed: {e}")

    # Try fallback
    try:
        logger.info(f"Falling back to AI provider: {fallback}")
        result = await providers[fallback](system_instruction, prompt, temperature)
        logger.info(f"Fallback provider '{fallback}' responded successfully.")
        return result
    except Exception as e:
        logger.error(f"Fallback provider '{fallback}' also failed: {e}")
        raise AIProviderError(
            f"Both AI providers failed. {primary}: quota/error, {fallback}: {e}. "
            f"Please check your API keys in .env and try again."
        )
