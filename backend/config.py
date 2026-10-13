"""
config.py — Centralized configuration management for Verdict AI Platform.

Loads configuration options from environment variables (.env file)
and provides safe defaults for all modules.
"""

import os
import pathlib
from dotenv import load_dotenv

# Ensure .env is discovered whether running from workspace root or backend dir
_BACKEND_DIR = pathlib.Path(__file__).resolve().parent
_ENV_PATHS = [
    _BACKEND_DIR / ".env",
    _BACKEND_DIR.parent / ".env",
]
for _env_path in _ENV_PATHS:
    if _env_path.exists():
        load_dotenv(dotenv_path=_env_path, override=False)
load_dotenv()


class Settings:
    """Application Settings Configuration."""
    
    PROJECT_NAME: str = "Verdict AI Programming Analysis Platform"
    VERSION: str = "2.0.0"
    
    # AI Provider Switch: 'gemini' or 'groq'
    AI_PROVIDER: str = os.getenv("AI_PROVIDER", "gemini")
    
    # Gemini API Configuration
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")

    
    # Groq API Configuration
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
    
    # Execution Engine Configuration (Pure local sandbox)
    EXECUTION_ENGINE: str = "local"
    
    # Database Configuration
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./codescore.db")
    
    # Logging Configuration
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")


settings = Settings()
