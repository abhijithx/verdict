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
    
    # AI Provider Switch: 'gemini' or 'groq'
    AI_PROVIDER: str = os.getenv("AI_PROVIDER", "gemini")
    
    # Gemini API Configuration
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
    
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
