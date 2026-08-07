"""
orchestrator.py — Main pipeline orchestrator for CodeScore AI.

This module runs the complete evaluation pipeline for a submission:
  1. Dry run (compile/runtime check via Piston)
  2. Gemini "first" call (generate test cases)
  3. Execute all test cases via Piston
  4. Gemini "second" call (analyze with real execution results)
  5. Scoring engine (deterministic weighted score computation)

The orchestrator updates the session status at each step so the frontend
can poll and show a progress indicator. If any step fails, the session
status is set to "failed" with error details.

This is designed to run as a FastAPI background task — the submit endpoint
returns immediately and the pipeline runs asynchronously.
"""

import traceback
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models import (
    Session, DryRunResult, GeneratedTestCase,
    ExecutionResult, AnalysisResult, EvaluationProfile
)
from pipeline.piston_client import piston_client
from pipeline.error_parser import parse_error_line, extract_error_message
from pipeline.gemini_first import generate_test_cases
from pipeline.gemini_second import analyze_code, _format_test_results_for_ai
from pipeline.history_compressor import (
    compress_history, build_test_summary, build_analysis_summary
)
from scoring_engine.scorer import derive_signals, compute_final_score
from database import AsyncSessionLocal


async def _update_status(db: AsyncSession, session_id: int, status: str):
    """
    Update the session's pipeline status in the database.
    
    Called at each step of the pipeline so the frontend can show
    progress (e.g., "Generating tests...", "Executing...", "Analyzing...").
    
    Args:
        db: Database session
        session_id: ID of the session to update
        status: New status string (see SessionStatus enum in schemas.py)
    """
    result = await db.execute(
        select(Session).where(Session.session_id == session_id)
    )
    session = result.scalars().first()
    if session:
        session.status = status
        await db.commit()
        print(f"[PIPELINE] Session {session_id} -> {status}")


async def run_pipeline(session_id: int):
    """
    Run the complete evaluation pipeline for a session.
    
    This is the main entry point, called as a background task from
    the submit endpoint. It manages its own database session since
    it runs outside the request lifecycle.
    
    Pipeline steps:
      1. Dry run → block if compile/runtime error
      2. Gemini "first" → generate test cases
      3. Piston execute → run all tests, record pass/fail
      4. Gemini "second" → analyze with real results
      5. Scoring engine → compute final weighted score
    
    Args:
        session_id: ID of the session to evaluate
    """
    # Create a new database session for this background task
    # (we can't reuse the request's session since it may be closed)
    async with AsyncSessionLocal() as db:
        try:
            # Load the session with its related problem
            result = await db.execute(
                select(Session).where(Session.session_id == session_id)
            )
            session = result.scalars().first()
            if not session:
                print(f"[PIPELINE] ERROR: Session {session_id} not found")
                return

            # Load the problem for the problem statement
            from models import Problem
            prob_result = await db.execute(
                select(Problem).where(Problem.problem_id == session.problem_id)
            )
            problem = prob_result.scalars().first()
            if not problem:
                await _update_status(db, session_id, "failed")
                return

            # ================================================================
            # STEP 1: Dry Run — compile/runtime check
            # ================================================================
            print(f"[PIPELINE] Step 1: Dry run for session {session_id}")
            dry_run_result = await piston_client.dry_run(session.code, session.language)

            # Save the dry run result to the database
            db_dry_run = DryRunResult(
                session_id=session_id,
                passed=dry_run_result.passed,
                stdout=dry_run_result.stdout,
                stderr=dry_run_result.stderr,
                error_line=dry_run_result.error_line,
            )
            db.add(db_dry_run)
            await db.commit()

            # If dry run failed, stop the pipeline — don't waste AI calls
            if not dry_run_result.passed:
                await _update_status(db, session_id, "dry_run_failed")
                print(f"[PIPELINE] Dry run failed for session {session_id}: {dry_run_result.stderr[:200].encode('ascii', 'replace').decode()}")
                return

            # ================================================================
            # STEP 2: Gemini "First" — generate test cases
            # ================================================================
            await _update_status(db, session_id, "generating_tests")
            print(f"[PIPELINE] Step 2: Generating test cases for session {session_id}")

            from pipeline.gemini_first import generate_test_cases, TestGenerationFailedError

            try:
                first_response = await generate_test_cases(
                    code=session.code,
                    language=session.language,
                    problem_statement=problem.description,
                    history_summary=session.history_summary,
                )
            except TestGenerationFailedError as e:
                session.history_summary = f"Pipeline halted: {str(e)}"
                await db.commit()
                await _update_status(db, session_id, "failed")
                print(f"[PIPELINE] Session {session_id} halted — test generation failed, no fallback test data used.")
                return

            # Save generated test cases to the database
            db_test_cases = []
            for tc in first_response.test_cases:
                db_tc = GeneratedTestCase(
                    session_id=session_id,
                    test_case_id=tc.id,
                    description=tc.description,
                    stdin=tc.stdin,
                    expected_stdout=tc.expected_stdout,
                    is_edge_case=tc.edge_case,
                )
                db.add(db_tc)
                db_test_cases.append(db_tc)
            
            await db.commit()
            # Refresh to get auto-generated test_id values
            for tc in db_test_cases:
                await db.refresh(tc)

            print(f"[PIPELINE] Generated {len(db_test_cases)} test cases")

            # ================================================================
            # STEP 3: Execute all test cases via Piston
            # ================================================================
            await _update_status(db, session_id, "executing")
            print(f"[PIPELINE] Step 3: Executing {len(db_test_cases)} test cases")

            exec_results = await piston_client.run_all_tests(
                code=session.code,
                language=session.language,
                test_cases=db_test_cases,
            )

            # Save execution results to the database
            db_exec_results = []
            for er in exec_results:
                db_er = ExecutionResult(
                    session_id=session_id,
                    test_id=er.test_id,
                    passed=er.passed,
                    actual_stdout=er.actual_stdout,
                    stderr=er.stderr,
                    time_ms=er.time_ms,
                )
                db.add(db_er)
                db_exec_results.append(db_er)
            
            await db.commit()

            passed_count = sum(1 for r in exec_results if r.passed)
            print(f"[PIPELINE] Tests: {passed_count}/{len(exec_results)} passed")

            # ================================================================
            # STEP 4: Gemini "Second" — analyze with real results
            # ================================================================
            await _update_status(db, session_id, "analyzing")
            print(f"[PIPELINE] Step 4: AI analysis for session {session_id}")

            second_response = await analyze_code(
                code=session.code,
                language=session.language,
                problem_statement=problem.description,
                test_cases=db_test_cases,
                exec_results=db_exec_results,
                history_summary=session.history_summary,
            )

            # ================================================================
            # STEP 5: Scoring Engine — deterministic score computation
            # ================================================================
            print(f"[PIPELINE] Step 5: Computing scores for session {session_id}")

            # Derive individual scoring signals from execution data + AI analysis
            signals = derive_signals(exec_results, second_response)

            # Load the evaluation profile for weighted scoring
            profile = None
            if session.profile_id:
                prof_result = await db.execute(
                    select(EvaluationProfile).where(
                        EvaluationProfile.profile_id == session.profile_id
                    )
                )
                profile = prof_result.scalars().first()

            # If no profile assigned, use the first default profile
            if not profile:
                prof_result = await db.execute(
                    select(EvaluationProfile).where(
                        EvaluationProfile.is_default == True
                    ).limit(1)
                )
                profile = prof_result.scalars().first()

            # Compute the final weighted score
            final_score = compute_final_score(profile, signals) if profile else 0

            # Save analysis + scores to the database
            db_analysis = AnalysisResult(
                session_id=session_id,
                verdict=second_response.verdict,
                correctness_summary=second_response.correctness_summary,
                failing_cases_json=[fc.model_dump() for fc in second_response.failing_cases],
                time_complexity=second_response.complexity.time,
                space_complexity=second_response.complexity.space,
                is_optimal=second_response.complexity.is_optimal,
                optimal_time=second_response.complexity.optimal_time,
                optimal_space=second_response.complexity.optimal_space,
                complexity_chart_json=second_response.complexity_chart.model_dump(),
                optimization_suggestions_json=second_response.optimization_suggestions,
                code_explanation=second_response.code_explanation,
                quality_issues_json=[qi.model_dump() for qi in second_response.quality_issues],
                final_notes=second_response.final_notes,
                # Deterministic scores from the scoring engine
                correctness_score=signals["correctness_score"],
                performance_score=signals["performance_score"],
                optimization_score=signals["optimization_score"],
                quality_score=signals["quality_score"],
                readability_score=signals["readability_score"],
                documentation_score=signals["documentation_score"],
                final_score=final_score,
            )
            db.add(db_analysis)

            # ================================================================
            # STEP 6: Update history summary for future resubmissions
            # ================================================================
            analysis_summary = {
                "verdict": second_response.verdict,
                "time_complexity": second_response.complexity.time,
                "space_complexity": second_response.complexity.space,
                "correctness_summary": second_response.correctness_summary,
                "optimization_suggestions": second_response.optimization_suggestions,
            }
            test_summary = {
                "total_tests": len(exec_results),
                "passed": passed_count,
                "failed": len(exec_results) - passed_count,
                "failing_test_ids": [
                    str(er.test_id) for er in exec_results if not er.passed
                ],
            }
            session.history_summary = compress_history(
                problem.description, analysis_summary, test_summary
            )

            # Mark session as complete
            await _update_status(db, session_id, "complete")
            await db.commit()

            print(f"[PIPELINE] OK - Session {session_id} complete! "
                  f"Final score: {final_score}/100 (verdict: {second_response.verdict})")

        except Exception as e:
            # Catch any unexpected errors and mark the session as failed
            error_msg = f"{type(e).__name__}: {str(e)}"
            print(f"[PIPELINE] ERROR in session {session_id}: {error_msg}")
            traceback.print_exc()

            try:
                await _update_status(db, session_id, "failed")
            except Exception:
                pass  # Don't let status update failure mask the original error
