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
    PlatformStatsResponse, ProblemGenerateRequest, ProblemGenerateResponse,
    ProblemGenerateTestCase
)
from services.rate_limiter import check_ai_rate_limit

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
        code_snippets=problem_data.code_snippets,
    )
    db.add(new_problem)
    await db.commit()
    await db.refresh(new_problem)

    return ProblemResponse(
        problem_id=new_problem.problem_id,
        title=new_problem.title,
        description=new_problem.description,
        difficulty=new_problem.difficulty,
        code_snippets=new_problem.code_snippets,
        created_at=new_problem.created_at,
        session_count=0,
    )


@router.post("/generate", response_model=ProblemGenerateResponse, dependencies=[Depends(check_ai_rate_limit)])
async def generate_problem_with_ai(
    request: ProblemGenerateRequest
):
    """
    Generate an authentic LeetCode problem specification with multi-language starter templates
    (Python, C++, Java, JS), method signature, and public sample & private edge test cases.
    """
    prompt_text = request.prompt.strip()
    if not prompt_text:
        raise HTTPException(status_code=400, detail="Problem prompt cannot be empty.")

    from services.prompt_builder import PromptBuilder
    from services.ai_provider import call_ai
    from services.json_validator import JSONValidator
    import json

    ai_prompt = PromptBuilder.build_problem_generation_prompt(prompt_text, request.difficulty)
    parsed = None
    try:
        raw_response = await call_ai(
            system_instruction=PromptBuilder.PROBLEM_GENERATION_SYSTEM_INSTRUCTION,
            prompt=ai_prompt,
            temperature=0.3
        )
        cleaned = JSONValidator.clean_json_string(raw_response)
        parsed = json.loads(cleaned)
    except Exception as e:
        print(f"[AI GENERATE] AI provider exception ({e}), generating algorithmic fallback.")

    # High-quality fallback generator if AI returns non-conforming JSON or is offline
    if not parsed or not isinstance(parsed, dict) or "title" not in parsed:
        clean_title = prompt_text.replace("_", " ").strip().title()
        words = clean_title.split()
        method_name = "".join(w.lower() if i == 0 else w.capitalize() for i, w in enumerate(words)) or "solve"
        method_name = "".join(c for c in method_name if c.isalnum() or c == "_") or "solve"
        diff = (request.difficulty or "medium").lower()

        parsed = {
            "title": clean_title,
            "difficulty": diff,
            "description": (
                f"### {clean_title}\n\n"
                f"Given the problem constraints, implement an optimal solution for **{clean_title}**.\n\n"
                f"#### Example 1:\n"
                f"**Input:** `nums = [2, 7, 11, 15], target = 9`\n"
                f"**Output:** `[0, 1]`\n"
                f"**Explanation:** The numbers at indices 0 and 1 add up to 9.\n\n"
                f"#### Example 2:\n"
                f"**Input:** `nums = [3, 2, 4], target = 6`\n"
                f"**Output:** `[1, 2]`\n\n"
                f"#### Constraints:\n"
                f"- `1 <= nums.length <= 10^5`\n"
                f"- `-10^9 <= nums[i] <= 10^9`\n"
                f"- Exactly one valid solution exists.\n"
            ),
            "method_name": method_name,
            "code_snippets": {
                "python": f"class Solution:\n    def {method_name}(self, nums: list[int], target: int) -> list[int]:\n        # Implement your solution\n        pass\n",
                "cpp": f"#include <vector>\nusing namespace std;\n\nclass Solution {{\npublic:\n    vector<int> {method_name}(vector<int>& nums, int target) {{\n        // Implement your solution\n        return {{}};\n    }}\n}};\n",
                "java": f"import java.util.*;\n\nclass Solution {{\n    public int[] {method_name}(int[] nums, int target) {{\n        // Implement your solution\n        return new int[]{{}};\n    }}\n}}\n",
                "javascript": f"/**\n * @param {{number[]}} nums\n * @param {{number}} target\n * @return {{number[]}}\n */\nvar {method_name} = function(nums, target) {{\n    // Implement your solution\n    return [];\n}};\n"
            },
            "sample_test_cases": [
                {
                    "test_case_id": "Case 1",
                    "description": "Example 1",
                    "stdin": "nums = [2, 7, 11, 15], target = 9",
                    "expected_stdout": "[0, 1]",
                    "is_edge_case": False
                },
                {
                    "test_case_id": "Case 2",
                    "description": "Example 2",
                    "stdin": "nums = [3, 2, 4], target = 6",
                    "expected_stdout": "[1, 2]",
                    "is_edge_case": False
                },
                {
                    "test_case_id": "Case 3",
                    "description": "Edge Case - Minimal Input",
                    "stdin": "nums = [3, 3], target = 6",
                    "expected_stdout": "[0, 1]",
                    "is_edge_case": True
                }
            ]
        }

    # Ensure code_snippets contains all 4 languages with alias fallback
    snippets = (
        parsed.get("code_snippets")
        or parsed.get("starter_snippets")
        or parsed.get("starter_code")
        or parsed.get("templates")
        or {}
    )
    if not isinstance(snippets, dict):
        snippets = {}

    m_name = parsed.get("method_name") or "solve"
    if not snippets.get("python"):
        snippets["python"] = f"class Solution:\n    def {m_name}(self):\n        pass\n"
    if not snippets.get("cpp"):
        snippets["cpp"] = f"#include <vector>\nusing namespace std;\n\nclass Solution {{\npublic:\n    void {m_name}() {{\n    }}\n}};\n"
    if not snippets.get("java"):
        snippets["java"] = f"import java.util.*;\n\nclass Solution {{\n    public void {m_name}() {{\n    }}\n}}\n"
    if not snippets.get("javascript"):
        snippets["javascript"] = f"var {m_name} = function() {{\n}};\n"

    # Normalize test cases with alias fallbacks and public/private separation
    raw_cases = (
        parsed.get("sample_test_cases")
        or parsed.get("test_cases")
        or parsed.get("sample_cases")
        or parsed.get("examples")
        or parsed.get("cases")
        or []
    )
    if not raw_cases and ("public_test_cases" in parsed or "private_test_cases" in parsed):
        raw_cases = []
        for tc in parsed.get("public_test_cases", []):
            if isinstance(tc, dict):
                tc_copy = dict(tc)
                tc_copy["is_edge_case"] = False
                raw_cases.append(tc_copy)
        for tc in parsed.get("private_test_cases", []):
            if isinstance(tc, dict):
                tc_copy = dict(tc)
                tc_copy["is_edge_case"] = True
                raw_cases.append(tc_copy)

    tc_objects = []
    for i, tc in enumerate(raw_cases):
        if isinstance(tc, dict):
            stdin_val = tc.get("stdin") if tc.get("stdin") is not None else tc.get("input", "")
            stdout_val = (
                tc.get("expected_stdout")
                if tc.get("expected_stdout") is not None
                else tc.get("expected_output", tc.get("output", ""))
            )
            desc_val = tc.get("description") or (f"Edge Case {i+1}" if tc.get("is_edge_case") else f"Example {i+1}")
            tc_id = tc.get("test_case_id") or f"Case {i+1}"

            tc_objects.append(ProblemGenerateTestCase(
                test_case_id=str(tc_id),
                description=str(desc_val),
                stdin=str(stdin_val).strip(),
                expected_stdout=str(stdout_val).strip(),
                is_edge_case=bool(tc.get("is_edge_case", False))
            ))

    if not tc_objects:
        tc_objects.append(ProblemGenerateTestCase(
            test_case_id="Case 1",
            description="Default Sample",
            stdin="",
            expected_stdout="",
            is_edge_case=False
        ))

    return ProblemGenerateResponse(
        title=parsed.get("title") or prompt_text,
        difficulty=(parsed.get("difficulty") or request.difficulty or "medium").lower(),
        description=parsed.get("description") or f"Problem specification for {prompt_text}",
        method_name=m_name,
        code_snippets=snippets,
        sample_test_cases=tc_objects
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
            code_snippets=p.code_snippets,
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
        code_snippets=problem.code_snippets,
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
