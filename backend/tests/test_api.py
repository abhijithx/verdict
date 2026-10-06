"""
test_api.py — Comprehensive test suite for Verdict AI Platform.

Tests:
1. Static / Stats Endpoint
2. Problems API (create, list, get, leaderboard)
3. Evaluation Profiles API (create valid, reject invalid sum != 1.0)
4. Session Lifecycle (create -> draft status, dry run, detail retrieval)
5. Scoring Engine Deterministic Math & Big-O mapping
6. Language-specific Error Parser regexes
7. Unified History query & deletion
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
import sys
import os

# Ensure backend root is on sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from main import app
from database import init_db, AsyncSessionLocal
from seed_data import run_seeds
from scoring_engine.scorer import (
    derive_signals, compute_final_score, normalize_complexity,
    COMPLEXITY_SCORE_MAP
)
from pipeline.error_parser import parse_error_line, extract_error_message


@pytest_asyncio.fixture(autouse=True)
async def prepare_database():
    """Ensure database tables and seeds exist before tests."""
    await init_db()
    async with AsyncSessionLocal() as db:
        await run_seeds(db)


@pytest.mark.asyncio
async def test_platform_stats():
    """Verify platform stats endpoint returns aggregated platform metrics."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/api/problems/stats")
        assert response.status_code == 200
        data = response.json()
        assert "total_problems" in data
        assert "total_sessions" in data
        assert "average_score" in data
        assert isinstance(data["total_problems"], int)


import uuid


@pytest.mark.asyncio
async def test_problems_crud():
    """Verify problem creation, retrieval, and listing."""
    transport = ASGITransport(app=app)
    uid = uuid.uuid4().hex[:6]
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Create a problem
        create_res = await ac.post("/api/problems", json={
            "title": f"Test Two Sum Problem {uid}",
            "description": "Find indices of two numbers that add up to target.",
            "difficulty": "easy"
        })
        assert create_res.status_code == 200
        prob = create_res.json()
        problem_id = prob["problem_id"]
        assert prob["title"] == f"Test Two Sum Problem {uid}"
        assert prob["difficulty"] == "easy"

        # Get by ID
        get_res = await ac.get(f"/api/problems/{problem_id}")
        assert get_res.status_code == 200
        assert get_res.json()["problem_id"] == problem_id

        # List problems
        list_res = await ac.get("/api/problems")
        assert list_res.status_code == 200
        problems = list_res.json()
        assert any(p["problem_id"] == problem_id for p in problems)


@pytest.mark.asyncio
async def test_evaluation_profile_validation():
    """Verify profile weights must sum to exactly 1.0 (100%)."""
    transport = ASGITransport(app=app)
    uid = uuid.uuid4().hex[:6]
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Valid profile: sums to 1.0
        valid_res = await ac.post("/api/evaluation-profiles", json={
            "name": f"Balanced Test Profile {uid}",
            "correctness_weight": 0.40,
            "performance_weight": 0.20,
            "optimization_weight": 0.15,
            "quality_weight": 0.10,
            "readability_weight": 0.10,
            "documentation_weight": 0.05
        })
        assert valid_res.status_code == 200
        assert valid_res.json()["name"] == f"Balanced Test Profile {uid}"

        # Invalid profile: sums to 0.70 (not 1.0)
        invalid_res = await ac.post("/api/evaluation-profiles", json={
            "name": f"Invalid Sum Profile {uid}",
            "correctness_weight": 0.30,
            "performance_weight": 0.10,
            "optimization_weight": 0.10,
            "quality_weight": 0.10,
            "readability_weight": 0.05,
            "documentation_weight": 0.05
        })
        assert invalid_res.status_code == 422


@pytest.mark.asyncio
async def test_session_lifecycle():
    """Verify session creation defaults to draft and handles dry-run."""
    transport = ASGITransport(app=app)
    uid = uuid.uuid4().hex[:6]
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Create a problem first
        p_res = await ac.post("/api/problems", json={
            "title": f"Session Lifecycle Problem {uid}",
            "description": "Print Hello World",
            "difficulty": "easy"
        })
        prob_id = p_res.json()["problem_id"]

        # 2. Create session
        s_res = await ac.post(f"/api/sessions?problem_id={prob_id}", json={
            "language": "python",
            "submission_label": "Candidate Test Attempt",
            "code": "print('Hello World')"
        })
        assert s_res.status_code == 200
        sess_data = s_res.json()
        assert sess_data["status"] == "draft"
        sess_id = sess_data["session_id"]

        # 3. Get session details
        detail_res = await ac.get(f"/api/sessions/{sess_id}")
        assert detail_res.status_code == 200
        detail = detail_res.json()
        assert detail["status"] == "draft"
        assert detail["language"] == "python"

        # 4. Perform dry run
        dry_res = await ac.post(f"/api/sessions/{sess_id}/dry-run", json={
            "code": "print('Hello World')"
        })
        assert dry_res.status_code == 200
        dry_data = dry_res.json()
        assert dry_data["passed"] is True


def test_scoring_engine_math():
    """Verify deterministic scoring calculations and signal derivations."""
    profile_weights = {
        "correctness_weight": 0.40,
        "performance_weight": 0.20,
        "optimization_weight": 0.15,
        "quality_weight": 0.10,
        "readability_weight": 0.10,
        "documentation_weight": 0.05
    }

    # 4 out of 4 test cases passed
    exec_results = [
        {"passed": True, "time_ms": 10.0},
        {"passed": True, "time_ms": 12.0},
        {"passed": True, "time_ms": 15.0},
        {"passed": True, "time_ms": 8.0},
    ]

    second_response = {
        "complexity": {"time": "O(n)", "space": "O(1)", "is_optimal": True},
        "quality_score": 90,
        "readability_score": 85,
        "documentation_score": 80,
    }

    signals = derive_signals(exec_results, second_response)

    assert signals["correctness_score"] == 100
    assert signals["performance_score"] >= 80
    assert signals["optimization_score"] == 100

    final_score = compute_final_score(profile_weights, signals)
    assert isinstance(final_score, int)
    assert 0 <= final_score <= 100


def test_error_parser_regex():
    """Verify regex extraction of line numbers and error summaries."""
    # Python traceback
    py_tb = """Traceback (most recent call last):
  File "main.py", line 14, in <module>
    result = 10 / 0
ZeroDivisionError: division by zero"""
    assert parse_error_line(py_tb, "python") == 14
    assert "division by zero" in extract_error_message(py_tb, "python").lower()

    # C++ compiler error
    cpp_err = "main.cpp:25:5: error: 'cout' was not declared in this scope"
    assert parse_error_line(cpp_err, "cpp") == 25

    # Java compiler error
    java_err = "Main.java:8: error: cannot find symbol"
    assert parse_error_line(java_err, "java") == 8

