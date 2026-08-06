"""
routers/sessions.py — Session management and submission endpoints.

This router handles the core user workflow:
  1. Create a new session (from the New Session modal)
  2. Submit code for evaluation (triggers the full pipeline)
  3. Retrieve session details (for polling progress and reopening)

The submit endpoint launches the pipeline as a background task and returns
immediately. The frontend polls GET /api/sessions/{id} every 1-2 seconds
to track progress through the pipeline stages.
"""

import asyncio
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from database import get_db
from models import (
    Session, Problem, EvaluationProfile, DryRunResult,
    GeneratedTestCase, ExecutionResult, AnalysisResult
)
from schemas import (
    SessionCreate, SessionSubmit, SessionResponse,
    DryRunResultResponse, TestResultDetail, AnalysisResultResponse,
    FailingCaseDetail, QualityIssue, ProblemResponse,
    EvaluationProfileResponse
)
from pipeline.orchestrator import run_pipeline

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=dict)
async def create_session(
    problem_id: int,
    session_data: SessionCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new session for a problem.
    
    Called when the user clicks "Create" in the New Session modal.
    Validates that the problem and profile exist, then creates the session
    with status "pending".
    
    Args:
        problem_id: ID of the problem to solve
        session_data: Language, submission label, profile ID, initial code
    
    Returns:
        dict: { session_id, status, message }
    """
    # Validate that the problem exists
    result = await db.execute(
        select(Problem).where(Problem.problem_id == problem_id)
    )
    problem = result.scalars().first()
    if not problem:
        raise HTTPException(status_code=404, detail=f"Problem {problem_id} not found")

    # Validate the evaluation profile if specified
    profile_id = session_data.profile_id
    if profile_id:
        prof_result = await db.execute(
            select(EvaluationProfile).where(
                EvaluationProfile.profile_id == profile_id
            )
        )
        if not prof_result.scalars().first():
            raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found")
    else:
        # Use the first default profile if none specified
        prof_result = await db.execute(
            select(EvaluationProfile).where(
                EvaluationProfile.is_default == True
            ).limit(1)
        )
        default_profile = prof_result.scalars().first()
        if default_profile:
            profile_id = default_profile.profile_id

    # Create the session
    new_session = Session(
        problem_id=problem_id,
        profile_id=profile_id,
        submission_label=session_data.submission_label,
        language=session_data.language,
        code=session_data.code or _get_boilerplate(session_data.language),
        status="pending",
    )
    db.add(new_session)
    await db.commit()
    await db.refresh(new_session)

    return {
        "session_id": new_session.session_id,
        "status": "pending",
        "message": "Session created successfully",
    }


@router.post("/{session_id}/submit", response_model=dict)
async def submit_session(
    session_id: int,
    submission: SessionSubmit,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Submit code for evaluation — triggers the full pipeline.
    
    Updates the session's code, then launches the pipeline as a background
    task. The pipeline runs: dry run → Gemini first → execute tests → 
    Gemini second → scoring engine.
    
    The endpoint returns immediately with the session ID. The frontend
    should poll GET /api/sessions/{id} to track progress.
    
    Args:
        session_id: ID of the session to submit
        submission: The source code to evaluate
    
    Returns:
        dict: { session_id, status, message }
    """
    # Load the session
    result = await db.execute(
        select(Session).where(Session.session_id == session_id)
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    # Don't allow re-submission while pipeline is running
    active_statuses = {"generating_tests", "executing", "analyzing"}
    if session.status in active_statuses:
        raise HTTPException(
            status_code=409,
            detail=f"Session is currently {session.status}. Wait for completion."
        )

    # For resubmissions: if session already has analysis, compress history
    if session.status == "complete":
        # Load prior analysis for history compression
        analysis_result = await db.execute(
            select(AnalysisResult).where(AnalysisResult.session_id == session_id)
        )
        prior_analysis = analysis_result.scalars().first()

        if prior_analysis:
            from pipeline.history_compressor import compress_history
            # Build summary from prior analysis
            problem_result = await db.execute(
                select(Problem).where(Problem.problem_id == session.problem_id)
            )
            problem = problem_result.scalars().first()

            prior_data = {
                "verdict": prior_analysis.verdict,
                "time_complexity": prior_analysis.time_complexity,
                "space_complexity": prior_analysis.space_complexity,
                "correctness_summary": prior_analysis.correctness_summary,
                "optimization_suggestions": prior_analysis.optimization_suggestions_json or [],
            }
            session.history_summary = compress_history(
                problem.description if problem else "", prior_data
            )

            # Clean up old results for this session (new submission = new results)
            await db.execute(
                select(AnalysisResult).where(AnalysisResult.session_id == session_id)
            )
            # Delete old analysis, test cases, execution results
            from sqlalchemy import delete
            await db.execute(delete(AnalysisResult).where(AnalysisResult.session_id == session_id))
            await db.execute(delete(ExecutionResult).where(ExecutionResult.session_id == session_id))
            await db.execute(delete(GeneratedTestCase).where(GeneratedTestCase.session_id == session_id))
            await db.execute(delete(DryRunResult).where(DryRunResult.session_id == session_id))

    # Update the session with new code and reset status
    session.code = submission.code
    session.status = "pending"
    await db.commit()

    # Launch the pipeline as a background task
    # This runs asynchronously — the endpoint returns immediately
    background_tasks.add_task(run_pipeline, session_id)

    return {
        "session_id": session_id,
        "status": "pending",
        "message": "Pipeline started. Poll GET /api/sessions/{id} for progress.",
    }


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Get full session details including all related data.
    
    Used for:
      - Frontend polling during pipeline execution (checking status)
      - Reopening a completed session from the sidebar
      - Displaying results after pipeline completion
    
    Returns the session with nested: problem, profile, latest dry-run,
    test results (test case + execution result combined), and analysis.
    """
    # Load session
    result = await db.execute(
        select(Session).where(Session.session_id == session_id)
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    # Load related problem
    prob_result = await db.execute(
        select(Problem).where(Problem.problem_id == session.problem_id)
    )
    problem = prob_result.scalars().first()

    # Load related profile
    profile = None
    if session.profile_id:
        prof_result = await db.execute(
            select(EvaluationProfile).where(
                EvaluationProfile.profile_id == session.profile_id
            )
        )
        profile = prof_result.scalars().first()

    # Load latest dry-run result
    dry_run_result = await db.execute(
        select(DryRunResult)
        .where(DryRunResult.session_id == session_id)
        .order_by(DryRunResult.created_at.desc())
        .limit(1)
    )
    dry_run = dry_run_result.scalars().first()

    # Load test cases and execution results
    tc_result = await db.execute(
        select(GeneratedTestCase).where(GeneratedTestCase.session_id == session_id)
    )
    test_cases = tc_result.scalars().all()

    er_result = await db.execute(
        select(ExecutionResult).where(ExecutionResult.session_id == session_id)
    )
    exec_results = er_result.scalars().all()

    # Combine test cases with execution results for the frontend
    exec_map = {er.test_id: er for er in exec_results}
    test_result_details = []
    for tc in test_cases:
        er = exec_map.get(tc.test_id)
        test_result_details.append(TestResultDetail(
            test_case_id=tc.test_case_id,
            description=tc.description,
            stdin=tc.stdin,
            expected_stdout=tc.expected_stdout,
            actual_stdout=er.actual_stdout if er else None,
            passed=er.passed if er else False,
            is_edge_case=tc.is_edge_case,
            time_ms=er.time_ms if er else None,
            stderr=er.stderr if er else None,
        ))

    # Load analysis result
    analysis_result = await db.execute(
        select(AnalysisResult).where(AnalysisResult.session_id == session_id)
    )
    analysis = analysis_result.scalars().first()

    # Build the analysis response if analysis exists
    analysis_response = None
    if analysis:
        analysis_response = AnalysisResultResponse(
            analysis_id=analysis.analysis_id,
            verdict=analysis.verdict,
            correctness_summary=analysis.correctness_summary,
            failing_cases=[FailingCaseDetail(**fc) for fc in (analysis.failing_cases_json or [])],
            time_complexity=analysis.time_complexity,
            space_complexity=analysis.space_complexity,
            is_optimal=analysis.is_optimal,
            optimal_time=analysis.optimal_time,
            optimal_space=analysis.optimal_space,
            complexity_chart=analysis.complexity_chart_json,
            optimization_suggestions=analysis.optimization_suggestions_json,
            code_explanation=analysis.code_explanation,
            quality_issues=[QualityIssue(**qi) for qi in (analysis.quality_issues_json or [])],
            final_notes=analysis.final_notes,
            correctness_score=analysis.correctness_score,
            performance_score=analysis.performance_score,
            optimization_score=analysis.optimization_score,
            quality_score=analysis.quality_score,
            readability_score=analysis.readability_score,
            documentation_score=analysis.documentation_score,
            final_score=analysis.final_score,
            evaluated_at=analysis.evaluated_at,
        )

    # Build the full response
    return SessionResponse(
        session_id=session.session_id,
        problem_id=session.problem_id,
        profile_id=session.profile_id,
        submission_label=session.submission_label,
        language=session.language,
        code=session.code,
        status=session.status,
        history_summary=session.history_summary,
        created_at=session.created_at,
        updated_at=session.updated_at,
        problem=ProblemResponse(
            problem_id=problem.problem_id,
            title=problem.title,
            description=problem.description,
            difficulty=problem.difficulty,
            created_at=problem.created_at,
        ) if problem else None,
        profile=EvaluationProfileResponse(
            profile_id=profile.profile_id,
            name=profile.name,
            is_default=profile.is_default,
            correctness_weight=profile.correctness_weight,
            performance_weight=profile.performance_weight,
            optimization_weight=profile.optimization_weight,
            quality_weight=profile.quality_weight,
            readability_weight=profile.readability_weight,
            documentation_weight=profile.documentation_weight,
            created_at=profile.created_at,
        ) if profile else None,
        dry_run=DryRunResultResponse(
            dry_run_id=dry_run.dry_run_id,
            passed=dry_run.passed,
            stdout=dry_run.stdout,
            stderr=dry_run.stderr,
            error_line=dry_run.error_line,
            created_at=dry_run.created_at,
        ) if dry_run else None,
        test_results=test_result_details if test_result_details else None,
        analysis=analysis_response,
    )


@router.get("", response_model=list)
async def list_sessions(
    problem_id: int = None,
    db: AsyncSession = Depends(get_db)
):
    """
    List all sessions, optionally filtered by problem_id.
    
    Used for the sidebar session list. Returns basic session info
    without all the nested detail data.
    """
    query = select(Session).order_by(Session.created_at.desc())
    if problem_id:
        query = query.where(Session.problem_id == problem_id)

    result = await db.execute(query)
    sessions = result.scalars().all()

    return [
        {
            "session_id": s.session_id,
            "problem_id": s.problem_id,
            "submission_label": s.submission_label,
            "language": s.language,
            "status": s.status,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        }
        for s in sessions
    ]


def _get_boilerplate(language: str) -> str:
    """
    Return language-specific boilerplate code for new sessions.
    
    Gives users a starting template with the basic I/O setup
    for each supported language.
    """
    boilerplates = {
        "python": '# Read input and write output\n# Example: n = int(input())\n\n',
        "cpp": '#include <iostream>\nusing namespace std;\n\nint main() {\n    // Read input and write output\n    // Example: int n; cin >> n;\n    \n    return 0;\n}\n',
        "java": 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        // Read input and write output\n        // Example: int n = sc.nextInt();\n        \n    }\n}\n',
    }
    return boilerplates.get(language, "")
