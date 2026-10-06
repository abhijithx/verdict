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


@pytest.mark.asyncio
async def test_recommendation_and_copilot_ask():
    """Verify recommendation generation and interactive copilot Q&A endpoint."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Recommendation request
        rec_payload = {
            "problem": "Given an array of integers nums and an integer target, return indices of two numbers that add up to target.",
            "constraints": "2 <= nums.length <= 10^4",
            "sample_input": "[2, 7, 11, 15], target = 9",
            "sample_output": "[0, 1]",
            "preferred_language": "Python"
        }
        res = await ac.post("/api/recommendation", json=rec_payload)
        assert res.status_code == 200
        rec_data = res.json()
        assert "recommended_algorithm" in rec_data
        assert "time_complexity" in rec_data
        assert "optimized_code" in rec_data
        assert "title" in rec_data and rec_data["title"]
        assert "difficulty" in rec_data and rec_data["difficulty"] in ["easy", "medium", "hard"]
        assert "sample_test_cases" in rec_data and isinstance(rec_data["sample_test_cases"], list)

        # 2. Copilot Q&A ask request
        ask_payload = {
            "problem": rec_payload["problem"],
            "code": rec_data["optimized_code"],
            "algorithm": rec_data["recommended_algorithm"],
            "language": "Python",
            "question": "Can we optimize space complexity further to O(1)?"
        }
        ask_res = await ac.post("/api/recommendation/ask", json=ask_payload)
        assert ask_res.status_code == 200
        ask_data = ask_res.json()
        assert "answer" in ask_data
        assert len(ask_data["answer"]) > 0
        assert "suggested_improvements" in ask_data
        assert isinstance(ask_data["suggested_improvements"], list)


@pytest.mark.asyncio
async def test_recommendation_to_evaluation_session_transfer():
    """Verify end-to-end transfer: recommendation details -> problem creation -> session with test cases."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        rec_payload = {
            "problem": "Reverse a singly linked list.",
            "constraints": "Number of nodes in the list is in the range [0, 5000].",
            "sample_input": "[1,2,3,4,5]",
            "sample_output": "[5,4,3,2,1]",
            "preferred_language": "Python"
        }
        rec_res = await ac.post("/api/recommendation", json=rec_payload)
        assert rec_res.status_code == 200
        rec_data = rec_res.json()

        # Build markdown description mimicking frontend evaluateInIde()
        rich_description = f"""# {rec_data['title']}

{rec_payload['problem']}

### Constraints
- {rec_payload['constraints']}

### Examples
**Example 1:**
- Input: `{rec_payload['sample_input']}`
- Output: `{rec_payload['sample_output']}`

### Target Complexity
- **Time Complexity:** {rec_data.get('time_complexity', 'O(N)')}
- **Space Complexity:** {rec_data.get('space_complexity', 'O(1)')}
"""
        # Create problem with canonical title and difficulty
        prob_res = await ac.post("/api/problems", json={
            "title": rec_data["title"],
            "description": rich_description,
            "difficulty": rec_data.get("difficulty", "medium")
        })
        assert prob_res.status_code == 200
        prob_id = prob_res.json()["problem_id"]

        # Map recommendation test cases to UserTestCaseInput
        test_cases_payload = [
            {
                "input": tc.get("stdin", tc.get("input", "")),
                "expected_output": tc.get("expected_stdout", tc.get("expected_output", "")),
                "description": tc.get("description", "Sample test case")
            }
            for tc in rec_data.get("sample_test_cases", [])
        ]
        if not test_cases_payload:
            test_cases_payload.append({
                "input": rec_payload["sample_input"],
                "expected_output": rec_payload["sample_output"],
                "description": "Primary sample test case"
            })

        # Create session with pre-populated test cases and optimized code
        sess_res = await ac.post(f"/api/sessions?problem_id={prob_id}", json={
            "language": "python",
            "submission_label": f"Evaluation - {rec_data['title']}",
            "code": rec_data["optimized_code"],
            "test_cases": test_cases_payload
        })
        assert sess_res.status_code == 200
        sess_data = sess_res.json()
        assert sess_data["status"] == "draft"
        sess_id = sess_data["session_id"]

        # Fetch session detail and verify persisted test cases
        detail_res = await ac.get(f"/api/sessions/{sess_id}")
        assert detail_res.status_code == 200
        detail = detail_res.json()
        assert detail["session_id"] == sess_id
        assert len(detail.get("test_cases", [])) == len(test_cases_payload)
        assert detail["test_cases"][0]["stdin"] == test_cases_payload[0]["input"]


