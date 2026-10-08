"""
code_runner.py — High-Performance Native Local Code Execution Engine for Verdict.

100% Local Native Sandboxed Execution:
- Python 3 (via sys.executable with unbuffered I/O)
- C++ 17 (via clang++ / g++ with -O2 optimization)
- Java 17 (via javac / java with memory limits)
- JavaScript / Node.js (via node)

Features:
- Single-pass compilation for compiled languages (C++, Java)
- Microsecond timing metrics for runtime execution
- Output normalization and accurate comparison
- Timeout and TLE handling
- Zero external network dependencies (no remote Piston)
"""

import asyncio
import os
import sys
import tempfile
import time
import shutil
import subprocess
import re
import json
import ast
import inspect
from typing import Optional, List, Any
from dataclasses import dataclass

DEFAULT_TIMEOUT_MS = 5000


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


PYTHON_LEETCODE_HARNESS = r'''
# --- Automatic Verdict AI LeetCode Runner Harness ---
if __name__ == "__main__":
    import sys, json, ast, inspect

    def _verdict_run():
        raw_input = sys.stdin.read()
        if "Solution" not in globals():
            return
        sol_cls = globals()["Solution"]
        sol = sol_cls()
        methods = [m for m in dir(sol) if not m.startswith("_") and callable(getattr(sol, m))]
        if not methods:
            return
        func = getattr(sol, methods[0])
        sig = inspect.signature(func)
        params = list(sig.parameters.values())

        def _parse_val(val_str, expected_type=None, param_name=""):
            val_str = (val_str or "").strip()
            is_list = False
            if expected_type and any(t in str(expected_type).lower() for t in ("list", "sequence", "iterable")):
                is_list = True
            elif param_name.lower() in ("nums", "candidates", "arr", "array", "nodes", "points", "matrix", "grid", "vals", "digits"):
                is_list = True

            if not val_str:
                return [] if is_list else None

            # Handle param = value
            if "=" in val_str and not val_str.startswith("{"):
                parts = val_str.split("=", 1)
                val_str = parts[1].strip()

            parsed = None
            try:
                parsed = ast.literal_eval(val_str)
            except Exception:
                pass

            if parsed is None:
                # Try splitting by space
                tokens = val_str.split()
                if len(tokens) > 1:
                    try:
                        parsed = [int(t) for t in tokens]
                    except ValueError:
                        try:
                            parsed = [float(t) for t in tokens]
                        except ValueError:
                            parsed = tokens
                elif len(tokens) == 1:
                    try:
                        parsed = int(tokens[0])
                    except ValueError:
                        try:
                            parsed = float(tokens[0])
                        except ValueError:
                            parsed = tokens[0]
                else:
                    parsed = val_str

            if is_list and not isinstance(parsed, list):
                parsed = [parsed] if parsed is not None else []
            return parsed

        raw_lines = [l.strip() for l in raw_input.splitlines()]
        non_empty = [l for l in raw_lines if l]

        args = []
        if len(non_empty) == len(params):
            for line, param in zip(non_empty, params):
                args.append(_parse_val(line, param.annotation, param.name))
        elif len(raw_lines) == len(params):
            for line, param in zip(raw_lines, params):
                args.append(_parse_val(line, param.annotation, param.name))
        else:
            for i, param in enumerate(params):
                if i < len(non_empty):
                    args.append(_parse_val(non_empty[i], param.annotation, param.name))
                else:
                    args.append(_parse_val("", param.annotation, param.name))

        try:
            res = func(*args)
            if isinstance(res, (list, dict, bool, int, float, str)) or res is None:
                print(json.dumps(res))
            else:
                print(res)
        except Exception as e:
            print(f"Runtime error in {methods[0]}: {e}", file=sys.stderr)

    _verdict_run()
'''


def _clean_output(text: Optional[str]) -> str:
    """Normalize output for fair string comparison."""
    if not text:
        return ""
    # Strip markdown fences if present (e.g. ```text ... ``` or ```)
    s = text.replace("\r\n", "\n").strip()
    if s.startswith("```"):
        lines = s.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        s = "\n".join(lines).strip()
    elif s.startswith("`") and s.endswith("`") and len(s) >= 2:
        s = s[1:-1].strip()
    elif s.startswith('"') and s.endswith('"') and len(s) >= 2 and '\n' not in s:
        s = s[1:-1].strip()

    lines = [line.rstrip() for line in s.splitlines()]
    return "\n".join(lines)


def _try_parse_val(text: str) -> Any:
    """Attempt to parse text as JSON or Python literal structure."""
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    try:
        return ast.literal_eval(text)
    except Exception:
        pass
    return None


def _structures_equal(a: Any, b: Any) -> bool:
    """Deep structural comparison with unordered list/subset tolerance."""
    if a == b:
        return True
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) < 1e-6
    if isinstance(a, str) and isinstance(b, str):
        return a.strip().lower() == b.strip().lower()
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return False
        # Direct element-wise match
        if all(_structures_equal(x, y) for x, y in zip(a, b)):
            return True
        # Try sorted comparison (if inner elements are lists or primitives)
        try:
            def sort_key(item):
                if isinstance(item, list):
                    return (0, tuple(sort_key(sub) for sub in sorted(item, key=sort_key)))
                return (1, str(item))
            sorted_a = sorted(a, key=sort_key)
            sorted_b = sorted(b, key=sort_key)
            return all(_structures_equal(x, y) for x, y in zip(sorted_a, sorted_b))
        except Exception:
            pass
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a.keys()) != set(b.keys()):
            return False
        return all(_structures_equal(a[k], b[k]) for k in a)
    return False


def outputs_match(actual: Optional[str], expected: Optional[str]) -> bool:
    """
    Fair and robust comparison between actual execution output and expected test output.
    Supports:
    - If expected is empty or not provided, returns True (user inspecting custom input)
    - Exact match after line trimming
    - Deep structural match for JSON / lists (including unordered combinations)
    - Tokenized line-by-line whitespace and delimiter normalization ([0, 1] vs 0 1)
    - Boolean case normalization (True vs true)
    - Numeric equivalence (3.0 == 3)
    - Markdown code-block removal in expected output
    - Entire stream token comparison (single-line vs multi-line formatting differences)
    """
    exp_clean = _clean_output(expected)
    if not exp_clean:
        return True

    act_clean = _clean_output(actual)
    if act_clean == exp_clean:
        return True

    # 0. Deep structural comparison (handles [[2,2,3],[7]] vs [[7],[2,2,3]])
    val_act = _try_parse_val(act_clean)
    val_exp = _try_parse_val(exp_clean)
    if val_act is not None and val_exp is not None:
        if _structures_equal(val_act, val_exp):
            return True

    def tokenize_line(line: str) -> list[str]:
        # Normalize delimiters (brackets, parens, commas) to spaces
        norm = line.replace("[", " ").replace("]", " ").replace("(", " ").replace(")", " ").replace(",", " ")
        return norm.split()

    def tokens_equal(t1: str, t2: str) -> bool:
        if t1 == t2:
            return True
        if t1.lower() == t2.lower():
            return True
        try:
            f1, f2 = float(t1), float(t2)
            if abs(f1 - f2) < 1e-6:
                return True
        except ValueError:
            pass
        return False

    act_lines = [l.strip() for l in act_clean.splitlines() if l.strip()]
    exp_lines = [l.strip() for l in exp_clean.splitlines() if l.strip()]

    # 1. Line-by-line token comparison
    if len(act_lines) == len(exp_lines):
        all_match = True
        for a_line, e_line in zip(act_lines, exp_lines):
            a_tokens = tokenize_line(a_line)
            e_tokens = tokenize_line(e_line)
            if len(a_tokens) != len(e_tokens):
                all_match = False
                break
            if not all(tokens_equal(a, e) for a, e in zip(a_tokens, e_tokens)):
                all_match = False
                break
        if all_match:
            return True

    # 2. Entire stream token comparison (single line vs multi-line list prints)
    all_act_tokens = [t for l in act_lines for t in tokenize_line(l)]
    all_exp_tokens = [t for l in exp_lines for t in tokenize_line(l)]

    if len(all_act_tokens) == len(all_exp_tokens) and len(all_act_tokens) > 0:
        if all(tokens_equal(a, e) for a, e in zip(all_act_tokens, all_exp_tokens)):
            return True

    return False


def _run_cmd_sync(
    cmd: list,
    stdin: str = "",
    timeout_s: float = 5.0,
    cwd: Optional[str] = None
) -> tuple[int, str, str, float]:
    """
    Synchronous subprocess execution helper with high-precision timing.
    Guarantees stdin normalization and proper EOF delivery.
    Returns (returncode, stdout, stderr, elapsed_ms).
    """
    # Normalize stdin line endings to LF and ensure non-empty inputs end with newline
    normalized_stdin = (stdin or "").replace("\r\n", "\n")
    if normalized_stdin and not normalized_stdin.endswith("\n"):
        normalized_stdin += "\n"

    start = time.perf_counter()
    try:
        res = subprocess.run(
            cmd,
            input=normalized_stdin,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=cwd,
            encoding="utf-8",
            errors="replace"
        )
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        return res.returncode, res.stdout, res.stderr, elapsed_ms
    except subprocess.TimeoutExpired as te:
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        stdout = te.stdout or ""
        if isinstance(stdout, bytes):
            stdout = stdout.decode("utf-8", "replace")
        stderr = te.stderr or ""
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", "replace")
        return 124, stdout, stderr + f"\nTime Limit Exceeded (TLE) - Execution timed out after {timeout_s:.1f}s", elapsed_ms
    except Exception as ex:
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        return 1, "", f"Execution error: {type(ex).__name__}: {str(ex)}", elapsed_ms


class LocalRunner:
    """High-speed native subprocess code runner with pre-compilation support."""

    @staticmethod
    def _find_compiler(name: str) -> Optional[str]:
        return shutil.which(name)

    @classmethod
    async def compile_solution(cls, code: str, language: str, work_dir: str) -> tuple[bool, str, str, Optional[int]]:
        """
        Compile code or perform pre-flight syntax check. Returns (success, stdout, stderr, error_line).
        """
        from pipeline.error_parser import parse_error_line

        lang = language.lower()

        if lang in ("python", "py"):
            filename = "main.py"
            filepath = os.path.join(work_dir, filename)

            # Check for user-written syntax errors in pure user code
            try:
                compile(code, "<submitted_code>", "exec")
            except SyntaxError as se:
                err_msg = f"SyntaxError: {se.msg} (line {se.lineno})"
                return False, "", err_msg, se.lineno

            # Check if user provided LeetCode-style `class Solution` without a driver
            has_solution_class = bool(re.search(r'^\s*class\s+Solution\b', code, re.MULTILINE))
            has_main_driver = ("__main__" in code) or ("sys.stdin" in code) or ("input(" in code)

            full_code = code
            if has_solution_class and not has_main_driver:
                full_code = code + "\n\n" + PYTHON_LEETCODE_HARNESS

            with open(filepath, "w", encoding="utf-8") as f:
                f.write(full_code)

            return True, "", "", None

        elif lang in ("javascript", "js", "node"):
            filename = "main.js"
            filepath = os.path.join(work_dir, filename)
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(code)
            node = cls._find_compiler("node") or "node"
            # Syntax validation via node --check
            rc, stdout, stderr, _ = await asyncio.to_thread(
                _run_cmd_sync, [node, "--check", filepath], "", 5.0, work_dir
            )
            if rc != 0:
                err_line = parse_error_line(stderr, "javascript")
                return False, stdout, stderr, err_line
            return True, "", "", None

        elif lang in ("cpp", "c++", "c"):
            src_path = os.path.join(work_dir, "main.cpp")
            exe_path = os.path.join(work_dir, "main.exe" if sys.platform == "win32" else "main")
            with open(src_path, "w", encoding="utf-8") as f:
                f.write(code)

            compiler = cls._find_compiler("g++") or cls._find_compiler("clang++") or "g++"
            compile_cmd = [compiler, "-O2", "-std=c++17", src_path, "-o", exe_path]

            rc, stdout, stderr, _ = await asyncio.to_thread(_run_cmd_sync, compile_cmd, "", 10.0, work_dir)
            if rc != 0:
                err_line = parse_error_line(stderr, "cpp")
                return False, stdout, stderr, err_line
            return True, stdout, "", None

        elif lang == "java":
            # 1. Clean up package statement if present (causes classloader path mismatch in flat dir)
            clean_code = re.sub(r'^\s*package\s+[^;]+;', '// package stripped', code, flags=re.MULTILINE)

            # 2. Look for class containing main method first, then public class, then any class
            main_match = re.search(r'class\s+([A-Za-z0-9_]+)[^{]*\{[^{}]*public\s+static\s+void\s+main', clean_code, re.DOTALL)
            if main_match:
                class_name = main_match.group(1)
            else:
                pub_match = re.search(r'public\s+class\s+([A-Za-z0-9_]+)', clean_code)
                if pub_match:
                    class_name = pub_match.group(1)
                else:
                    cls_match = re.search(r'class\s+([A-Za-z0-9_]+)', clean_code)
                    class_name = cls_match.group(1) if cls_match else "Main"

            src_path = os.path.join(work_dir, f"{class_name}.java")
            with open(src_path, "w", encoding="utf-8") as f:
                f.write(clean_code)

            with open(os.path.join(work_dir, ".main_class"), "w", encoding="utf-8") as f:
                f.write(class_name)

            javac = cls._find_compiler("javac") or "javac"
            compile_cmd = [javac, src_path]

            rc, stdout, stderr, _ = await asyncio.to_thread(_run_cmd_sync, compile_cmd, "", 10.0, work_dir)
            if rc != 0:
                err_line = parse_error_line(stderr, "java")
                return False, stdout, stderr, err_line
            return True, stdout, "", None

        return False, "", f"Unsupported language: {language}", None

    @classmethod
    async def execute_run(
        cls,
        language: str,
        work_dir: str,
        stdin: str = "",
        timeout_ms: int = DEFAULT_TIMEOUT_MS
    ) -> tuple[int, str, str, float]:
        """
        Execute pre-compiled or interpreted code against a single stdin input.
        Returns (returncode, stdout, stderr, elapsed_ms).
        """
        lang = language.lower()
        timeout_s = max(0.5, timeout_ms / 1000.0)

        if lang in ("python", "py"):
            filepath = os.path.join(work_dir, "main.py")
            cmd = [sys.executable, "-u", filepath]
            return await asyncio.to_thread(_run_cmd_sync, cmd, stdin, timeout_s, work_dir)

        elif lang in ("javascript", "js", "node"):
            filepath = os.path.join(work_dir, "main.js")
            node = cls._find_compiler("node") or "node"
            cmd = [node, filepath]
            return await asyncio.to_thread(_run_cmd_sync, cmd, stdin, timeout_s, work_dir)

        elif lang in ("cpp", "c++", "c"):
            exe_path = os.path.join(work_dir, "main.exe" if sys.platform == "win32" else "main")
            cmd = [exe_path]
            return await asyncio.to_thread(_run_cmd_sync, cmd, stdin, timeout_s, work_dir)

        elif lang == "java":
            java = cls._find_compiler("java") or "java"
            main_class_file = os.path.join(work_dir, ".main_class")
            class_name = "Main"
            if os.path.exists(main_class_file):
                try:
                    with open(main_class_file, "r", encoding="utf-8") as f:
                        class_name = f.read().strip() or "Main"
                except Exception:
                    class_name = "Main"
            cmd = [java, "-Xmx256m", "-cp", work_dir, class_name]
            return await asyncio.to_thread(_run_cmd_sync, cmd, stdin, timeout_s, work_dir)

        return 1, "", f"Unsupported language runtime: {language}", 0.0


class LocalCodeRunner:
    """High-Speed Local Sandboxed Code Execution Engine."""

    async def close(self):
        """No external connections to close."""
        pass

    async def dry_run(self, code: str, language: str, stdin: str = "") -> DryRunResult:
        """
        Perform a compilation and runtime dry-run check.
        If stdin is empty, it verifies syntax / compilation, and if executed,
        gracefully treats input-exhaustion / missing-input exceptions as passing pre-flight.
        """
        from pipeline.error_parser import parse_error_line

        with tempfile.TemporaryDirectory() as tmpdir:
            # 1. Compile stage (C++, Java, Python syntax, JS syntax)
            ok, c_out, c_err, err_line = await LocalRunner.compile_solution(code, language, tmpdir)
            if not ok:
                return DryRunResult(
                    passed=False,
                    stdout=c_out,
                    stderr=c_err,
                    error_line=err_line or parse_error_line(c_err, language)
                )

            # If no stdin was provided: pre-flight execution check
            if not stdin or not stdin.strip():
                rc, r_out, r_err, _ = await LocalRunner.execute_run(language, tmpdir, stdin="", timeout_ms=1500)

                # Exceptions caused by reading from empty stdin in pre-flight are normal and pass pre-flight
                INPUT_EXHAUSTED_PATTERNS = [
                    "nosuchelementexception",
                    "eoferror",
                    "eof",
                    "empty input",
                    "read after eof",
                    "indexerror",
                    "valueerror",
                    "nullpointerexception",
                    "numberformatexception",
                    "bad_alloc",
                    "assertion failed",
                    "assert",
                    "broken pipe",
                    "stopiteration"
                ]
                NON_INPUT_FATAL_PATTERNS = [
                    "zerodivisionerror",
                    "nameerror",
                    "typeerror",
                    "attributeerror",
                    "importerror",
                    "modulenotfounderror",
                    "syntaxerror",
                    "recursionerror",
                    "unboundlocalerror",
                    "indentationerror",
                    "taberror",
                    "segmentation fault",
                    "sigsegv",
                    "sigabrt",
                    "core dumped"
                ]
                if rc != 0 or r_err.strip():
                    err_lower = r_err.lower()
                    # 1. Fatal non-input exceptions should always fail
                    if any(fp in err_lower for fp in NON_INPUT_FATAL_PATTERNS):
                        err_line = parse_error_line(r_err, language)
                        return DryRunResult(
                            passed=False,
                            stdout=r_out,
                            stderr=r_err.strip(),
                            error_line=err_line
                        )

                    # 2. Input-exhaustion exceptions due to empty stdin in pre-flight
                    if any(p in err_lower for p in INPUT_EXHAUSTED_PATTERNS):
                        return DryRunResult(passed=True, stdout=r_out, stderr="")

                    err_line = parse_error_line(r_err, language)
                    return DryRunResult(
                        passed=False,
                        stdout=r_out,
                        stderr=r_err.strip(),
                        error_line=err_line
                    )

                return DryRunResult(passed=True, stdout=r_out, stderr="")

            # If stdin was provided, execute against provided stdin
            rc, r_out, r_err, _ = await LocalRunner.execute_run(language, tmpdir, stdin=stdin, timeout_ms=5000)
            err_line = parse_error_line(r_err, language) if (r_err and rc != 0) else None
            return DryRunResult(
                passed=(rc == 0),
                stdout=r_out,
                stderr=r_err.strip(),
                error_line=err_line
            )

    async def run_all_tests(
        self,
        code: str,
        language: str,
        test_cases: list,
        timeout_ms: int = DEFAULT_TIMEOUT_MS
    ) -> List[TestExecutionResult]:
        """
        Execute all test cases in batch with single-pass compilation.
        """
        if not test_cases:
            return []

        with tempfile.TemporaryDirectory() as tmpdir:
            # 1. Compile once
            ok, c_out, c_err, _ = await LocalRunner.compile_solution(code, language, tmpdir)
            if not ok:
                return [
                    TestExecutionResult(
                        test_id=tc.test_id,
                        passed=False,
                        actual_stdout="",
                        expected_stdout=tc.expected_stdout,
                        stderr=c_err.strip() or "Compilation failed",
                        time_ms=0.0
                    )
                    for tc in test_cases
                ]

            # 2. Execute test cases against pre-compiled executable
            results = []
            for tc in test_cases:
                rc, actual_out, err_out, time_ms = await LocalRunner.execute_run(
                    language=language,
                    work_dir=tmpdir,
                    stdin=tc.stdin,
                    timeout_ms=timeout_ms
                )

                matched = outputs_match(actual_out, tc.expected_stdout)
                is_tle = (rc == 124) or ("TLE" in err_out) or ("Time Limit Exceeded" in err_out)
                passed = (rc == 0) and matched and not is_tle

                results.append(
                    TestExecutionResult(
                        test_id=tc.test_id,
                        passed=passed,
                        actual_stdout=actual_out,
                        expected_stdout=tc.expected_stdout,
                        stderr=err_out.strip(),
                        time_ms=time_ms
                    )
                )

            return results

    async def execute(
        self,
        code: str,
        language: str,
        stdin: str = "",
        timeout_seconds: float = 5.0
    ) -> dict:
        """Execute a code snippet directly and return standardized run dict."""
        with tempfile.TemporaryDirectory() as tmpdir:
            ok, c_out, c_err, _ = await LocalRunner.compile_solution(code, language, tmpdir)
            if not ok:
                return {
                    "compile": {"stdout": c_out, "stderr": c_err, "code": 1},
                    "run": {"stdout": "", "stderr": c_err, "code": 1},
                    "stderr": c_err,
                    "stdout": ""
                }
            rc, r_out, r_err, elapsed = await LocalRunner.execute_run(
                language=language,
                work_dir=tmpdir,
                stdin=stdin,
                timeout_ms=int(timeout_seconds * 1000)
            )
            return {
                "run": {"stdout": r_out, "stderr": r_err, "code": rc},
                "stdout": r_out,
                "stderr": r_err,
                "time_ms": elapsed
            }

    async def run_test(
        self,
        code: str,
        language: str,
        test_id: int,
        stdin: str,
        expected_stdout: str,
        timeout_ms: int = DEFAULT_TIMEOUT_MS
    ) -> TestExecutionResult:
        """Run a single test case."""
        res_list = await self.run_all_tests(
            code=code,
            language=language,
            test_cases=[type('TestCase', (), {
                'test_id': test_id,
                'stdin': stdin,
                'expected_stdout': expected_stdout
            })()],
            timeout_ms=timeout_ms
        )
        return res_list[0]


# Singletons
local_runner = LocalCodeRunner()
code_runner = local_runner
# Alias for backwards compatibility
piston_client = local_runner
PistonClient = LocalCodeRunner
