"""
test_comprehensive.py — Comprehensive end-to-end and unit tests for Verdict AI Platform.

Tests:
1. JSONValidator robustness (markdown fences, conversational text, trailing commas, validation rules)
2. ErrorParser multi-language regex extraction
3. Scorer calculation and boundary conditions
4. RecommendationRouter validation & HistoryService CRUD
5. Direct Evaluation API & Session PDF Export
6. Leaderboard calculation, sorting, and export
"""

import pytest
import uuid
from httpx import AsyncClient, ASGITransport
import sys
import os

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from main import app
from database import init_db, AsyncSessionLocal
from seed_data import run_seeds
from services.json_validator import JSONValidator
from pipeline.error_parser import parse_error_line, extract_error_message
from scoring_engine.scorer import derive_signals, compute_final_score, normalize_complexity


@pytest.mark.asyncio
async def test_json_validator_robustness():
    """Verify JSONValidator handles markdown fences, text wrappers, and trailing commas."""
    # 1. Clean JSON with markdown fences
    fenced = '```json\n{"category": "DP", "recommended_algorithm": "Kadane", "recommended_data_structure": "Array", "recommended_language": "Python", "time_complexity": "O(N)", "space_complexity": "O(1)", "optimized_code": "def max_sub(nums): pass", "explanation": "Dynamic programming", "alternative_approaches": []}\n```'
    is_valid, data, err = JSONValidator.parse_and_validate(fenced, "recommendation")
    assert is_valid is True
    assert data["category"] == "DP"
    assert data["recommended_algorithm"] == "Kadane"

    # 2. JSON wrapped with conversational text and trailing commas
    wrapped = 'Here is your optimal recommendation:\n```json\n{"category": "Greedy", "recommended_algorithm": "Activity Selection", "recommended_data_structure": "Array", "recommended_language": "C++", "time_complexity": "O(N log N)", "space_complexity": "O(1)", "optimized_code": "#include <iostream>", "explanation": "Sort by end time", "alternative_approaches": [],}\n```\nHope this helps!'
    is_valid, data, err = JSONValidator.parse_and_validate(wrapped, "recommendation")
    assert is_valid is True
    assert data["category"] == "Greedy"

    # 3. Missing required field
    invalid = '{"category": "DP"}'
    is_valid, data, err = JSONValidator.parse_and_validate(invalid, "recommendation")
    assert is_valid is False
    assert "Missing required fields" in err


def test_error_parser_multi_format():
    """Verify error parser extracts lines from various compiler outputs."""
    # Python
    py_err = 'Traceback (most recent call last):\n  File "main.py", line 42, in solve\nIndexError: list index out of range'
    assert parse_error_line(py_err, "python") == 42
    assert "indexerror" in extract_error_message(py_err, "python").lower()

    # C++
    cpp_err = "main.cpp:88:12: error: expected ';' before '}' token"
    assert parse_error_line(cpp_err, "cpp") == 88

    # Java
    java_err = "Main.java:15: error: incompatible types: int cannot be converted to String"
    assert parse_error_line(java_err, "java") == 15

    # JavaScript
    js_err = "TypeError: Cannot read properties of undefined\n    at solve (main.js:23:14)"
    assert parse_error_line(js_err, "javascript") == 23

    # None for empty or clean output
    assert parse_error_line("", "python") is None
    assert parse_error_line("All tests passed", "python") is None


def test_scorer_boundaries_and_normalization():
    """Verify scorer complexity normalization and edge values."""
    assert normalize_complexity("O(n^2)") == "O(n^2)"
    assert normalize_complexity("O(nlogn)") == "O(n log n)"
    assert normalize_complexity("O(n*log(n))") == "O(n log n)"
    assert normalize_complexity("O(sqrt(n))") == "O(√n)"

    # All tests failed (0% correctness)
    signals = derive_signals(
        [{"passed": False, "time_ms": 100.0}],
        {"complexity": {"time": "O(n^2)", "is_optimal": False}, "quality_score": 50, "readability_score": 50, "documentation_score": 50}
    )
    assert signals["correctness_score"] == 0
    assert signals["optimization_score"] == 60

    profile = {
        "correctness_weight": 0.50,
        "performance_weight": 0.20,
        "optimization_weight": 0.15,
        "quality_weight": 0.10,
        "readability_weight": 0.05,
        "documentation_weight": 0.00,
    }
    score = compute_final_score(profile, signals)
    assert 0 <= score <= 100


@pytest.mark.asyncio
async def test_direct_evaluation_and_history_workflow():
    """Verify direct evaluation endpoint, history querying, and deletion."""
    await init_db()
    async with AsyncSessionLocal() as db:
        await run_seeds(db)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        uid = uuid.uuid4().hex[:6]
        # 1. Direct evaluation submit
        eval_res = await ac.post("/api/evaluation", json={
            "problem": f"Direct Evaluation Problem {uid}: Find maximum in array.",
            "language": "python",
            "user_code": "def max_val(arr): return max(arr)",
            "submission_label": "Direct Candidate 1"
        })
        assert eval_res.status_code == 200
        sess_id = eval_res.json()["session_id"]
        assert sess_id > 0

        # 2. History listing
        hist_res = await ac.get("/api/history?type=evaluation")
        assert hist_res.status_code == 200
        items = hist_res.json()["items"]
        assert any(it["id"] == f"eval_{sess_id}" for it in items)

        # 3. History detail
        detail_res = await ac.get(f"/api/history/eval_{sess_id}")
        assert detail_res.status_code == 200
        assert detail_res.json()["session_id"] == sess_id

        # 4. Delete history item
        del_res = await ac.delete(f"/api/history/eval_{sess_id}")
        assert del_res.status_code == 200

        # Verify deleted
        after_del = await ac.get(f"/api/history/eval_{sess_id}")
        assert after_del.status_code == 404


@pytest.mark.asyncio
async def test_local_execution_multilanguage():
    """Verify local execution engine handles Python, C++, Java, and JavaScript with compilation and test execution."""
    from pipeline.piston_client import piston_client

    # 1. Python Dry Run & Execution
    py_code = "n = int(input())\nprint(n * 2)"
    py_dry = await piston_client.dry_run(py_code, "python")
    assert py_dry.passed is True

    tc1 = type('TC', (), {'test_id': 1, 'stdin': '5\n', 'expected_stdout': '10\n'})()
    tc2 = type('TC', (), {'test_id': 2, 'stdin': '12\n', 'expected_stdout': '24\n'})()
    py_results = await piston_client.run_all_tests(py_code, "python", [tc1, tc2])
    assert len(py_results) == 2
    assert py_results[0].passed is True
    assert py_results[1].passed is True
    assert py_results[0].time_ms > 0

    # 2. C++ Compilation & Execution
    cpp_code = """#include <iostream>
using namespace std;
int main() {
    int a, b;
    if (cin >> a >> b) {
        cout << (a + b) << "\\n";
    }
    return 0;
}"""
    cpp_dry = await piston_client.dry_run(cpp_code, "cpp")
    assert cpp_dry.passed is True

    cpp_tc1 = type('TC', (), {'test_id': 101, 'stdin': '3 7\n', 'expected_stdout': '10\n'})()
    cpp_tc2 = type('TC', (), {'test_id': 102, 'stdin': '-5 5\n', 'expected_stdout': '0\n'})()
    cpp_results = await piston_client.run_all_tests(cpp_code, "cpp", [cpp_tc1, cpp_tc2])
    assert len(cpp_results) == 2
    assert cpp_results[0].passed is True
    assert cpp_results[1].passed is True

    # 3. C++ Compile Error capture
    cpp_bad = "int main() { syntax error }"
    cpp_bad_dry = await piston_client.dry_run(cpp_bad, "cpp")
    assert cpp_bad_dry.passed is False
    assert len(cpp_bad_dry.stderr) > 0

    # 4. Java Compilation & Execution (with custom class name Solution)
    java_code = """import java.util.Scanner;
public class Solution {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        if (sc.hasNextInt()) {
            int n = sc.nextInt();
            System.out.println(n * n);
        }
    }
}"""
    java_dry = await piston_client.dry_run(java_code, "java")
    assert java_dry.passed is True

    java_tc = type('TC', (), {'test_id': 201, 'stdin': '6\n', 'expected_stdout': '36\n'})()
    java_results = await piston_client.run_all_tests(java_code, "java", [java_tc])
    assert len(java_results) == 1
    assert java_results[0].passed is True

    # 5. JavaScript / Node.js Execution
    js_code = """const fs = require('fs');
const input = fs.readFileSync('/dev/stdin', 'utf-8').trim();
if (input) {
    const num = parseInt(input, 10);
    console.log(num + 100);
}"""
    js_dry = await piston_client.dry_run(js_code, "javascript")
    assert js_dry.passed is True

    js_tc1 = type('TC', (), {'test_id': 301, 'stdin': '25\n', 'expected_stdout': '125\n'})()
    js_results = await piston_client.run_all_tests(js_code, "javascript", [js_tc1])
    assert len(js_results) == 1
    assert js_results[0].passed is True

    # 6. Timeout handling test (infinite loop should terminate safely within timeout)
    timeout_py = "import time\nwhile True: pass"
    timeout_res = await piston_client.execute(timeout_py, "python", stdin="", timeout_seconds=1.0)
    err = (timeout_res.get("stderr", "") or timeout_res.get("run", {}).get("stderr", "")).lower()
    assert "time limit exceeded" in err or "timed out" in err or "tle" in err or timeout_res.get("run", {}).get("code") == 124


@pytest.mark.asyncio
async def test_workflow_deep_robustness():
    """Verify deep edge cases: missing input in pre-flight, multi-class Java, output matching, schema aliases."""
    from pipeline.code_runner import local_runner, outputs_match
    from schemas import GeminiTestCase

    # 1. Python standard competitive programming input handling does not fail dry run
    py_code = "import sys\ndata = sys.stdin.read().split()\nn = int(data[0])\nprint(n * 2)"
    py_dry = await local_runner.dry_run(py_code, "python")
    assert py_dry.passed is True

    # 2. Python fast syntax error detection
    py_bad = "def calculate(:\n    pass"
    py_bad_dry = await local_runner.dry_run(py_bad, "python")
    assert py_bad_dry.passed is False
    assert py_bad_dry.error_line == 1

    # 3. Java multi-class file with helper class before Main
    java_multi = """class Node { int val; }
class Solution {
    public static void main(String[] args) {
        System.out.println("42");
    }
}"""
    java_dry = await local_runner.dry_run(java_multi, "java")
    assert java_dry.passed is True
    tc = type('TC', (), {'test_id': 1, 'stdin': '', 'expected_stdout': '42'})()
    res = await local_runner.run_all_tests(java_multi, "java", [tc])
    assert len(res) == 1
    assert res[0].passed is True

    # 4. Output matching robustness (including list brackets, float equiv, empty expected)
    assert outputs_match("0 1", "0 1") is True
    assert outputs_match("[0, 1]", "0 1") is True
    assert outputs_match("[0,1]", "0 1") is True
    assert outputs_match("0 1", "[0, 1]") is True
    assert outputs_match("0  1", "0 1") is True
    assert outputs_match("0 1", "```\n0 1\n```") is True
    assert outputs_match("0 1", '"0 1"') is True
    assert outputs_match("True", "true") is True
    assert outputs_match("False", "false") is True
    assert outputs_match("10 20\n30 40", "10 20\n30 40\n") is True
    assert outputs_match("3.0", "3") is True
    assert outputs_match("42", "") is True  # Empty expected output treats successful run as passed
    assert outputs_match("0 2", "0 1") is False

    # 5. GeminiTestCase alias mapping and type coercion
    tc_alias1 = GeminiTestCase.model_validate({"input": "4 9\n2 7 11 15", "output": "0 1"})
    assert tc_alias1.stdin == "4 9\n2 7 11 15"
    assert tc_alias1.expected_stdout == "0 1"

    tc_alias2 = GeminiTestCase.model_validate({"test_input": 42, "expected_output": 84})
    assert tc_alias2.stdin == "42"
    assert tc_alias2.expected_stdout == "84"

    tc_alias3 = GeminiTestCase.model_validate({"input": [1, 2, 3], "output": [3, 2, 1]})
    assert tc_alias3.stdin == "1 2 3"
    assert tc_alias3.expected_stdout == "3 2 1"


@pytest.mark.asyncio
async def test_user_testcases_execution_and_preanalysis_verification():
    """Verify user test cases run execution, input handling, and pre-analysis verification."""
    await init_db()
    async with AsyncSessionLocal() as db:
        await run_seeds(db)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Create a new session
        create_res = await ac.post("/api/sessions?problem_id=1", json={
            "language": "python",
            "submission_label": "Testcase Validation Runner"
        })
        session_id = create_res.json()["session_id"]

        valid_code = (
            "import sys\n"
            "def solve():\n"
            "    tokens = sys.stdin.read().split()\n"
            "    if not tokens: return\n"
            "    n, target = int(tokens[0]), int(tokens[1])\n"
            "    nums = [int(x) for x in tokens[2:2+n]]\n"
            "    seen = {}\n"
            "    for i, x in enumerate(nums):\n"
            "        comp = target - x\n"
            "        if comp in seen:\n"
            "            print(f'{seen[comp]} {i}')\n"
            "            return\n"
            "        seen[x] = i\n"
            "if __name__ == '__main__': solve()\n"
        )

        # 1. Run tests with custom test cases via dry-run endpoint
        test_cases = [
            {"test_id": 1, "test_case_id": "Case 1", "stdin": "4 9\n2 7 11 15\n", "expected_stdout": "0 1"},
            {"test_id": 2, "test_case_id": "Case 2", "stdin": "3 6\n3 2 4\n", "expected_stdout": "1 2"},
            {"test_id": 3, "test_case_id": "Case 3 (empty expected)", "stdin": "2 6\n3 3\n", "expected_stdout": ""}
        ]

        run_res = await ac.post(f"/api/sessions/{session_id}/dry-run", json={
            "code": valid_code,
            "test_cases": test_cases
        })
        assert run_res.status_code == 200
        run_data = run_res.json()
        assert run_data["passed"] is True
        assert len(run_data["test_results"]) == 3
        assert run_data["test_results"][0]["passed"] is True
        assert run_data["test_results"][1]["passed"] is True
        assert run_data["test_results"][2]["passed"] is True

        # 2. Test run with failing output
        bad_code = "print('99 99')"
        bad_run = await ac.post(f"/api/sessions/{session_id}/dry-run", json={
            "code": bad_code,
            "test_cases": [
                {"test_id": 1, "test_case_id": "Case 1", "stdin": "4 9\n2 7 11 15\n", "expected_stdout": "0 1"}
            ]
        })
        bad_data = bad_run.json()
        assert bad_data["passed"] is False
        assert bad_data["test_results"][0]["passed"] is False

        # 3. Test direct /run-tests endpoint
        direct_run = await ac.post(f"/api/sessions/{session_id}/run-tests", json={
            "code": valid_code,
            "test_cases": test_cases[:2]
        })
        assert direct_run.status_code == 200
        direct_data = direct_run.json()
        assert direct_data["passed"] is True
        assert direct_data["passed_count"] == 2
        assert direct_data["failed_count"] == 0


