"""
routers/problems.py — Problem management and leaderboard endpoints.

Handles:
  - CRUD for problems (create, list, get by ID)
  - Leaderboard per problem (all sessions ranked by final score)
  - PDF export for leaderboard and individual sessions
"""

import io
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from database import get_db
from models import Problem, Session, AnalysisResult, EvaluationProfile, RecommendationHistory
from schemas import (
    ProblemCreate, ProblemResponse, LeaderboardEntry, LeaderboardResponse,
    PlatformStatsResponse
)

router = APIRouter(prefix="/api/problems", tags=["problems"])


@router.get("/stats", response_model=PlatformStatsResponse)
async def get_platform_stats(db: AsyncSession = Depends(get_db)):
    """
    Get aggregated platform statistics for dashboard & metrics overview.
    """
    # Total problems
    prob_res = await db.execute(select(func.count(Problem.problem_id)))
    total_problems = prob_res.scalar() or 0

    # Total sessions
    sess_res = await db.execute(select(func.count(Session.session_id)))
    total_sessions = sess_res.scalar() or 0

    # Total recommendations
    rec_res = await db.execute(select(func.count(RecommendationHistory.id)))
    total_recommendations = rec_res.scalar() or 0

    # Completed evaluations
    comp_res = await db.execute(
        select(func.count(Session.session_id)).where(Session.status == "complete")
    )
    completed_evaluations = comp_res.scalar() or 0

    # Average score
    score_res = await db.execute(
        select(func.avg(AnalysisResult.final_score)).where(AnalysisResult.final_score.isnot(None))
    )
    avg_score_raw = score_res.scalar()
    average_score = round(float(avg_score_raw), 1) if avg_score_raw is not None else 0.0

    # Language breakdown
    lang_res = await db.execute(
        select(Session.language, func.count(Session.session_id)).group_by(Session.language)
    )
    language_breakdown = {lang: count for lang, count in lang_res.all()}

    return PlatformStatsResponse(
        total_problems=total_problems,
        total_sessions=total_sessions,
        total_evaluations=total_sessions,
        total_recommendations=total_recommendations,
        completed_evaluations=completed_evaluations,
        average_score=average_score,
        language_breakdown=language_breakdown,
    )


@router.post("", response_model=ProblemResponse)
async def create_problem(
    problem_data: ProblemCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new problem.
    
    Called when a user enters a new problem statement in the New Session modal.
    The problem is stored so multiple sessions can reference the same problem
    (enabling the leaderboard feature).
    """
    new_problem = Problem(
        title=problem_data.title,
        description=problem_data.description,
        difficulty=problem_data.difficulty,
    )
    db.add(new_problem)
    await db.commit()
    await db.refresh(new_problem)

    return ProblemResponse(
        problem_id=new_problem.problem_id,
        title=new_problem.title,
        description=new_problem.description,
        difficulty=new_problem.difficulty,
        created_at=new_problem.created_at,
        session_count=0,
    )


@router.get("", response_model=list[ProblemResponse])
async def list_problems(db: AsyncSession = Depends(get_db)):
    """
    List all problems with session counts.
    
    Returns problems ordered by creation date (newest first),
    each with a count of how many sessions exist for it.
    """
    # Get all problems
    result = await db.execute(
        select(Problem).order_by(Problem.created_at.desc())
    )
    problems = result.scalars().all()

    # Get session counts per problem
    count_result = await db.execute(
        select(Session.problem_id, func.count(Session.session_id))
        .group_by(Session.problem_id)
    )
    session_counts = dict(count_result.all())

    return [
        ProblemResponse(
            problem_id=p.problem_id,
            title=p.title,
            description=p.description,
            difficulty=p.difficulty,
            created_at=p.created_at,
            session_count=session_counts.get(p.problem_id, 0),
        )
        for p in problems
    ]


@router.get("/{problem_id}", response_model=ProblemResponse)
async def get_problem(problem_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single problem by ID."""
    result = await db.execute(
        select(Problem).where(Problem.problem_id == problem_id)
    )
    problem = result.scalars().first()
    if not problem:
        raise HTTPException(status_code=404, detail=f"Problem {problem_id} not found")

    # Get session count
    count_result = await db.execute(
        select(func.count(Session.session_id))
        .where(Session.problem_id == problem_id)
    )
    session_count = count_result.scalar() or 0

    return ProblemResponse(
        problem_id=problem.problem_id,
        title=problem.title,
        description=problem.description,
        difficulty=problem.difficulty,
        created_at=problem.created_at,
        session_count=session_count,
    )


@router.get("/{problem_id}/leaderboard", response_model=LeaderboardResponse)
async def get_leaderboard(problem_id: int, db: AsyncSession = Depends(get_db)):
    """
    Get the leaderboard for a problem.
    
    Returns all completed sessions for the problem, ranked by final score
    (highest first). Each entry shows the submission label, language,
    score breakdown, and which evaluation profile was used.
    
    The profile badge is shown so scores computed under different profiles
    are visually distinguishable rather than silently compared as equivalent.
    """
    # Verify problem exists
    prob_result = await db.execute(
        select(Problem).where(Problem.problem_id == problem_id)
    )
    problem = prob_result.scalars().first()
    if not problem:
        raise HTTPException(status_code=404, detail=f"Problem {problem_id} not found")

    # Get all completed sessions with their analysis results
    sessions_result = await db.execute(
        select(Session)
        .where(Session.problem_id == problem_id)
        .where(Session.status == "complete")
        .order_by(Session.created_at.desc())
    )
    sessions = sessions_result.scalars().all()

    # Build leaderboard entries
    entries = []
    for session in sessions:
        # Load analysis for this session
        analysis_result = await db.execute(
            select(AnalysisResult).where(AnalysisResult.session_id == session.session_id)
        )
        analysis = analysis_result.scalars().first()

        # Load profile name
        profile_name = None
        if session.profile_id:
            prof_result = await db.execute(
                select(EvaluationProfile).where(
                    EvaluationProfile.profile_id == session.profile_id
                )
            )
            profile = prof_result.scalars().first()
            profile_name = profile.name if profile else None

        entries.append(LeaderboardEntry(
            rank=0,  # Will be set after sorting
            session_id=session.session_id,
            submission_label=session.submission_label,
            language=session.language,
            final_score=analysis.final_score if analysis else None,
            correctness_score=analysis.correctness_score if analysis else None,
            performance_score=analysis.performance_score if analysis else None,
            profile_name=profile_name,
            verdict=analysis.verdict if analysis else None,
            created_at=session.created_at,
        ))

    # Sort by final score (highest first), then by creation date
    entries.sort(key=lambda e: (e.final_score or 0, e.created_at.timestamp()), reverse=True)

    # Assign ranks
    for i, entry in enumerate(entries):
        entry.rank = i + 1

    return LeaderboardResponse(
        problem_id=problem_id,
        problem_title=problem.title,
        entries=entries,
        total_submissions=len(entries),
    )


@router.get("/{problem_id}/sessions", response_model=list)
async def get_problem_sessions(problem_id: int, db: AsyncSession = Depends(get_db)):
    """
    Get all sessions for a specific problem.
    Used by the sidebar to show sessions grouped by problem.
    """
    result = await db.execute(
        select(Session)
        .where(Session.problem_id == problem_id)
        .order_by(Session.created_at.desc())
    )
    sessions = result.scalars().all()

    return [
        {
            "session_id": s.session_id,
            "submission_label": s.submission_label,
            "language": s.language,
            "status": s.status,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in sessions
    ]


@router.get("/{problem_id}/export")
async def export_leaderboard_pdf(problem_id: int, db: AsyncSession = Depends(get_db)):
    """
    Export the leaderboard for a problem as a PDF.
    
    Generates a PDF report with the leaderboard table,
    showing all submissions ranked by final score.
    """
    # Get leaderboard data
    leaderboard = await get_leaderboard(problem_id, db)

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet
    except ImportError:
        raise HTTPException(status_code=500, detail="reportlab not installed. Run: pip install reportlab")

    # Generate PDF in memory
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4)
    styles = getSampleStyleSheet()
    elements = []

    import html
    # Title
    elements.append(Paragraph(f"Leaderboard: {html.escape(leaderboard.problem_title or '')}", styles['Title']))
    elements.append(Spacer(1, 20))
    elements.append(Paragraph(
        f"Total Submissions: {leaderboard.total_submissions}",
        styles['Normal']
    ))
    elements.append(Spacer(1, 20))

    # Table header
    table_data = [["Rank", "Submission", "Language", "Score", "Profile", "Verdict"]]

    # Table rows
    for entry in leaderboard.entries:
        table_data.append([
            str(entry.rank),
            entry.submission_label,
            entry.language,
            str(entry.final_score or "N/A"),
            entry.profile_name or "Default",
            entry.verdict or "N/A",
        ])

    # Style the table
    table = Table(table_data, colWidths=[40, 120, 60, 50, 80, 80])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e1e2e')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f8f8f8')),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f0f0f0')]),
    ]))
    elements.append(table)

    doc.build(elements)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=leaderboard_{problem_id}.pdf"
        },
    )
