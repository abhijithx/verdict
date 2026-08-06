"""
piston_client.py — Hybrid code execution engine for CodeScore AI.

Handles code compilation and execution for Python, C++, and Java.
Uses Piston API endpoint if available; automatically falls back to local
subprocess execution (Python, g++, javac/java) when remote Piston returns
errors (e.g. 401 Unauthorized or offline mode).

Language mapping:
  - python → python / sys.executable (main.py)
  - cpp    → g++ -O2 (main.cpp)
  - java   → javac / java (Main.java)
"""

import httpx
import asyncio
import os
import sys
import tempfile
import time
import subprocess
from typing import Optional
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()

PISTON_URL = os.getenv("PISTON_URL", "https://emkc.org/api/v2/piston/execute")

LANGUAGE_CONFIG = {
    "python": {
        "language": "python",
        "version": "3.10.0",
        "filename": "main.py",
    },
    "cpp": {
        "language": "c++",
        "version": "10.2.0",
        "filename": "main.cpp",
    },
    "java": {
        "language": "java",
        "version": "15.0.2",
        "filename": "Main.java",
    },
}

DEFAULT_TIMEOUT_MS = 5000
RATE_LIMIT_DELAY = 0.15


@dataclass
class DryRunResult:
    passed: bool
    stdout: str = ""
    stderr: str = ""
    error_line: Optional[int] = None


@dataclass
class TestExecutionResult:
    test_id: int
    passed: bool
    actual_stdout: str = ""
    expected_stdout: str = ""
    stderr: str = ""
    time_ms: float = 0.0


def _run_subprocess_sync(cmd: list, stdin: str = "", timeout_s: float = 5.0, cwd: str = None) -> tuple[int, str, str, bool]:
    """Synchronous subprocess helper for thread execution."""
    try:
        res = subprocess.run(
            cmd,
            input=stdin,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=cwd,
            encoding="utf-8",
            errors="replace"
        )
        return res.returncode, res.stdout, res.stderr, False
    except subprocess.TimeoutExpired as te:
        stdout = te.stdout or ""
        if isinstance(stdout, bytes):
            stdout = stdout.decode("utf-8", "replace")
        stderr = te.stderr or ""
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", "replace")
        return 124, stdout, stderr + f"\nExecution timed out (Limit: {timeout_s}s)", True


class PistonClient:
    def __init__(self, base_url: str = PISTON_URL):
        self.base_url = base_url
        self.client = httpx.AsyncClient(timeout=15.0)

    async def close(self):
        await self.client.aclose()

    def _build_payload(self, code: str, language: str,
                       stdin: str = "", timeout_ms: int = DEFAULT_TIMEOUT_MS) -> dict:
        config = LANGUAGE_CONFIG.get(language)
        if not config:
            raise ValueError(f"Unsupported language: '{language}'. Supported: {list(LANGUAGE_CONFIG.keys())}")

        return {
            "language": config["language"],
            "version": config["version"],
            "files": [{"name": config["filename"], "content": code}],
            "stdin": stdin,
            "run_timeout": timeout_ms,
        }

    async def _execute_local(self, code: str, language: str, stdin: str = "", timeout_ms: int = DEFAULT_TIMEOUT_MS) -> dict:
        """Fallback local runner using system compilers/interpreters via thread pool."""
        timeout_s = timeout_ms / 1000.0

        with tempfile.TemporaryDirectory() as tmpdir:
            if language == "python":
                filepath = os.path.join(tmpdir, "main.py")
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(code)

                code_rc, stdout, stderr, is_timeout = await asyncio.to_thread(
                    _run_subprocess_sync, [sys.executable, filepath], stdin, timeout_s, tmpdir
                )
                return {
                    "compile": {},
                    "run": {
                        "stdout": stdout,
                        "stderr": stderr,
                        "code": code_rc,
                    }
                }

            elif language == "cpp":
                srcpath = os.path.join(tmpdir, "main.cpp")
                exepath = os.path.join(tmpdir, "main.exe" if sys.platform == "win32" else "main")
                with open(srcpath, "w", encoding="utf-8") as f:
                    f.write(code)

                c_rc, c_out, c_err, _ = await asyncio.to_thread(
                    _run_subprocess_sync, ["g++", "-O2", srcpath, "-o", exepath], "", 10.0, tmpdir
                )
                if c_rc != 0:
                    return {
                        "compile": {
                            "stdout": c_out,
                            "stderr": c_err,
                            "code": c_rc,
                        },
                        "run": {"stdout": "", "stderr": "", "code": 0}
                    }

                code_rc, stdout, stderr, is_timeout = await asyncio.to_thread(
                    _run_subprocess_sync, [exepath], stdin, timeout_s, tmpdir
                )
                return {
                    "compile": {},
                    "run": {
                        "stdout": stdout,
                        "stderr": stderr,
                        "code": code_rc,
                    }
                }

            elif language == "java":
                srcpath = os.path.join(tmpdir, "Main.java")
                with open(srcpath, "w", encoding="utf-8") as f:
                    f.write(code)

                c_rc, c_out, c_err, _ = await asyncio.to_thread(
                    _run_subprocess_sync, ["javac", srcpath], "", 10.0, tmpdir
                )
                if c_rc != 0:
                    return {
                        "compile": {
                            "stdout": c_out,
                            "stderr": c_err,
                            "code": c_rc,
                        },
                        "run": {"stdout": "", "stderr": "", "code": 0}
                    }

                code_rc, stdout, stderr, is_timeout = await asyncio.to_thread(
                    _run_subprocess_sync, ["java", "-cp", tmpdir, "Main"], stdin, timeout_s, tmpdir
                )
                return {
                    "compile": {},
                    "run": {
                        "stdout": stdout,
                        "stderr": stderr,
                        "code": code_rc,
                    }
                }

        raise ValueError(f"Unsupported language: {language}")

    async def _execute(self, code: str, language: str,
                       stdin: str = "", timeout_ms: int = DEFAULT_TIMEOUT_MS) -> dict:
        """Try HTTP Piston first; on non-200 or network error, fallback to local execution."""
        use_local = False
        try:
            payload = self._build_payload(code, language, stdin, timeout_ms)
            response = await self.client.post(self.base_url, json=payload)
            if response.status_code == 200:
                return response.json()
            print(f"[EXEC ENGINE] Remote Piston API returned HTTP {response.status_code}. Falling back to local execution.")
            use_local = True
        except Exception as e:
            print(f"[EXEC ENGINE] Remote API request failed: {e}. Falling back to local execution.")
            use_local = True

        if use_local:
            try:
                return await self._execute_local(code, language, stdin, timeout_ms)
            except Exception as ex:
                import traceback
                print(f"[EXEC ENGINE ERROR] Local execution failed for {language}:")
                traceback.print_exc()
                return {
                    "compile": {},
                    "run": {
                        "stdout": "",
                        "stderr": f"Local execution failed: {type(ex).__name__}: {str(ex) or 'Unknown error'}",
                        "code": 1
                    }
                }

    async def dry_run(self, code: str, language: str) -> DryRunResult:
        try:
            result = await self._execute(code, language, stdin="")
        except ValueError as e:
            return DryRunResult(passed=False, stderr=str(e))
        except Exception as e:
            import traceback
            traceback.print_exc()
            return DryRunResult(passed=False, stderr=f"Execution engine error: {type(e).__name__}: {str(e)}")

        compile_result = result.get("compile", {})
        if compile_result and compile_result.get("stderr", "").strip():
            from pipeline.error_parser import parse_error_line
            error_line = parse_error_line(compile_result["stderr"], language)
            return DryRunResult(
                passed=False,
                stdout=compile_result.get("stdout", ""),
                stderr=compile_result["stderr"],
                error_line=error_line,
            )

        run_result = result.get("run", {})
        run_stderr = run_result.get("stderr", "").strip()
        run_code = run_result.get("code", 0)

        if run_code != 0 or run_stderr:
            # These errors happen ONLY because dry-run uses empty stdin.
            # They are NOT code bugs — the program just needs real input.
            # Treat them as a passed dry-run so submission can proceed.
            INPUT_EXHAUSTED_PATTERNS = [
                "NoSuchElementException",   # Java Scanner with no stdin
                "EOFError",                 # Python input() with no stdin
                "EOF",                      # C++ cin with no stdin
            ]
            if any(p in run_stderr for p in INPUT_EXHAUSTED_PATTERNS):
                return DryRunResult(
                    passed=True,
                    stdout=run_result.get("stdout", ""),
                    stderr="",
                )

            from pipeline.error_parser import parse_error_line
            error_line = parse_error_line(run_stderr, language)
            return DryRunResult(
                passed=False,
                stdout=run_result.get("stdout", ""),
                stderr=run_stderr,
                error_line=error_line,
            )

        return DryRunResult(
            passed=True,
            stdout=run_result.get("stdout", ""),
            stderr="",
        )

    async def run_test(self, code: str, language: str,
                       test_id: int, stdin: str, expected_stdout: str,
                       timeout_ms: int = DEFAULT_TIMEOUT_MS) -> TestExecutionResult:
        start_time = time.time()
        try:
            result = await self._execute(code, language, stdin, timeout_ms)
        except Exception as e:
            elapsed_ms = (time.time() - start_time) * 1000
            return TestExecutionResult(
                test_id=test_id,
                passed=False,
                stderr=f"Execution error: {str(e)}",
                expected_stdout=expected_stdout,
                time_ms=elapsed_ms,
            )

        elapsed_ms = (time.time() - start_time) * 1000
        run_result = result.get("run", {})
        actual_stdout = run_result.get("stdout", "")
        stderr = run_result.get("stderr", "")

        actual_clean = actual_stdout.rstrip()
        expected_clean = expected_stdout.rstrip()
        passed = (actual_clean == expected_clean)

        return TestExecutionResult(
            test_id=test_id,
            passed=passed,
            actual_stdout=actual_stdout,
            expected_stdout=expected_stdout,
            stderr=stderr,
            time_ms=elapsed_ms,
        )

    async def run_all_tests(self, code: str, language: str,
                            test_cases: list) -> list[TestExecutionResult]:
        tasks = [
            self.run_test(
                code=code,
                language=language,
                test_id=tc.test_id,
                stdin=tc.stdin,
                expected_stdout=tc.expected_stdout,
            )
            for tc in test_cases
        ]
        results = await asyncio.gather(*tasks)
        return list(results)


piston_client = PistonClient()
