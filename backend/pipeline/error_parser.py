"""
error_parser.py — Extract error line numbers from compiler/runtime error output.

When a dry-run fails (compile error for C++/Java, runtime error for Python),
we parse the stderr output to find the line number where the error occurred.
This line number is used to place a red gutter marker in the Monaco editor,
giving the user VS Code–style inline error highlighting.

Each language has a different error message format:
  - Python:  File "<file>", line 5, in <module>
  - C++:     main.cpp:12:5: error: expected ';'
  - Java:    Main.java:8: error: ';' expected

The regex patterns extract the line number from these formats.
"""

import re
from typing import Optional

# Language-specific regex patterns for extracting error line numbers
# Each pattern captures the line number as group(1)
# The <file> placeholder in the spec is replaced with the actual filename
ERROR_LINE_PATTERNS = {
    "python": [
        # Standard Python traceback: File "main.py", line 5
        # Also matches File "<string>", line 5 (used by some Python runners)
        r'File\s+"[^"]*",\s+line\s+(\d+)',
        # SyntaxError format: line 5
        r'line\s+(\d+)',
    ],
    "cpp": [
        # GCC error format: main.cpp:12:5: error: message
        # Also matches: main.cpp:12: warning: message
        r'main\.cpp:(\d+):\d+:\s+(?:error|warning)',
        # Simpler format: main.cpp:12: error
        r'main\.cpp:(\d+):\s+(?:error|warning)',
        # Generic format with any filename
        r'[^:]+\.cpp:(\d+)',
    ],
    "java": [
        # javac error format: Main.java:8: error: ';' expected
        r'Main\.java:(\d+):\s+error',
        # Warning format: Main.java:8: warning: message
        r'Main\.java:(\d+):\s+warning',
        # Generic format
        r'[^:]+\.java:(\d+)',
    ],
}


def parse_error_line(stderr: str, language: str) -> Optional[int]:
    """
    Parse the stderr output to extract the error line number.
    
    Tries each regex pattern for the given language in order,
    returning the first match found. If no pattern matches,
    returns None (the frontend will show the error without
    a gutter marker in that case).
    
    Args:
        stderr: The standard error output from the compiler/runtime
        language: The programming language ('python', 'cpp', 'java')
    
    Returns:
        int or None: The 1-indexed line number where the error occurred,
                     or None if the line number couldn't be extracted
    
    Examples:
        >>> parse_error_line('File "main.py", line 5, in <module>', 'python')
        5
        >>> parse_error_line('main.cpp:12:5: error: expected ";"', 'cpp')
        12
        >>> parse_error_line('Main.java:8: error: ";" expected', 'java')
        8
        >>> parse_error_line('some unknown error', 'python')
        None
    """
    if not stderr or not language:
        return None

    # Get the list of regex patterns for this language
    patterns = ERROR_LINE_PATTERNS.get(language, [])

    for pattern in patterns:
        match = re.search(pattern, stderr)
        if match:
            try:
                # Return the first captured group as an integer
                line_number = int(match.group(1))
                # Sanity check: line numbers should be positive
                if line_number > 0:
                    return line_number
            except (ValueError, IndexError):
                # If conversion fails, try the next pattern
                continue

    # No pattern matched — return None
    return None


def extract_error_message(stderr: str, language: str) -> str:
    """
    Extract a clean, user-friendly error message from stderr.
    
    Strips ANSI color codes, trims excessive whitespace, and truncates
    very long error messages to keep the UI readable.
    
    Args:
        stderr: Raw stderr output
        language: Programming language (for language-specific cleanup)
    
    Returns:
        str: Cleaned error message suitable for display in the Problems panel
    """
    if not stderr:
        return "Unknown error"

    # Remove ANSI escape codes (color codes from some compilers)
    ansi_escape = re.compile(r'\x1b\[[0-9;]*m')
    cleaned = ansi_escape.sub('', stderr)

    # Trim leading/trailing whitespace
    cleaned = cleaned.strip()

    # Truncate very long error messages (keep first 1000 chars)
    # Long template errors in C++ can be thousands of lines
    max_length = 1000
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length] + "\n... (error output truncated)"

    return cleaned if cleaned else "Unknown error"
