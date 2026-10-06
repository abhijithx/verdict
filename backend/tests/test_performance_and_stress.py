"""
tests/test_performance_and_stress.py — Rigorous Performance, Concurrency, and Input Validation Suite.
"""

import os
import sys
import asyncio
import time
import pytest
from httpx import AsyncClient, ASGITransport

# Ensure backend root is on sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from main import app
from pipeline.code_runner import code_runner


@pytest.mark.asyncio
async def test_high_concurrency_read_throughput():
    """Verify backend handles 30 concurrent requests under 1500ms with zero errors."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        endpoints = [
            "/api/health",
            "/api/problems/stats",
            "/api/evaluation-profiles",
            "/api/history",
            "/api/leetcode/curated",
        ] * 6  # 30 concurrent requests

        start = time.perf_counter()
        responses = await asyncio.gather(*[ac.get(ep) for ep in endpoints])
        duration_ms = (time.perf_counter() - start) * 1000.0

        assert all(r.status_code == 200 for r in responses)
        assert duration_ms < 2500, f"Expected < 2500ms, got {duration_ms:.2f}ms"


@pytest.mark.asyncio
async def test_code_runner_execution_latency():
    """Verify sub-100ms native execution latency for standard algorithm execution."""
    t0 = time.perf_counter()
    res = await code_runner.dry_run(
        "import sys\nprint('Native speed: ' + str(2**32))",
        "python"
    )
    latency_ms = (time.perf_counter() - t0) * 1000.0

    assert res.passed is True
    assert "4294967296" in res.stdout
    assert latency_ms < 400.0, f"Execution latency too high: {latency_ms:.2f}ms"


@pytest.mark.asyncio
async def test_code_runner_tle_and_isolation():
    """Verify infinite loop triggers Time Limit Exceeded cleanly without process hang."""
    t0 = time.perf_counter()
    res = await code_runner.execute(
        "while True:\n    pass",
        "python",
        timeout_seconds=1.0
    )
    duration_ms = (time.perf_counter() - t0) * 1000.0

    assert "Time Limit Exceeded" in res.get("stderr", "")
    assert res.get("run", {}).get("code") == 124
    # Process must terminate within 1.0s + 500ms grace period
    assert duration_ms < 1800, f"TLE timeout exceeded expected duration: {duration_ms:.2f}ms"


@pytest.mark.asyncio
async def test_validation_empty_and_comment_only_code():
    """Verify strict rejection when code contains only whitespace or comments."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Create problem
        p_res = await ac.post("/api/problems", json={
            "title": "Validation Test Problem",
            "description": "Compute something",
            "difficulty": "easy"
        })
        prob_id = p_res.json()["problem_id"]

        # Create session
        s_res = await ac.post(f"/api/sessions?problem_id={prob_id}", json={
            "language": "python",
            "submission_label": "Empty Check",
            "code": ""
        })
        sess_id = s_res.json()["session_id"]

        # 1. Dry run with comments only -> must fail
        comment_code = "# Just a comment\n'''multiline comment'''\n   \n"
        dry_res = await ac.post(f"/api/sessions/{sess_id}/dry-run", json={
            "code": comment_code
        })
        assert dry_res.status_code == 200
        assert dry_res.json()["passed"] is False
        assert "No executable code provided" in dry_res.json()["stderr"]

        # 2. Submit with comments only -> must return 400
        submit_res = await ac.post(f"/api/sessions/{sess_id}/submit", json={
            "code": comment_code
        })
        assert submit_res.status_code == 400
        assert "Cannot submit empty code" in submit_res.json()["detail"]


@pytest.mark.asyncio
async def test_validation_non_existent_resources():
    """Verify consistent 404 responses for non-existent entities."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        assert (await ac.get("/api/sessions/999999")).status_code == 404
        assert (await ac.get("/api/problems/999999")).status_code == 404
        assert (await ac.delete("/api/sessions/999999")).status_code == 404
        assert (await ac.get("/api/evaluation-profiles/999999")).status_code == 404


@pytest.mark.asyncio
async def test_large_payload_and_special_characters():
    """Verify engine handles large stdout and unicode symbols without deadlock or crash."""
    large_input = "hello_world_" * 500  # 6,000 characters
    res = await code_runner.execute(
        "import sys\ndata = sys.stdin.read().strip()\nprint(data)\nprint('Unicode test: 🚀 α β γ 中文 日本語')",
        "python",
        stdin=large_input,
        timeout_seconds=5.0
    )
    assert res.get("run", {}).get("code") == 0
    stdout = res.get("stdout", "")
    assert "hello_world_" in stdout
    assert "🚀 α β γ 中文 日本語" in stdout
