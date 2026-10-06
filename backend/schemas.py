"""
schemas.py — Pydantic request/response schemas for CodeScore AI API.

These schemas handle:
  - Input validation (e.g., profile weights must sum to 1.0)
  - Response serialization (consistent JSON shapes for the frontend)
  - Type safety across the entire API layer

Each schema class documents its purpose and which endpoint(s) use it.
"""

from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict
from typing import Optional, List
from datetime import datetime
from enum import Enum


# ============================================================================
# Enums — used for validation and documentation
# ============================================================================

class SessionStatus(str, Enum):
    """
    Pipeline status for a session. Progresses linearly:
    draft / pending → generating_tests → executing → analyzing → complete
    Can branch to dry_run_failed, dry_run_passed, or failed at any stage.
    """
    DRAFT = "draft"
    PENDING = "pending"
    DRY_RUN_FAILED = "dry_run_failed"
    DRY_RUN_PASSED = "dry_run_passed"
    GENERATING_TESTS = "generating_tests"
    EXECUTING = "executing"
    ANALYZING = "analyzing"
    COMPLETE = "complete"
    FAILED = "failed"


class Language(str, Enum):
    """Supported programming languages for code submission."""
    PYTHON = "python"
    CPP = "cpp"
    JAVA = "java"
    JAVASCRIPT = "javascript"


class Verdict(str, Enum):
    """AI verdict on the submitted code."""
    OPTIMAL = "optimal"
    NEEDS_IMPROVEMENT = "needs_improvement"
    INCORRECT = "incorrect"


class Difficulty(str, Enum):
    """Problem difficulty levels."""
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


# ============================================================================
# Evaluation Profile Schemas
# ============================================================================

class EvaluationProfileCreate(BaseModel):
    """
    Schema for creating a new evaluation profile (from the slider UI).
    
    Validates that all 6 weights sum to exactly 1.0 (with ±0.01 tolerance
    for floating-point rounding from the slider UI).
    """
    name: str = Field(..., min_length=1, max_length=100, description="Profile name")
    correctness_weight: float = Field(0.40, ge=0.0, le=1.0)
    performance_weight: float = Field(0.20, ge=0.0, le=1.0)
    optimization_weight: float = Field(0.15, ge=0.0, le=1.0)
    quality_weight: float = Field(0.15, ge=0.0, le=1.0)
    readability_weight: float = Field(0.05, ge=0.0, le=1.0)
    documentation_weight: float = Field(0.05, ge=0.0, le=1.0)

    @field_validator("documentation_weight")
    @classmethod
    def weights_must_sum_to_one(cls, v, info):
        """
        Validate that all weights sum to 1.0 (±0.01 tolerance for float rounding).
        This runs after all fields are parsed, using documentation_weight as the trigger
        since it's the last weight field in the model.
        """
        data = info.data
        total = (
            data.get("correctness_weight", 0) +
            data.get("performance_weight", 0) +
            data.get("optimization_weight", 0) +
            data.get("quality_weight", 0) +
            data.get("readability_weight", 0) +
            v  # documentation_weight
        )
        if abs(total - 1.0) > 0.01:
            raise ValueError(
                f"Weights must sum to 1.0 (got {total:.4f}). "
                f"Adjust your sliders so the total equals 100%."
            )
        return v


class EvaluationProfileResponse(BaseModel):
    """Response schema for a single evaluation profile."""
    profile_id: int
    name: str
    is_default: bool
    correctness_weight: float
    performance_weight: float
    optimization_weight: float
    quality_weight: float
    readability_weight: float
    documentation_weight: float
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Problem Schemas
# ============================================================================

class ProblemCreate(BaseModel):
    """Schema for creating a new problem statement."""
    title: str = Field(..., min_length=1, max_length=255, description="Problem title")
    description: str = Field(..., min_length=1, description="Full problem statement")
    difficulty: Difficulty = Field(Difficulty.MEDIUM, description="Difficulty level")


class ProblemResponse(BaseModel):
    """Response schema for a single problem."""
    problem_id: int
    title: str
    description: str
    difficulty: str
    created_at: datetime
    session_count: Optional[int] = 0  # Number of submissions for this problem
    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Session Schemas
# ============================================================================

class SessionCreate(BaseModel):
    """
    Schema for creating a new session (from the New Session modal).
    
    The user picks a language, writes a problem statement (which creates
    a Problem if needed), enters a submission label, and selects a profile.
    """
    language: Language = Field(..., description="Programming language")
    submission_label: str = Field(..., min_length=1, max_length=255,
                                  description="Label for this submission (e.g., candidate name)")
    profile_id: Optional[int] = Field(None, description="Evaluation profile ID (uses default if not set)")
    code: str = Field("", description="Initial code (can be empty, filled later)")


class UserTestCaseInput(BaseModel):
    """User-provided test case with stdin and expected stdout."""
    test_id: Optional[int] = None
    test_case_id: Optional[str] = None
    description: Optional[str] = None
    stdin: str = ""
    expected_stdout: Optional[str] = ""
    is_edge_case: bool = False


class SessionSubmit(BaseModel):
    """
    Schema for submitting code for evaluation or running test cases.
    """
    code: str = Field(..., min_length=1, description="The source code to evaluate")
    language: Optional[str] = Field(None, description="Optional language override (python, cpp, java, javascript)")
    stdin: Optional[str] = Field(None, description="Optional stdin input for test execution")
    test_cases: Optional[List[UserTestCaseInput]] = Field(None, description="User-provided test cases to execute")


class TestResultDetail(BaseModel):
    """Combined test case + execution result for display in the UI."""
    test_case_id: Optional[str] = None
    description: Optional[str] = None
    stdin: str
    expected_stdout: str
    actual_stdout: Optional[str] = None
    passed: bool
    is_edge_case: bool
    time_ms: Optional[float] = None
    stderr: Optional[str] = None


class RunTestsResponse(BaseModel):
    """Response schema for running multiple test cases."""
    passed: bool
    total: int
    passed_count: int
    failed_count: int
    results: List[TestResultDetail]
    time_ms: float = 0.0
    error_line: Optional[int] = None
    stderr: Optional[str] = None


class DryRunResultResponse(BaseModel):
    """Response schema for a dry-run or test execution result."""
    dry_run_id: Optional[int] = None
    passed: bool
    stdout: Optional[str] = None
    stderr: Optional[str] = None
    error_line: Optional[int] = None
    time_ms: Optional[float] = None
    test_results: Optional[List[TestResultDetail]] = None
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class TestCaseResponse(BaseModel):
    """Response schema for a generated test case."""
    test_id: int
    test_case_id: Optional[str] = None
    description: Optional[str] = None
    stdin: str
    expected_stdout: str
    is_edge_case: bool
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ExecutionResultResponse(BaseModel):
    """Response schema for a single test execution result."""
    exec_id: int
    test_id: int
    passed: bool
    actual_stdout: Optional[str] = None
    stderr: Optional[str] = None
    time_ms: Optional[float] = None
    model_config = ConfigDict(from_attributes=True)


class FailingCaseDetail(BaseModel):
    """Detail about a failing test case from AI analysis."""
    id: str
    why_it_fails: str
    fix_suggestion: str


class QualityIssue(BaseModel):
    """A code quality issue identified by AI analysis."""
    issue: str
    severity: str  # low / medium / high
    suggestion: str


class AnalysisResultResponse(BaseModel):
    """Response schema for the complete AI analysis + scores."""
    analysis_id: int
    verdict: Optional[str] = None
    correctness_summary: Optional[str] = None
    failing_cases: Optional[List[FailingCaseDetail]] = None
    time_complexity: Optional[str] = None
    space_complexity: Optional[str] = None
    is_optimal: Optional[bool] = None
    optimal_time: Optional[str] = None
    optimal_space: Optional[str] = None
    complexity_chart: Optional[dict] = None
    optimization_suggestions: Optional[List[str]] = None
    code_explanation: Optional[str] = None
    quality_issues: Optional[List[QualityIssue]] = None
    final_notes: Optional[str] = None
    # Deterministic scores
    correctness_score: Optional[int] = None
    performance_score: Optional[int] = None
    optimization_score: Optional[int] = None
    quality_score: Optional[int] = None
    readability_score: Optional[int] = None
    documentation_score: Optional[int] = None
    final_score: Optional[int] = None
    evaluated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class SessionResponse(BaseModel):
    """
    Full session response with all related data (for reopening from sidebar).
    
    Includes the problem, profile, latest dry-run, test cases with execution
    results, and analysis (if complete).
    """
    session_id: int
    problem_id: int
    profile_id: Optional[int] = None
    submission_label: str
    language: str
    code: str
    status: str
    history_summary: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # Nested related data
    problem: Optional[ProblemResponse] = None
    profile: Optional[EvaluationProfileResponse] = None
    dry_run: Optional[DryRunResultResponse] = None
    test_results: Optional[List[TestResultDetail]] = None
    analysis: Optional[AnalysisResultResponse] = None
    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Leaderboard Schemas
# ============================================================================

class LeaderboardEntry(BaseModel):
    """A single row in the leaderboard table."""
    rank: int
    session_id: int
    submission_label: str
    language: str
    final_score: Optional[int] = None
    correctness_score: Optional[int] = None
    performance_score: Optional[int] = None
    profile_name: Optional[str] = None
    verdict: Optional[str] = None
    created_at: datetime


class LeaderboardResponse(BaseModel):
    """Full leaderboard for a problem."""
    problem_id: int
    problem_title: str
    entries: List[LeaderboardEntry]
    total_submissions: int


# ============================================================================
# Gemini AI Response Schemas (internal, for parsing AI output)
# ============================================================================

class GeminiTestCase(BaseModel):
    """A single test case from the Gemini 'first' response."""
    id: str = "tc_1"
    description: Optional[str] = ""
    stdin: str = ""
    expected_stdout: str = ""
    edge_case: bool = False
    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="before")
    @classmethod
    def map_aliases(cls, data):
        if isinstance(data, dict):
            # Map input aliases
            if "stdin" not in data or data["stdin"] is None or data["stdin"] == "":
                data["stdin"] = data.get("input", data.get("test_input", data.get("stdin_input", "")))
            # Map output aliases
            if "expected_stdout" not in data or data["expected_stdout"] is None or data["expected_stdout"] == "":
                data["expected_stdout"] = data.get("output", data.get("expected_output", data.get("expected", data.get("stdout", ""))))
            # Map edge case aliases
            if "edge_case" not in data:
                data["edge_case"] = data.get("is_edge_case", False)
            # Map id aliases
            if "id" not in data or not data["id"]:
                data["id"] = str(data.get("test_id", data.get("test_case_id", "tc_1")))

            # Normalize values to string
            for key in ("stdin", "expected_stdout"):
                val = data.get(key)
                if isinstance(val, (int, float, bool)):
                    data[key] = str(val)
                elif isinstance(val, (list, tuple)):
                    data[key] = " ".join(str(x) for x in val)
                elif val is None:
                    data[key] = ""
                else:
                    data[key] = str(val)
        return data


class GeminiFirstResponse(BaseModel):
    """Parsed response from Gemini 'first' call (test generation)."""
    response_type: str = "first"
    problem_understanding: str = ""
    clarifications_needed: List[str] = []
    test_cases: List[GeminiTestCase] = []
    notes: str = ""
    model_config = ConfigDict(extra="ignore")


class GeminiComplexity(BaseModel):
    """Complexity analysis from the Gemini 'second' response."""
    time: str = "O(N)"
    space: str = "O(1)"
    is_optimal: bool = True
    optimal_time: str = "O(N)"
    optimal_space: str = "O(1)"
    model_config = ConfigDict(extra="ignore")


class GeminiChartDataset(BaseModel):
    """A single dataset in the complexity chart."""
    label: str = "Solution"
    values: List[float] = []
    model_config = ConfigDict(extra="ignore")


class GeminiChart(BaseModel):
    """Chart data from the Gemini 'second' response."""
    type: str = "bar"
    labels: List[str] = []
    datasets: List[GeminiChartDataset] = []
    model_config = ConfigDict(extra="ignore")


class GeminiFailingCase(BaseModel):
    """Detail about a failing test case from AI analysis."""
    id: str = "tc_1"
    why_it_fails: str = ""
    fix_suggestion: str = ""
    model_config = ConfigDict(extra="ignore")


class GeminiQualityIssue(BaseModel):
    """A code quality issue from AI analysis."""
    issue: str = ""
    severity: str = "low"
    suggestion: str = ""
    model_config = ConfigDict(extra="ignore")


class GeminiSecondResponse(BaseModel):
    """Parsed response from Gemini 'second' call (analysis)."""
    response_type: str = "second"
    verdict: str = "optimal"
    correctness_summary: str = ""
    failing_cases: List[GeminiFailingCase] = []
    complexity: GeminiComplexity = GeminiComplexity()
    complexity_chart: GeminiChart = GeminiChart()
    optimization_suggestions: List[str] = []
    code_explanation: str = ""
    quality_score: int = 80
    readability_score: int = 80
    documentation_score: int = 80
    quality_issues: List[GeminiQualityIssue] = []
    final_notes: str = ""
    model_config = ConfigDict(extra="ignore")

    @field_validator("quality_score", "readability_score", "documentation_score", mode="before")
    @classmethod
    def clamp_score(cls, v):
        try:
            val = int(round(float(v)))
            return max(0, min(100, val))
        except (ValueError, TypeError):
            return 80


# ============================================================================
# Recommendation & Direct Evaluation Schemas
# ============================================================================

class AlternativeApproach(BaseModel):
    """An alternative algorithmic approach description."""
    name: str
    time_complexity: str
    space_complexity: str
    trade_offs: str


class RecommendationRequest(BaseModel):
    """Request payload for Solution Recommendation module."""
    problem: str = Field(..., min_length=1, description="Programming problem description")
    constraints: Optional[str] = Field(None, description="Optional problem constraints")
    sample_input: Optional[str] = Field(None, description="Optional sample input")
    sample_output: Optional[str] = Field(None, description="Optional sample output")
    preferred_language: Optional[str] = Field(None, description="Preferred programming language (None = auto-select best language)")


class RecommendationResponse(BaseModel):
    """Structured response payload for Solution Recommendation module."""
    id: Optional[int] = None
    category: str
    recommended_algorithm: str
    recommended_data_structure: str
    recommended_language: str
    time_complexity: str
    space_complexity: str
    optimized_code: str
    explanation: str
    alternative_approaches: List[AlternativeApproach] = []
    timestamp: Optional[datetime] = None


class EvaluationRequest(BaseModel):
    """Direct request payload for Solution Evaluation module."""
    problem: str = Field(..., min_length=1, description="Problem title or description")
    language: str = Field(..., min_length=1, description="Programming language (python, cpp, java)")
    user_code: str = Field(..., min_length=1, description="Source code implementation")
    submission_label: Optional[str] = Field("Solution Evaluation", description="Label for submission")
    profile_id: Optional[int] = Field(None, description="Evaluation profile ID")


class HistoryItemSummary(BaseModel):
    """Summary representation of a history record."""
    id: str
    raw_id: int
    module: str
    title: str
    problem: str
    category: Optional[str] = None
    algorithm: Optional[str] = None
    language: Optional[str] = None
    complexity: Optional[str] = None
    verdict: Optional[str] = None
    final_score: Optional[int] = None
    timestamp: Optional[str] = None


class HistoryListResponse(BaseModel):
    """List response for platform history."""
    items: List[HistoryItemSummary]


class PlatformStatsResponse(BaseModel):
    """Aggregated platform statistics for dashboard and overview."""
    total_problems: int = 0
    total_sessions: int = 0
    total_evaluations: int = 0
    total_recommendations: int = 0
    completed_evaluations: int = 0
    average_score: float = 0.0
    language_breakdown: dict = {}

