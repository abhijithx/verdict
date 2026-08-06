"""
database_service.py — Database service manager for Verdict AI Platform.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from database import engine, Base, AsyncSessionLocal, init_db, get_db

class DatabaseService:
    """Database management operations."""
    
    @staticmethod
    async def initialize():
        """Initialize database schema and tables."""
        await init_db()
        
    @staticmethod
    def get_session_factory():
        """Get database session factory."""
        return AsyncSessionLocal


database_service = DatabaseService()
