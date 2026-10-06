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
    EvaluationProfileResponse, RunTestsResponse
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
        status="draft",
    )
    db.add(new_session)
    await db.commit()
    await db.refresh(new_session)

    return {
        "session_id": new_session.session_id,
        "status": "draft",
        "message": "Session created successfully",
    }


@router.post("/{session_id}/dry-run", response_model=DryRunResultResponse)
async def dry_run_session(
    session_id: int,
    submission: SessionSubmit,
    db: AsyncSession = Depends(get_db)
):
    """
    Runs ONLY the compile/runtime dry-run check via Piston — no Gemini calls,
    no test generation, no scoring. Updates session.code and status='dry_run_failed'
    or 'dry_run_passed' accordingly. Does NOT invoke run_pipeline.
    """
    result = await db.execute(
        select(Session).where(Session.session_id == session_id)
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    in_flight_statuses = {"generating_tests", "executing", "analyzing"}
    if session.status in in_flight_statuses:
        raise HTTPException(
            status_code=409,
            detail=f"Session pipeline is currently running ({session.status}). Wait for completion."
        )

    session.code = submission.code
    if submission.language:
        session.language = submission.language.lower()

    from pipeline.code_runner import code_runner
    from pipeline.error_parser import parse_error_line

    # 1. If user provided multiple test cases, execute all of them in batch
    if submission.test_cases and len(submission.test_cases) > 0:
        test_case_objs = []
        for idx, tc in enumerate(submission.test_cases):
            tc_id = tc.test_id or (idx + 1)
            test_case_objs.append(type('TC', (), {
                'test_id': tc_id,
                'test_case_id': tc.test_case_id or f"Case {idx + 1}",
                'description': tc.description or f"User Case {idx + 1}",
                'stdin': tc.stdin or "",
                'expected_stdout': tc.expected_stdout or "",
                'is_edge_case': tc.is_edge_case
            })())

        exec_results = await code_runner.run_all_tests(
            code=submission.code,
            language=session.language,
            test_cases=test_case_objs,
            timeout_ms=5000
        )

        test_result_details = []
        all_passed = True
        total_time = 0.0
        first_err_line = None
        combined_stderr = []
        stdout_parts = []

        for tc_obj, er in zip(test_case_objs, exec_results):
            if not er.passed:
                all_passed = False
            total_time += (er.time_ms or 0.0)
            if er.stderr:
                combined_stderr.append(er.stderr)
                if not first_err_line:
                    first_err_line = parse_error_line(er.stderr, session.language)
            if er.actual_stdout:
                stdout_parts.append(er.actual_stdout)

            test_result_details.append(TestResultDetail(
                test_case_id=tc_obj.test_case_id,
                description=tc_obj.description,
                stdin=tc_obj.stdin,
                expected_stdout=tc_obj.expected_stdout,
                actual_stdout=er.actual_stdout,
                passed=er.passed,
                is_edge_case=tc_obj.is_edge_case,
                time_ms=er.time_ms,
                stderr=er.stderr
            ))

        passed = all_passed
        time_ms = total_time
        stderr = "\n".join(combined_stderr) if combined_stderr else None
        stdout = "\n".join(stdout_parts) if stdout_parts else None
        error_line = first_err_line

    # 2. Single stdin run
    elif submission.stdin is not None and submission.stdin != "":
        exec_res = await code_runner.execute(
            submission.code,
            session.language,
            stdin=submission.stdin,
            timeout_seconds=5.0
        )
        rc = exec_res.get("run", {}).get("code", 0)
        stdout = exec_res.get("stdout", "")
        stderr = exec_res.get("stderr", "")
        time_ms = exec_res.get("time_ms", 0.0)
        passed = (rc == 0)
        error_line = parse_error_line(stderr, session.language) if (stderr and rc != 0) else None
        test_result_details = [
            TestResultDetail(
                test_case_id="Case 1",
                description="Custom Input Run",
                stdin=submission.stdin,
                expected_stdout="",
                actual_stdout=stdout,
                passed=passed,
                is_edge_case=False,
                time_ms=time_ms,
                stderr=stderr
            )
        ]
    # 3. Empty stdin pre-flight check
    else:
        dry_run_output = await code_runner.dry_run(submission.code, session.language)
        passed = dry_run_output.passed
        stdout = dry_run_output.stdout
        stderr = dry_run_output.stderr
        time_ms = 0.0
        error_line = dry_run_output.error_line or (parse_error_line(stderr, session.language) if (stderr and not passed) else None)
        test_result_details = None

    dry_run_record = DryRunResult(
        session_id=session_id,
        passed=passed,
        stdout=stdout,
        stderr=stderr,
        error_line=error_line
    )
    db.add(dry_run_record)

    session.status = "dry_run_passed" if passed else "dry_run_failed"
    await db.commit()
    await db.refresh(dry_run_record)

    return DryRunResultResponse(
        dry_run_id=dry_run_record.dry_run_id,
        passed=dry_run_record.passed,
        stdout=dry_run_record.stdout,
        stderr=dry_run_record.stderr,
        error_line=dry_run_record.error_line,
        time_ms=time_ms,
        test_results=test_result_details,
        created_at=dry_run_record.created_at
    )


@router.post("/{session_id}/run-tests", response_model=RunTestsResponse)
async def run_session_tests(
    session_id: int,
    submission: SessionSubmit,
    db: AsyncSession = Depends(get_db)
):
    """
    Execute user-provided test cases against the session's code in batch.
    Returns structured pass/fail results for each test case.
    """
    result = await db.execute(
        select(Session).where(Session.session_id == session_id)
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    session.code = submission.code
    if submission.language:
        session.language = submission.language.lower()
    from pipeline.code_runner import code_runner
    from pipeline.error_parser import parse_error_line

    raw_cases = submission.test_cases or []
    if not raw_cases:
        if submission.stdin is not None:
            raw_cases = [type('UserTestCaseInput', (), {'test_id': 1, 'test_case_id': 'Case 1', 'description': 'Custom Input', 'stdin': submission.stdin, 'expected_stdout': '', 'is_edge_case': False})()]
        else:
            raw_cases = [type('UserTestCaseInput', (), {'test_id': 1, 'test_case_id': 'Case 1', 'description': 'Default Input', 'stdin': '', 'expected_stdout': '', 'is_edge_case': False})()]

    test_case_objs = [
        type('TC', (), {
            'test_id': getattr(tc, 'test_id', None) or (idx + 1),
            'test_case_id': getattr(tc, 'test_case_id', None) or f"Case {idx + 1}",
            'description': getattr(tc, 'description', None) or f"Case {idx + 1}",
            'stdin': getattr(tc, 'stdin', "") or "",
            'expected_stdout': getattr(tc, 'expected_stdout', "") or "",
            'is_edge_case': getattr(tc, 'is_edge_case', False)
        })()
        for idx, tc in enumerate(raw_cases)
    ]

    exec_results = await code_runner.run_all_tests(
        code=submission.code,
        language=session.language,
        test_cases=test_case_objs,
        timeout_ms=5000
    )

    test_result_details = []
    passed_count = 0
    total_time = 0.0
    first_err_line = None
    all_stderr = []

    for tc_obj, er in zip(test_case_objs, exec_results):
        if er.passed:
            passed_count += 1
        total_time += (er.time_ms or 0.0)
        if er.stderr:
            all_stderr.append(er.stderr)
            if not first_err_line:
                first_err_line = parse_error_line(er.stderr, session.language)

        test_result_details.append(TestResultDetail(
            test_case_id=tc_obj.test_case_id,
            description=tc_obj.description,
            stdin=tc_obj.stdin,
            expected_stdout=tc_obj.expected_stdout,
            actual_stdout=er.actual_stdout,
            passed=er.passed,
            is_edge_case=tc_obj.is_edge_case,
            time_ms=er.time_ms,
            stderr=er.stderr
        ))

    total = len(test_case_objs)
    all_passed = (passed_count == total)

    return RunTestsResponse(
        passed=all_passed,
        total=total,
        passed_count=passed_count,
        failed_count=total - passed_count,
        results=test_result_details,
        time_ms=total_time,
        error_line=first_err_line,
        stderr="\n".join(all_stderr) if all_stderr else None
    )


from services.rate_limiter import check_ai_rate_limit


@router.post("/{session_id}/submit", response_model=dict, dependencies=[Depends(check_ai_rate_limit)])
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

    # Atomic check & update: don't allow re-submission while in-flight pipeline steps are actively running
    in_flight_statuses = ["generating_tests", "executing", "analyzing"]
    from sqlalchemy import update
    res = await db.execute(
        update(Session)
        .where(
            Session.session_id == session_id,
            Session.status.notin_(in_flight_statuses)
        )
        .values(status="pending")
    )
    if res.rowcount == 0:
        raise HTTPException(
            status_code=409,
            detail=f"Session is busy or currently running ({session.status}). Wait for completion."
        )

    # Refresh session so in-memory object matches DB after atomic update
    await db.refresh(session)

    # For resubmissions: compress prior analysis into history summary
    analysis_result = await db.execute(
        select(AnalysisResult).where(AnalysisResult.session_id == session_id)
    )
    prior_analysis = analysis_result.scalars().first()

    if prior_analysis:
        from pipeline.history_compressor import compress_history
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

    # Always clean up old results before resubmission (not just for "complete")
    from sqlalchemy import delete
    await db.execute(delete(AnalysisResult).where(AnalysisResult.session_id == session_id))
    await db.execute(delete(ExecutionResult).where(ExecutionResult.session_id == session_id))
    await db.execute(delete(GeneratedTestCase).where(GeneratedTestCase.session_id == session_id))
    await db.execute(delete(DryRunResult).where(DryRunResult.session_id == session_id))

    # Persist user-provided test cases if supplied
    if submission.test_cases and len(submission.test_cases) > 0:
        for idx, tc in enumerate(submission.test_cases):
            db_tc = GeneratedTestCase(
                session_id=session_id,
                test_case_id=tc.test_case_id or f"Case {idx + 1}",
                description=tc.description or f"User Case {idx + 1}",
                stdin=tc.stdin if tc.stdin is not None else "",
                expected_stdout=tc.expected_stdout if tc.expected_stdout is not None else "",
                is_edge_case=tc.is_edge_case,
            )
            db.add(db_tc)

    # Update the session with new code and reset status
    session.code = submission.code
    if submission.language:
        session.language = submission.language.lower()
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
            failing_cases=[FailingCaseDetail.model_validate(fc) for fc in (analysis.failing_cases_json or [])],
            time_complexity=analysis.time_complexity,
            space_complexity=analysis.space_complexity,
            is_optimal=analysis.is_optimal,
            optimal_time=analysis.optimal_time,
            optimal_space=analysis.optimal_space,
            complexity_chart=analysis.complexity_chart_json,
            optimization_suggestions=analysis.optimization_suggestions_json,
            code_explanation=analysis.code_explanation,
            quality_issues=[QualityIssue.model_validate(qi) for qi in (analysis.quality_issues_json or [])],
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


@router.delete("/{session_id}", response_model=dict)
async def delete_session(session_id: int, db: AsyncSession = Depends(get_db)):
    """
    Delete a session and all its associated data (dry-run, test cases, execution results, analysis).
    """
    from services.history_service import history_service
    success = await history_service.delete_history_item(db, f"eval_{session_id}")
    if not success:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    return {"message": f"Session {session_id} successfully deleted", "session_id": session_id}



def _get_boilerplate(language: str) -> str:
    """
    Return language-specific boilerplate code for new sessions.
    
    Gives users a starting template with the basic I/O setup
    for each supported language.
    """
    boilerplates = {
        "python": '# Read input and write output\n# Example: import sys; lines = sys.stdin.read().split()\n\n',
        "cpp": '#include <iostream>\nusing namespace std;\n\nint main() {\n    // Read input and write output\n    // Example: int n; cin >> n;\n    \n    return 0;\n}\n',
        "java": 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        // Read input and write output\n        // Example: int n = sc.nextInt();\n        \n    }\n}\n',
        "javascript": '// Read input and write output\nconst fs = require("fs");\nconst input = fs.readFileSync(0, "utf-8").trim();\n\n',
    }
    return boilerplates.get(language, "")
