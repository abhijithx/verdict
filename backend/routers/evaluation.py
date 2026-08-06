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
        problem = Problem(
            title=request.problem[:255],
            description=request.problem,
            difficulty="medium"
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

    # Trigger background evaluation pipeline
    background_tasks.add_task(run_pipeline, session.session_id)

    return {
        "session_id": session.session_id,
        "status": "pending",
        "message": "Evaluation pipeline started. Check progress via GET /api/sessions/{session_id}",
    }
