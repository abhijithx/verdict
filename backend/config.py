"""
config.py — Centralized configuration management for Verdict AI Platform.

Loads configuration options from environment variables (.env file)
and provides safe defaults for all modules.
"""

import os
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()


class Settings:
    """Application Settings Configuration."""
    
    PROJECT_NAME: str = "Verdict AI Programming Analysis Platform"
    VERSION: str = "2.0.0"
    
    # Gemini API Configuration
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    
    # Piston Execution API Configuration
    PISTON_URL: str = os.getenv("PISTON_URL", "https://emkc.org/api/v2/piston/execute")
    
    # Database Configuration
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./codescore.db")
    
    # Logging Configuration
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")


settings = Settings()
