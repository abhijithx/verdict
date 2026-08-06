"""
logger.py — Centralized logging utility for Verdict AI Platform.
"""

import logging
import sys
from config import settings

def get_logger(name: str) -> logging.Logger:
    """
    Get a configured logger instance for a module.
    
    Args:
        name: Name of the module/service requesting logger
        
    Returns:
        logging.Logger: Configured logger
    """
    logger = logging.getLogger(name)
    if not logger.handlers:
        logger.setLevel(getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO))
        
        handler = logging.StreamHandler(sys.stdout)
        formatter = logging.Formatter(
            '[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        
    return logger
