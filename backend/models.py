"""
models.py — SQLAlchemy ORM models for all CodeScore AI database tables.

This module defines the complete data model for the application:
  - EvaluationProfile: Configurable scoring weight profiles (College, Contest, Interview, custom)
  - Problem: Problem statements that users write code against
  - Session: A single code submission attempt by a user against a problem
  - DryRunResult: Compile/runtime check results before AI analysis
  - GeneratedTestCase: AI-generated test cases (stdin/expected_stdout pairs)
  - ExecutionResult: Real execution results of user code against each test case
  - AnalysisResult: AI analysis + deterministic scoring results

Relationships:
  Problem 1──N Session 1──1 AnalysisResult
  Session 1──N DryRunResult
  Session 1──N GeneratedTestCase 1──1 ExecutionResult
  EvaluationProfile 1──N Session
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Text, Float, Boolean,
    DateTime, ForeignKey, JSON, CheckConstraint
)
from sqlalchemy.orm import relationship
from database import Base


class EvaluationProfile(Base):
    """
    Stores configurable weight profiles for the scoring engine.
    
    Each profile defines how much weight is given to each scoring dimension
    (correctness, performance, optimization, quality, readability, documentation).
    Weights must sum to 1.0 (validated in Pydantic schema since SQLite doesn't
    enforce CHECK constraints reliably).
    
    Ships with 3 default profiles: College Default, Contest Mode, Interview Strict.
    Users can create custom profiles via the slider UI.
    """
    __tablename__ = "evaluation_profiles"

    profile_id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)                          # Human-readable profile name
    is_default = Column(Boolean, default=False)                         # True for the 3 seeded profiles
    
    # Weight fields — each represents the fraction of the final score (0.0 to 1.0)
    # All six weights must sum to 1.0
    correctness_weight = Column(Float, nullable=False, default=0.40)    # Tests passed / tests total
    performance_weight = Column(Float, nullable=False, default=0.20)    # Time complexity score
    optimization_weight = Column(Float, nullable=False, default=0.15)   # Is this the optimal approach?
    quality_weight = Column(Float, nullable=False, default=0.15)        # Code quality issues
    readability_weight = Column(Float, nullable=False, default=0.05)    # Code readability
    documentation_weight = Column(Float, nullable=False, default=0.05)  # Comments/docstrings
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationship: one profile can be used by many sessions
    sessions = relationship("Session", back_populates="profile")

    def __repr__(self):
        return f"<EvaluationProfile(name='{self.name}', correctness={self.correctness_weight})>"


class Problem(Base):
    """
    A coding problem that users write solutions for.
    
    Contains the problem title, description (the full problem statement),
    and difficulty level. Problems are created via the New Session modal
    or can be seeded at startup.
    """
    __tablename__ = "problems"

    problem_id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(255), nullable=False)                     # Short problem title
    description = Column(Text, nullable=False)                      # Full problem statement
    difficulty = Column(String(20), default="medium")               # easy / medium / hard
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationship: one problem can have many sessions (submissions)
    sessions = relationship("Session", back_populates="problem", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Problem(title='{self.title}', difficulty='{self.difficulty}')>"


class Session(Base):
    """
    A single code submission session — the central entity of the pipeline.
    
    Tracks the user's code, chosen language, evaluation profile, and current
    pipeline status. Status progresses through:
      pending → dry_run_failed (if compile error)
      pending → generating_tests → executing → analyzing → complete
      Any stage can transition to 'failed' on unexpected errors.
    
    history_summary stores compressed context from prior submissions in the
    same session, used for token-efficient multi-turn AI interactions.
    """
    __tablename__ = "sessions"

    session_id = Column(Integer, primary_key=True, autoincrement=True)
    problem_id = Column(Integer, ForeignKey("problems.problem_id", ondelete="CASCADE"), nullable=False)
    profile_id = Column(Integer, ForeignKey("evaluation_profiles.profile_id"), nullable=True)
    submission_label = Column(String(255), nullable=False)          # e.g., "Candidate A", "Attempt 1"
    language = Column(String(20), nullable=False)                   # python / cpp / java
    code = Column(Text, nullable=False)                             # The submitted source code
    status = Column(String(30), default="pending")                  # Pipeline status (see docstring)
    history_summary = Column(Text, nullable=True)                   # Compressed prior-turn context
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    problem = relationship("Problem", back_populates="sessions")
    profile = relationship("EvaluationProfile", back_populates="sessions")
    dry_run_results = relationship("DryRunResult", back_populates="session", cascade="all, delete-orphan")
    test_cases = relationship("GeneratedTestCase", back_populates="session", cascade="all, delete-orphan")
    execution_results = relationship("ExecutionResult", back_populates="session", cascade="all, delete-orphan")
    analysis = relationship("AnalysisResult", back_populates="session", uselist=False, cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Session(id={self.session_id}, lang='{self.language}', status='{self.status}')>"


class DryRunResult(Base):
    """
    Result of the compilation/runtime dry-run check (no stdin, no test cases).
    
    This runs BEFORE any AI calls. If the dry run fails (compile error or
    runtime crash), the submission is blocked and the error is shown inline
    in the Monaco editor via gutter markers.
    
    error_line is extracted from stderr using language-specific regex patterns
    (see error_parser.py).
    """
    __tablename__ = "dry_run_results"

    dry_run_id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("sessions.session_id", ondelete="CASCADE"), nullable=False)
    passed = Column(Boolean, nullable=False)                        # True if no compile/runtime errors
    stdout = Column(Text, nullable=True)                            # Standard output (if any)
    stderr = Column(Text, nullable=True)                            # Error output (compile or runtime errors)
    error_line = Column(Integer, nullable=True)                     # Parsed error line number (nullable)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationship back to session
    session = relationship("Session", back_populates="dry_run_results")

    def __repr__(self):
        return f"<DryRunResult(session={self.session_id}, passed={self.passed})>"


class GeneratedTestCase(Base):
    """
    An AI-generated test case (from Gemini "first" response).
    
    Each test case is a stdin/expected_stdout pair that will be executed
    against the user's code via the Piston API. The AI generates 4-8 test
    cases per submission, including at least one happy-path, one edge case,
    and one complexity-probing case.
    """
    __tablename__ = "generated_test_cases"

    test_id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("sessions.session_id", ondelete="CASCADE"), nullable=False)
    test_case_id = Column(String(50), nullable=True)                # AI-assigned ID (e.g., "tc_1")
    description = Column(Text, nullable=True)                       # Human-readable test description
    stdin = Column(Text, nullable=False)                            # Input to feed to the program
    expected_stdout = Column(Text, nullable=False)                  # Expected output from the program
    is_edge_case = Column(Boolean, default=False)                   # True if this tests an edge case
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationships
    session = relationship("Session", back_populates="test_cases")
    execution_result = relationship("ExecutionResult", back_populates="test_case", uselist=False,
                                     cascade="all, delete-orphan")

    def __repr__(self):
        return f"<GeneratedTestCase(id={self.test_id}, edge={self.is_edge_case})>"


class ExecutionResult(Base):
    """
    Real execution result of the user's code against a single test case.
    
    This is the core of "verified correctness" — the code is actually run
    via Piston with the test case's stdin, and the actual stdout is compared
    to the expected stdout. The AI never determines pass/fail; this is a
    direct string comparison of real execution output.
    
    time_ms is approximate (wall-clock from Piston API round-trip), not
    precise CPU benchmarking. Noted as a known limitation.
    """
    __tablename__ = "execution_results"

    exec_id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("sessions.session_id", ondelete="CASCADE"), nullable=False)
    test_id = Column(Integer, ForeignKey("generated_test_cases.test_id", ondelete="CASCADE"), nullable=False)
    passed = Column(Boolean, nullable=False)                        # True if actual_stdout matches expected
    actual_stdout = Column(Text, nullable=True)                     # What the program actually printed
    stderr = Column(Text, nullable=True)                            # Any error output during execution
    time_ms = Column(Float, nullable=True)                          # Approximate execution time in ms
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationships
    session = relationship("Session", back_populates="execution_results")
    test_case = relationship("GeneratedTestCase", back_populates="execution_result")

    def __repr__(self):
        return f"<ExecutionResult(test={self.test_id}, passed={self.passed})>"


class AnalysisResult(Base):
    """
    AI analysis results (from Gemini "second" response) + deterministic scores.
    
    This table stores BOTH the raw AI analysis (verdict, complexity, suggestions,
    explanation) AND the computed scores from the scoring engine. The scoring
    engine is deterministic and transparent — it uses the AI's output as input
    signals but the final score computation is pure math (see scorer.py).
    
    One-to-one with Session (each session has at most one analysis).
    """
    __tablename__ = "analysis_results"

    analysis_id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("sessions.session_id", ondelete="CASCADE"),
                        nullable=False, unique=True)                # One analysis per session

    # --- AI-generated fields (from Gemini "second" response) ---
    verdict = Column(String(30), nullable=True)                     # optimal / needs_improvement / incorrect
    correctness_summary = Column(Text, nullable=True)               # Explanation of correctness
    failing_cases_json = Column(JSON, nullable=True)                # [{id, why_it_fails, fix_suggestion}]
    time_complexity = Column(String(30), nullable=True)             # e.g., "O(n log n)"
    space_complexity = Column(String(30), nullable=True)            # e.g., "O(n)"
    is_optimal = Column(Boolean, nullable=True)                     # Whether solution is optimal
    optimal_time = Column(String(30), nullable=True)                # Best known time complexity
    optimal_space = Column(String(30), nullable=True)               # Best known space complexity
    complexity_chart_json = Column(JSON, nullable=True)             # Chart.js-ready data
    optimization_suggestions_json = Column(JSON, nullable=True)     # List of optimization suggestions
    code_explanation = Column(Text, nullable=True)                  # Plain-English code walkthrough
    quality_issues_json = Column(JSON, nullable=True)               # [{issue, severity, suggestion}]
    final_notes = Column(Text, nullable=True)                       # Additional AI commentary

    # --- Deterministic scores (computed by scoring engine, NOT the AI) ---
    correctness_score = Column(Integer, nullable=True)              # 0-100, from tests_passed/tests_total
    performance_score = Column(Integer, nullable=True)              # 0-100, from COMPLEXITY_SCORE_MAP
    optimization_score = Column(Integer, nullable=True)             # 0-100, from is_optimal signal
    quality_score = Column(Integer, nullable=True)                  # 0-100, from AI quality analysis
    readability_score = Column(Integer, nullable=True)              # 0-100, from AI readability analysis
    documentation_score = Column(Integer, nullable=True)            # 0-100, from AI documentation analysis
    final_score = Column(Integer, nullable=True)                    # Weighted combination of all scores

    evaluated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationship back to session
    session = relationship("Session", back_populates="analysis")

    def __repr__(self):
        return f"<AnalysisResult(session={self.session_id}, verdict='{self.verdict}', score={self.final_score})>"


class User(Base):
    """
    User account entity for authentication and user history tracking.
    """
    __tablename__ = "users"

    user_id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationships
    recommendations = relationship("RecommendationHistory", back_populates="user", cascade="all, delete-orphan")
    evaluations = relationship("EvaluationHistory", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User(username='{self.username}', email='{self.email}')>"


class RecommendationHistory(Base):
    """
    Stores history of problem recommendation analyses.
    """
    __tablename__ = "recommendation_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    problem = Column(Text, nullable=False)
    constraints = Column(Text, nullable=True)
    sample_input = Column(Text, nullable=True)
    sample_output = Column(Text, nullable=True)
    preferred_language = Column(String(50), nullable=False)

    category = Column(String(100), nullable=True)
    recommended_algorithm = Column(String(255), nullable=True)
    recommended_data_structure = Column(String(255), nullable=True)
    recommended_language = Column(String(50), nullable=True)
    time_complexity = Column(String(50), nullable=True)
    space_complexity = Column(String(50), nullable=True)
    optimized_code = Column(Text, nullable=True)
    explanation = Column(Text, nullable=True)
    alternative_approaches = Column(JSON, nullable=True)

    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationship
    user = relationship("User", back_populates="recommendations")

    def __repr__(self):
        return f"<RecommendationHistory(id={self.id}, algorithm='{self.recommended_algorithm}')>"


class EvaluationHistory(Base):
    """
    Stores direct evaluation history records.
    """
    __tablename__ = "evaluation_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    problem = Column(Text, nullable=False)
    language = Column(String(50), nullable=False)
    user_code = Column(Text, nullable=False)
    analysis = Column(JSON, nullable=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationship
    user = relationship("User", back_populates="evaluations")

    def __repr__(self):
        return f"<EvaluationHistory(id={self.id}, language='{self.language}')>"

