"""
main.py — FastAPI application entry point for CodeScore AI.

This is the central module that:
  1. Creates the FastAPI application instance
  2. Configures CORS middleware (allows all origins for development)
  3. Registers all API routers (problems, sessions, evaluation profiles)
  4. Initializes the database and seeds default data on startup
  5. Serves the frontend static files
  6. Provides a session PDF export endpoint

Run with: uvicorn main:app --reload --port 8000
Then open: http://localhost:8000 (serves the frontend)
API docs: http://localhost:8000/docs (Swagger UI)
"""

import io
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import init_db, get_db, AsyncSessionLocal
from seed_data import run_seeds
from routers import sessions, problems, evaluation_profiles, recommendation, evaluation, history, leetcode
from models import Session, AnalysisResult, GeneratedTestCase, ExecutionResult, Problem


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan handler — runs on startup and shutdown.
    
    Startup:
      - Creates all database tables (if not existing)
      - Seeds default evaluation profiles and sample problems
    
    Shutdown:
      - Cleanup resources
    """
    # === STARTUP ===
    print("[STARTUP] Initializing database...")
    await init_db()
    
    # Seed default data using a fresh database session
    async with AsyncSessionLocal() as db:
        await run_seeds(db)
    
    print("[STARTUP] OK - Verdict AI Platform ready!")
    print("[STARTUP] Native Code Execution Engine: Active (Python 3, C++ 17, Java 17, JS)")
    print("[STARTUP] Frontend: http://localhost:8000")
    print("[STARTUP] API Docs: http://localhost:8000/docs")
    
    yield  # Application runs here
    
    # === SHUTDOWN ===
    print("[SHUTDOWN] Cleanup complete")


# Create the FastAPI application
app = FastAPI(
    title="Verdict AI Platform",
    description=(
        "AI-powered programming analysis platform supporting Solution Recommendation "
        "and Solution Evaluation with verified code execution."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

# Configure CORS — allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # Allow all origins (dev only)
    allow_credentials=True,
    allow_methods=["*"],          # Allow all HTTP methods
    allow_headers=["*"],          # Allow all headers
)


@app.middleware("http")
async def add_security_headers(request, call_next):
    """Attach standard security headers to all responses."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response


# Register API routers
app.include_router(problems.router)              # /api/problems/*
app.include_router(sessions.router)              # /api/sessions/*
app.include_router(evaluation_profiles.router)    # /api/evaluation-profiles/*
app.include_router(recommendation.router)         # /api/recommendation
app.include_router(evaluation.router)             # /api/evaluation
app.include_router(history.router)                # /api/history
app.include_router(leetcode.router)               # /api/leetcode/*


@app.get("/api/health")
async def health_check():
    """Health check endpoint for platform monitoring."""
    return {"status": "ok", "version": "2.0.0"}



# ============================================================================
# Session PDF Export endpoint
# ============================================================================

@app.get("/api/sessions/{session_id}/export")
async def export_session_pdf(session_id: int, db: AsyncSession = Depends(get_db)):
    """
    Export a session's analysis report as a PDF.
    
    Generates a detailed PDF containing:
      - Problem statement
      - Code submitted
      - Test case results (pass/fail table)
      - AI analysis (verdict, complexity, suggestions)
      - Score breakdown
    """
    # Load session and related data
    result = await db.execute(
        select(Session).where(Session.session_id == session_id)
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.status != "complete":
        raise HTTPException(status_code=400, detail="Session not yet complete")

    # Load problem
    prob_result = await db.execute(
        select(Problem).where(Problem.problem_id == session.problem_id)
    )
    problem = prob_result.scalars().first()

    # Load analysis
    analysis_result = await db.execute(
        select(AnalysisResult).where(AnalysisResult.session_id == session_id)
    )
    analysis = analysis_result.scalars().first()

    # Load test results
    tc_result = await db.execute(
        select(GeneratedTestCase).where(GeneratedTestCase.session_id == session_id)
    )
    test_cases = tc_result.scalars().all()

    er_result = await db.execute(
        select(ExecutionResult).where(ExecutionResult.session_id == session_id)
    )
    exec_results = er_result.scalars().all()
    exec_map = {er.test_id: er for er in exec_results}

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.platypus import (
            SimpleDocTemplate, Table, TableStyle,
            Paragraph, Spacer, Preformatted
        )
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
    except ImportError:
        raise HTTPException(status_code=500, detail="reportlab not installed")

    # Generate PDF
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4)
    styles = getSampleStyleSheet()
    elements = []

    # Custom styles
    code_style = ParagraphStyle(
        'CodeStyle', parent=styles['Code'],
        fontSize=7, leading=9,
        fontName='Courier'
    )

    import html

    def _safe_text(t: str) -> str:
        return html.escape(str(t or "")).replace("\n", "<br/>")

    # Title
    elements.append(Paragraph("Verdict AI — Session Report", styles['Title']))
    elements.append(Spacer(1, 10))

    # Session info
    elements.append(Paragraph(f"<b>Submission:</b> {_safe_text(session.submission_label)}", styles['Normal']))
    elements.append(Paragraph(f"<b>Language:</b> {_safe_text(session.language)}", styles['Normal']))
    elements.append(Paragraph(f"<b>Problem:</b> {_safe_text(problem.title if problem else 'N/A')}", styles['Normal']))
    if analysis:
        elements.append(Paragraph(f"<b>Verdict:</b> {_safe_text(analysis.verdict)}", styles['Normal']))
        elements.append(Paragraph(f"<b>Final Score:</b> {analysis.final_score}/100", styles['Normal']))
    elements.append(Spacer(1, 15))

    # Score breakdown table
    if analysis:
        elements.append(Paragraph("Score Breakdown", styles['Heading2']))
        score_data = [
            ["Dimension", "Score"],
            ["Correctness", str(analysis.correctness_score or 0)],
            ["Performance", str(analysis.performance_score or 0)],
            ["Optimization", str(analysis.optimization_score or 0)],
            ["Quality", str(analysis.quality_score or 0)],
            ["Readability", str(analysis.readability_score or 0)],
            ["Documentation", str(analysis.documentation_score or 0)],
            ["FINAL", str(analysis.final_score or 0)],
        ]
        score_table = Table(score_data, colWidths=[120, 60])
        score_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e1e2e')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('ALIGN', (1, 0), (1, -1), 'CENTER'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#e8e8e8')),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ]))
        elements.append(score_table)
        elements.append(Spacer(1, 15))

    # Test results table
    if test_cases:
        elements.append(Paragraph("Test Results", styles['Heading2']))
        test_data = [["#", "Description", "Result", "Time (ms)"]]
        for i, tc in enumerate(test_cases, 1):
            er = exec_map.get(tc.test_id)
            test_data.append([
                str(i),
                (tc.description or "Test case")[:40],
                "PASS" if (er and er.passed) else "FAIL",
                f"{er.time_ms:.0f}" if (er and er.time_ms) else "N/A",
            ])
        test_table = Table(test_data, colWidths=[30, 200, 60, 60])
        test_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e1e2e')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ]))
        elements.append(test_table)
        elements.append(Spacer(1, 15))

    # Complexity analysis
    if analysis:
        elements.append(Paragraph("Complexity Analysis", styles['Heading2']))
        elements.append(Paragraph(
            f"<b>Time:</b> {_safe_text(analysis.time_complexity or 'N/A')} | "
            f"<b>Space:</b> {_safe_text(analysis.space_complexity or 'N/A')} | "
            f"<b>Optimal:</b> {'Yes' if analysis.is_optimal else 'No'}",
            styles['Normal']
        ))
        if analysis.correctness_summary:
            elements.append(Spacer(1, 5))
            elements.append(Paragraph(_safe_text(analysis.correctness_summary), styles['Normal']))
        elements.append(Spacer(1, 15))

    # Code explanation
    if analysis and analysis.code_explanation:
        elements.append(Paragraph("Code Walkthrough", styles['Heading2']))
        elements.append(Paragraph(_safe_text(analysis.code_explanation), styles['Normal']))

    doc.build(elements)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=session_{session_id}_report.pdf"
        },
    )


# ============================================================================
# Frontend Static File Serving
# ============================================================================
import pathlib
BASE_DIR = pathlib.Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

if (FRONTEND_DIR / "js").exists():
    app.mount("/js", StaticFiles(directory=str(FRONTEND_DIR / "js")), name="js")
if (FRONTEND_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")


@app.get("/styles.css")
async def serve_css():
    """Serve the main CSS file."""
    return FileResponse(str(FRONTEND_DIR / "styles.css"), media_type="text/css")


@app.get("/")
async def serve_frontend():
    """Serve the main frontend HTML file."""
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/{path:path}")
async def serve_fallback(path: str):
    """
    Fallback route — serves index.html for client-side routing.
    This enables the SPA to handle its own routing (e.g., /leaderboard).
    """
    target = FRONTEND_DIR / path
    if target.is_file():
        return FileResponse(str(target))
    return FileResponse(str(FRONTEND_DIR / "index.html"))
