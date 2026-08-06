"""
database.py — SQLAlchemy async engine and session factory for CodeScore AI.

Uses SQLite via aiosqlite for zero-setup, zero-dependency database access.
The DATABASE_URL is read from environment variables (defaults to a local file).

Key components:
  - engine: Async SQLAlchemy engine connected to SQLite
  - AsyncSessionLocal: Session factory for creating database sessions
  - Base: Declarative base class for all ORM models
  - get_db(): FastAPI dependency that yields a database session per request
  - init_db(): Creates all tables on first run
"""

import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from dotenv import load_dotenv

# Load environment variables from .env file in the backend directory
load_dotenv()

# Database URL — defaults to a local SQLite file in the backend directory
# Uses aiosqlite driver for async support with SQLAlchemy
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./codescore.db")

# Create the async engine
# echo=False in production; set to True for SQL query debugging
# connect_args={"check_same_thread": False} is required for SQLite
# because SQLite by default only allows the creating thread to use the connection
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False}
)

# Session factory — each call to AsyncSessionLocal() creates a new session
# expire_on_commit=False prevents attributes from being expired after commit,
# which is useful when returning ORM objects from endpoints
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)


class Base(DeclarativeBase):
    """
    Declarative base class for all SQLAlchemy ORM models.
    All model classes inherit from this to register with the metadata.
    """
    pass


async def get_db():
    """
    FastAPI dependency that provides a database session.
    
    Usage in a route:
        @router.get("/items")
        async def get_items(db: AsyncSession = Depends(get_db)):
            ...
    
    The session is automatically closed when the request completes,
    even if an exception occurs (thanks to the finally block).
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """
    Create all database tables defined in the ORM models.
    """
    import models  # noqa: F401 — side-effect import for table registration
    
    async with engine.begin() as conn:
        # If recommendation_history table exists without 'problem' column, drop it so create_all recreates it
        def _check_and_fix_tables(db_conn):
            from sqlalchemy import inspect, text
            inspector = inspect(db_conn)
            tables = inspector.get_table_names()
            if "recommendation_history" in tables:
                cols = [c["name"] for c in inspector.get_columns("recommendation_history")]
                if "problem" not in cols:
                    db_conn.execute(text("DROP TABLE recommendation_history"))
            Base.metadata.create_all(db_conn)

        await conn.run_sync(_check_and_fix_tables)

