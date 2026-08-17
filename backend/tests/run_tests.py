"""
run_tests.py — Standalone test runner for Verdict AI Platform using standard library unittest and asyncio.
"""

import unittest
import asyncio
import sys
import os

# Ensure backend root is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from scoring_engine.scorer import derive_signals, compute_final_score
from pipeline.error_parser import parse_error_line, extract_error_message


class TestScoringEngine(unittest.TestCase):
    def test_deterministic_scoring(self):
        """Test scoring calculations and signal derivations."""
        profile = {
            "correctness_weight": 0.40,
            "performance_weight": 0.20,
            "optimization_weight": 0.15,
            "quality_weight": 0.10,
            "readability_weight": 0.10,
            "documentation_weight": 0.05,
        }

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

        self.assertEqual(signals["correctness_score"], 100)
        self.assertGreaterEqual(signals["performance_score"], 80)
        self.assertEqual(signals["optimization_score"], 100)

        final_score = compute_final_score(profile, signals)
        self.assertIsInstance(final_score, int)
        self.assertTrue(0 <= final_score <= 100)
        print(f"[TEST PASS] Scoring Engine: derived score={final_score}/100")


class TestErrorParser(unittest.TestCase):
    def test_python_traceback(self):
        py_tb = """Traceback (most recent call last):
  File "main.py", line 14, in <module>
    result = 10 / 0
ZeroDivisionError: division by zero"""
        self.assertEqual(parse_error_line(py_tb, "python"), 14)
        self.assertIn("division by zero", extract_error_message(py_tb, "python").lower())
        print("[TEST PASS] Python Error Parser")

    def test_cpp_compiler_error(self):
        cpp_err = "main.cpp:25:5: error: 'cout' was not declared in this scope"
        self.assertEqual(parse_error_line(cpp_err, "cpp"), 25)
        print("[TEST PASS] C++ Error Parser")

    def test_java_compiler_error(self):
        java_err = "Main.java:8: error: cannot find symbol"
        self.assertEqual(parse_error_line(java_err, "java"), 8)
        print("[TEST PASS] Java Error Parser")


class TestAsyncAPIs(unittest.TestCase):
    def test_api_endpoints(self):
        async def _run():
            from httpx import AsyncClient, ASGITransport
            from main import app

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                # 1. Stats
                stats_res = await ac.get("/api/problems/stats")
                self.assertEqual(stats_res.status_code, 200)
                stats_data = stats_res.json()
                self.assertIn("total_problems", stats_data)
                self.assertIn("average_score", stats_data)
                print(f"[TEST PASS] API /api/problems/stats (total problems: {stats_data['total_problems']})")

                # 2. Problem creation
                import uuid
                rand_id = uuid.uuid4().hex[:6]
                prob_res = await ac.post("/api/problems", json={
                    "title": f"Automated Unit Test Problem {rand_id}",
                    "description": "Calculate sum of array",
                    "difficulty": "easy"
                })
                self.assertEqual(prob_res.status_code, 200)
                prob_id = prob_res.json()["problem_id"]
                print(f"[TEST PASS] API POST /api/problems (created problem ID: {prob_id})")

                # 3. Profile validation
                valid_prof = await ac.post("/api/evaluation-profiles", json={
                    "name": f"Unit Test Custom Profile {rand_id}",
                    "correctness_weight": 0.40,
                    "performance_weight": 0.20,
                    "optimization_weight": 0.15,
                    "quality_weight": 0.10,
                    "readability_weight": 0.10,
                    "documentation_weight": 0.05
                })
                self.assertEqual(valid_prof.status_code, 200)

                invalid_prof = await ac.post("/api/evaluation-profiles", json={
                    "name": "Invalid Sum Profile",
                    "correctness_weight": 0.30,
                    "performance_weight": 0.10,
                    "optimization_weight": 0.10,
                    "quality_weight": 0.10,
                    "readability_weight": 0.05,
                    "documentation_weight": 0.05
                })
                self.assertEqual(invalid_prof.status_code, 422)
                print("[TEST PASS] API POST /api/evaluation-profiles (sum validation strictly enforced)")

                # 4. Session Creation & Dry Run
                sess_res = await ac.post(f"/api/sessions?problem_id={prob_id}", json={
                    "language": "python",
                    "submission_label": "Unit Test Candidate",
                    "code": "print('Verdict test OK')"
                })
                self.assertEqual(sess_res.status_code, 200)
                sess_data = sess_res.json()
                self.assertEqual(sess_data["status"], "draft")
                sess_id = sess_data["session_id"]
                print(f"[TEST PASS] API POST /api/sessions (created draft session ID: {sess_id})")

                # 5. Dry Run
                dry_res = await ac.post(f"/api/sessions/{sess_id}/dry-run", json={
                    "code": "print('Verdict test OK')"
                })
                self.assertEqual(dry_res.status_code, 200)
                self.assertTrue(dry_res.json()["passed"])
                print(f"[TEST PASS] API POST /api/sessions/{sess_id}/dry-run (passed)")

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
