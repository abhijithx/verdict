"""
routers/evaluation.py — Solution Evaluation API router.

Provides direct endpoints for code evaluation (POST /api/evaluation).
Preserves existing evaluation pipeline and works alongside /api/sessions endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import Problem, Session, EvaluationProfile
from schemas import EvaluationRequest
from pipeline.orchestrator import run_pipeline
from services.logger import get_logger

logger = get_logger("EvaluationRouter")

router = APIRouter(prefix="/api/evaluation", tags=["evaluation"])


@router.post("", response_model=dict)
async def evaluate_solution(
    request: EvaluationRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Direct code evaluation endpoint.
    
    Creates or reuses a Problem record, creates a Session, updates code,
    and triggers the full verification pipeline in background.
    """
    if not request.problem or not request.problem.strip():
        raise HTTPException(status_code=400, detail="Problem title/description required.")
    if not request.user_code or not request.user_code.strip():
        raise HTTPException(status_code=400, detail="User code cannot be empty.")

    # Check if a matching problem exists, or create a new one
    prob_stmt = select(Problem).where(Problem.title == request.problem[:255])
    prob_res = await db.execute(prob_stmt)
    problem = prob_res.scalars().first()

    if not problem:
        full_desc = request.problem
        if request.constraints or request.sample_input or request.sample_output:
            full_desc += "\n\n"
            if request.constraints:
                full_desc += f"### Constraints\n{request.constraints}\n\n"
            if request.sample_input or request.sample_output:
                full_desc += f"### Example\n- Input: `{request.sample_input or ''}`\n- Output: `{request.sample_output or ''}`\n\n"

        problem = Problem(
            title=request.problem[:255],
            description=full_desc,
            difficulty=(request.difficulty or "medium").lower()
        )
        db.add(problem)
        await db.commit()
        await db.refresh(problem)

    # Load default evaluation profile if profile_id not provided
    profile_id = request.profile_id
    if not profile_id:
        prof_res = await db.execute(
            select(EvaluationProfile).where(EvaluationProfile.is_default == True).limit(1)
        )
        def_prof = prof_res.scalars().first()
        if def_prof:
            profile_id = def_prof.profile_id

    # Create new session
    session = Session(
        problem_id=problem.problem_id,
        profile_id=profile_id,
        submission_label=request.submission_label or "Direct Evaluation",
        language=request.language.lower(),
        code=request.user_code,
        status="pending"
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Persist initial test cases if supplied
    from models import GeneratedTestCase
    if request.test_cases and len(request.test_cases) > 0:
        for idx, tc in enumerate(request.test_cases):
            db_tc = GeneratedTestCase(
                session_id=session.session_id,
                test_case_id=tc.test_case_id or f"Case {idx + 1}",
                description=tc.description or f"Sample Case {idx + 1}",
                stdin=tc.stdin if tc.stdin is not None else "",
                expected_stdout=tc.expected_stdout if tc.expected_stdout is not None else "",
                is_edge_case=tc.is_edge_case,
            )
            db.add(db_tc)
        await db.commit()
    elif request.sample_input or request.sample_output:
        db_tc = GeneratedTestCase(
            session_id=session.session_id,
            test_case_id="Case 1",
            description="Sample Case",
            stdin=request.sample_input or "",
            expected_stdout=request.sample_output or "",
            is_edge_case=False,
        )
        db.add(db_tc)
        await db.commit()

    # Trigger background evaluation pipeline
    background_tasks.add_task(run_pipeline, session.session_id)

    return {
        "session_id": session.session_id,
        "status": "pending",
        "message": "Evaluation pipeline started. Check progress via GET /api/sessions/{session_id}",
    }
