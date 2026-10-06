"""
piston_client.py — Local Code Runner re-export (replaces remote Piston with 100% native local engine).
"""

from pipeline.code_runner import (
    DryRunResult,
    TestExecutionResult,
    LocalRunner,
    LocalCodeRunner,
    local_runner,
    code_runner,
    piston_client,
    PistonClient,
    DEFAULT_TIMEOUT_MS,
    _clean_output,
    _run_cmd_sync
)

__all__ = [
    "DryRunResult",
    "TestExecutionResult",
    "LocalRunner",
    "LocalCodeRunner",
    "local_runner",
    "code_runner",
    "piston_client",
    "PistonClient",
    "DEFAULT_TIMEOUT_MS",
    "_clean_output",
    "_run_cmd_sync"
]
