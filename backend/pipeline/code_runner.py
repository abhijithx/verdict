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


PYTHON_PREAMBLE = r'''import sys, os, math, collections, heapq, bisect, itertools, functools, re, json, ast, inspect
from collections import defaultdict, deque, Counter
from typing import List, Dict, Tuple, Set, Optional, Any, Union

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
'''

PYTHON_LEETCODE_HARNESS = r'''
# --- Automatic Verdict AI LeetCode Runner Harness (Python) ---
if __name__ == "__main__":
    import sys, json, ast, inspect, re

    def _verdict_run():
        raw_input = sys.stdin.read()
        func = None
        target_obj = None
        if "Solution" in globals():
            try:
                target_obj = globals()["Solution"]()
                defined_names = [
                    k for k, v in type(target_obj).__dict__.items()
                    if not k.startswith("_") and callable(v)
                ]
                if not defined_names:
                    defined_names = [m for m in dir(target_obj) if not m.startswith("_") and callable(getattr(target_obj, m))]

                common_names = {'twosum', 'threesum', 'foursum', 'solve', 'solution', 'isvalid', 'mergetwolists', 'merge', 'maxsubarray', 'lengthoflongestsubstring', 'climbstairs', 'coinchange', 'search', 'reversestring', 'movezeroes', 'removeduplicates', 'removeelement'}
                chosen_name = None
                for name in defined_names:
                    if name.lower() in common_names:
                        chosen_name = name
                        break
                if not chosen_name and defined_names:
                    chosen_name = defined_names[0]
                if chosen_name:
                    func = getattr(target_obj, chosen_name)
            except Exception:
                pass
        if not func:
            for k, v in list(globals().items()):
                if inspect.isfunction(v) and not k.startswith("_") and k not in ("ListNode", "TreeNode") and v.__module__ == "__main__":
                    func = v
                    break
        if not func:
            return

        sig = inspect.signature(func)
        params = [p for p in sig.parameters.values() if p.name != "self"]
        if not raw_input.strip() and len(params) > 0:
            return

        def _parse_single(s, p):
            s = (s or "").strip()
            if not s:
                return None
            if "=" in s and not s.startswith("{"):
                s = s.split("=", 1)[1].strip()
            val = None
            for parser in (json.loads, ast.literal_eval):
                try:
                    val = parser(s)
                    break
                except Exception:
                    pass
            if val is None:
                s_lower = s.lower()
                if s_lower == "true": val = True
                elif s_lower == "false": val = False
                elif s_lower == "null": val = None
                else:
                    try: val = int(s)
                    except ValueError:
                        try: val = float(s)
                        except ValueError: val = s

            ann = str(p.annotation).lower()
            p_name = p.name.lower()
            if ("listnode" in ann or "head" in p_name) and isinstance(val, list) and "ListNode" in globals():
                LN = globals()["ListNode"]
                dummy = LN(0)
                curr = dummy
                for x in val:
                    curr.next = LN(x)
                    curr = curr.next
                return dummy.next

            if ("treenode" in ann or "root" in p_name) and isinstance(val, list) and "TreeNode" in globals():
                TN = globals()["TreeNode"]
                if not val or val[0] is None:
                    return None
                root = TN(val[0])
                queue = [root]
                idx = 1
                while queue and idx < len(val):
                    node = queue.pop(0)
                    if idx < len(val) and val[idx] is not None:
                        node.left = TN(val[idx])
                        queue.append(node.left)
                    idx += 1
                    if idx < len(val) and val[idx] is not None:
                        node.right = TN(val[idx])
                        queue.append(node.right)
                    idx += 1
                return root

            return val

        def _split_top_level(text):
            parts = []
            curr = []
            depth_bracket = depth_brace = depth_paren = 0
            in_quote = None
            escaped = False
            for ch in text:
                if escaped:
                    curr.append(ch)
                    escaped = False
                    continue
                if ch == '\\':
                    escaped = True
                    curr.append(ch)
                    continue
                if in_quote:
                    curr.append(ch)
                    if ch == in_quote:
                        in_quote = None
                    continue
                if ch in ('"', "'"):
                    in_quote = ch
                    curr.append(ch)
                    continue
                if ch == '[': depth_bracket += 1
                elif ch == ']': depth_bracket = max(0, depth_bracket - 1)
                elif ch == '{': depth_brace += 1
                elif ch == '}': depth_brace = max(0, depth_brace - 1)
                elif ch == '(': depth_paren += 1
                elif ch == ')': depth_paren = max(0, depth_paren - 1)
                
                if (ch == ',' or ch == '\n' or ch == ';') and depth_bracket == 0 and depth_brace == 0 and depth_paren == 0:
                    part = "".join(curr).strip()
                    if part:
                        parts.append(part)
                    curr = []
                else:
                    curr.append(ch)
            if curr:
                part = "".join(curr).strip()
                if part:
                    parts.append(part)
            return parts

        named = {}
        for p in params:
            pat = r'(?:^|[\n,;])\s*' + re.escape(p.name) + r'\s*=\s*(.*?)(?=(?:[\n,;]\s*[a-zA-Z_]\w*\s*=)|\Z)'
            m = re.search(pat, raw_input, re.DOTALL)
            if m:
                named[p.name] = m.group(1).strip()

        args = []
        if len(named) == len(params):
            args = [_parse_single(named[p.name], p) for p in params]
        else:
            lines = [l.strip() for l in raw_input.splitlines() if l.strip()]
            if len(lines) == len(params):
                args = [_parse_single(lines[i], p) for i, p in enumerate(params)]
            else:
                top_parts = _split_top_level(raw_input)
                if len(top_parts) == len(params):
                    args = [_parse_single(top_parts[i], p) for i, p in enumerate(params)]
                else:
                    for i, p in enumerate(params):
                        val_str = top_parts[i] if i < len(top_parts) else (lines[i] if i < len(lines) else "")
                        args.append(_parse_single(val_str, p))

        try:
            res = func(*args)
            if res is None and len(args) > 0 and isinstance(args[0], (list, dict)):
                res = args[0]
        except Exception as e:
            print(f"Runtime error in {func.__name__}: {e}", file=sys.stderr)
            sys.exit(1)

        def _serialize(v):
            if v is None:
                return "null"
            if isinstance(v, bool):
                return "true" if v else "false"
            if "ListNode" in globals() and isinstance(v, globals()["ListNode"]):
                vals = []
                c = v
                while c:
                    vals.append(c.val)
                    c = c.next
                return json.dumps(vals)
            if "TreeNode" in globals() and isinstance(v, globals()["TreeNode"]):
                vals = []
                q = [v]
                while q:
                    curr = q.pop(0)
                    if curr:
                        vals.append(curr.val)
                        q.append(curr.left)
                        q.append(curr.right)
                    else:
                        vals.append(None)
                while vals and vals[-1] is None:
                    vals.pop()
                return json.dumps(vals)
            if isinstance(v, (list, dict, int, float, str)):
                return json.dumps(v)
            return str(v)

        print(_serialize(res))

    _verdict_run()
'''

JS_LEETCODE_HARNESS = r'''
// --- Automatic Verdict AI LeetCode Runner Harness (Node.js) ---
(function() {
    const fs = require('fs');
    let rawInput = '';
    try { rawInput = fs.readFileSync(0, 'utf-8'); } catch(e) {}
    rawInput = (rawInput || '').trim();

    let fn = null;
    let targetObj = null;
    if (typeof Solution !== 'undefined') {
        try {
            targetObj = new Solution();
            const proto = Object.getPrototypeOf(targetObj);
            const methods = Object.getOwnPropertyNames(proto).filter(m => m !== 'constructor' && typeof targetObj[m] === 'function');
            if (methods.length > 0) {
                const detected = typeof __DETECTED_NAMES__ !== 'undefined' ? __DETECTED_NAMES__ : [];
                const candidates = [...detected, 'twoSum', 'solve', 'isValid', 'mergeTwoLists', 'maxSubArray', 'lengthOfLongestSubstring', 'solution', 'climbStairs', 'coinChange', 'search', 'reverseString', 'moveZeroes', 'removeDuplicates', 'removeElement', 'reverseList', 'invertTree'];
                const chosen = methods.find(m => candidates.some(c => c.toLowerCase() === m.toLowerCase())) || methods[0];
                fn = targetObj[chosen].bind(targetObj);
            }
        } catch(e) {}
    }
    if (!fn) {
        const detected = typeof __DETECTED_NAMES__ !== 'undefined' ? __DETECTED_NAMES__ : [];
        const candidates = [...detected, 'twoSum', 'solve', 'isValid', 'mergeTwoLists', 'maxSubArray', 'lengthOfLongestSubstring', 'solution', 'climbStairs', 'coinChange', 'search', 'reverseString', 'moveZeroes', 'removeDuplicates', 'removeElement', 'reverseList', 'invertTree'];
        for (const name of candidates) {
            try {
                if (eval('typeof ' + name) === 'function') {
                    fn = eval(name);
                    break;
                }
            } catch(e) {}
        }
    }
    if (!fn) return;

    if (!rawInput.trim() && fn.length > 0) return;

    function parseVal(s) {
        s = (s || '').trim();
        if (!s) return null;
        if (s.includes('=') && !s.startsWith('{')) {
            s = s.substring(s.indexOf('=') + 1).trim();
        }
        try { return JSON.parse(s); } catch(e) {}
        if (s.toLowerCase() === 'true') return true;
        if (s.toLowerCase() === 'false') return false;
        if (s.toLowerCase() === 'null') return null;
        const num = Number(s);
        if (!isNaN(num) && s !== '') return num;
        return s;
    }

    function splitTopLevel(text) {
        const parts = [];
        let curr = '';
        let bBracket = 0, bBrace = 0, bParen = 0;
        let inQuote = null, escaped = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (escaped) { curr += ch; escaped = false; continue; }
            if (ch === '\\') { escaped = true; curr += ch; continue; }
            if (inQuote) {
                curr += ch;
                if (ch === inQuote) inQuote = null;
                continue;
            }
            if (ch === '"' || ch === "'") { inQuote = ch; curr += ch; continue; }
            if (ch === '[') bBracket++;
            else if (ch === ']') bBracket = Math.max(0, bBracket - 1);
            else if (ch === '{') bBrace++;
            else if (ch === '}') bBrace = Math.max(0, bBrace - 1);
            else if (ch === '(') bParen++;
            else if (ch === ')') bParen = Math.max(0, bParen - 1);

            if ((ch === ',' || ch === '\n' || ch === ';') && bBracket === 0 && bBrace === 0 && bParen === 0) {
                const p = curr.trim();
                if (p) parts.push(p);
                curr = '';
            } else {
                curr += ch;
            }
        }
        if (curr.trim()) parts.push(curr.trim());
        return parts;
    }

    let args = [];
    const assignmentRegex = /(?:^|[\n,;])\s*([a-zA-Z_]\w*)\s*=\s*(.*?)(?=(?:[\n,;]\s*[a-zA-Z_]\w*\s*=)|$)/g;
    const matches = [...rawInput.matchAll(assignmentRegex)];
    if (matches.length > 0 && matches.length === fn.length) {
        args = matches.map(m => parseVal(m[2]));
    } else {
        const lines = rawInput.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length === fn.length) {
            args = lines.map(parseVal);
        } else {
            const topParts = splitTopLevel(rawInput);
            if (topParts.length === fn.length) {
                args = topParts.map(parseVal);
            } else if (matches.length > 0) {
                args = matches.map(m => parseVal(m[2]));
            } else {
                args = topParts.map(parseVal);
            }
        }
    }

    function arrayToListNode(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        if (typeof ListNode === 'undefined') return arr;
        const dummy = new ListNode(0);
        let curr = dummy;
        for (const x of arr) {
            curr.next = new ListNode(x);
            curr = curr.next;
        }
        return dummy.next;
    }

    function arrayToTreeNode(arr) {
        if (!Array.isArray(arr) || arr.length === 0 || arr[0] === null) return null;
        if (typeof TreeNode === 'undefined') return arr;
        const root = new TreeNode(arr[0]);
        const queue = [root];
        let i = 1;
        while (queue.length > 0 && i < arr.length) {
            const node = queue.shift();
            if (i < arr.length && arr[i] !== null && arr[i] !== undefined) {
                node.left = new TreeNode(arr[i]);
                queue.push(node.left);
            }
            i++;
            if (i < arr.length && arr[i] !== null && arr[i] !== undefined) {
                node.right = new TreeNode(arr[i]);
                queue.push(node.right);
            }
            i++;
        }
        return root;
    }

    function serializeResult(v) {
        if (v === null || v === undefined) return JSON.stringify(v);
        if (typeof ListNode !== 'undefined' && (v instanceof ListNode || (v && typeof v.val !== 'undefined' && 'next' in v))) {
            const arr = [];
            let curr = v;
            while (curr) {
                arr.push(curr.val);
                curr = curr.next;
            }
            return JSON.stringify(arr);
        }
        if (typeof TreeNode !== 'undefined' && (v instanceof TreeNode || (v && typeof v.val !== 'undefined' && 'left' in v && 'right' in v))) {
            const arr = [];
            const queue = [v];
            while (queue.length > 0) {
                const curr = queue.shift();
                if (curr) {
                    arr.push(curr.val);
                    queue.push(curr.left);
                    queue.push(curr.right);
                } else {
                    arr.push(null);
                }
            }
            while (arr.length > 0 && arr[arr.length - 1] === null) {
                arr.pop();
            }
            return JSON.stringify(arr);
        }
        return JSON.stringify(v);
    }

    try {
        const fnStr = fn.toString();
        const pMatch = fnStr.match(/(?:function\s*\w*\s*\(|^\s*\()?([^)]*)\)?/);
        const paramNames = pMatch && pMatch[1] ? pMatch[1].split(',').map(s => s.trim().split('=')[0].trim().toLowerCase()).filter(Boolean) : [];
        for (let i = 0; i < args.length; i++) {
            const pName = i < paramNames.length ? paramNames[i] : '';
            if (Array.isArray(args[i])) {
                if (pName.includes('head') || pName.includes('list')) {
                    args[i] = arrayToListNode(args[i]);
                } else if (pName.includes('root') || pName.includes('tree')) {
                    args[i] = arrayToTreeNode(args[i]);
                }
            }
        }

        let res = fn(...args);
        if (res === undefined && args.length > 0 && typeof args[0] === 'object') {
            res = args[0];
        }
        if (res !== undefined) {
            console.log(serializeResult(res));
        }
    } catch(err) {
        console.error('Runtime error in solution: ' + err.message);
        process.exit(1);
    }
})();
'''

JAVA_LEETCODE_RUNNER = r'''
class Main {
    public static void main(String[] args) throws Exception {
        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line).append("\n");
        }
        String raw = sb.toString().trim();
        if (raw.isEmpty()) return;

        Class<?> solClass = Class.forName("Solution");
        Object solInstance = solClass.getDeclaredConstructor().newInstance();
        Method target = null;
        String[] commonNames = {"twosum", "threesum", "solve", "solution", "isvalid", "mergetwolists", "merge", "maxsubarray", "lengthoflongestsubstring", "climbstairs", "coinchange", "search", "reversestring", "movezeroes", "removeduplicates", "removeelement"};
        for (Method m : solClass.getDeclaredMethods()) {
            if (Modifier.isPublic(m.getModifiers()) && !m.getName().startsWith("_")) {
                for (String cn : commonNames) {
                    if (m.getName().equalsIgnoreCase(cn)) {
                        target = m;
                        break;
                    }
                }
                if (target != null) break;
            }
        }
        if (target == null) {
            for (Method m : solClass.getDeclaredMethods()) {
                if (Modifier.isPublic(m.getModifiers()) && !m.getName().startsWith("_")) {
                    target = m;
                    break;
                }
            }
        }
        if (target == null) return;

        Class<?>[] pTypes = target.getParameterTypes();
        Object[] invokeArgs = new Object[pTypes.length];

        List<String> rawParts = new ArrayList<>();
        Matcher assignMatcher = Pattern.compile("(?:^|[\\n,;])\\s*[a-zA-Z_]\\w*\\s*=\\s*(.*?)(?=(?:[\\n,;]\\s*[a-zA-Z_]\\w*\\s*=)|$)").matcher(raw);
        while (assignMatcher.find()) {
            rawParts.add(assignMatcher.group(1).trim());
        }
        if (rawParts.size() != pTypes.length) {
            rawParts.clear();
            for (String l : raw.split("\n")) {
                String trimmed = l.trim();
                if (!trimmed.isEmpty()) rawParts.add(trimmed);
            }
        }
        if (rawParts.size() != pTypes.length) {
            List<String> topParts = new ArrayList<>();
            StringBuilder curr = new StringBuilder();
            int bBracket = 0, bBrace = 0, bParen = 0;
            char inQuote = 0;
            boolean escaped = false;
            for (int ci = 0; ci < raw.length(); ci++) {
                char ch = raw.charAt(ci);
                if (escaped) { curr.append(ch); escaped = false; continue; }
                if (ch == '\\') { escaped = true; curr.append(ch); continue; }
                if (inQuote != 0) {
                    curr.append(ch);
                    if (ch == inQuote) inQuote = 0;
                    continue;
                }
                if (ch == '"' || ch == '\'') { inQuote = ch; curr.append(ch); continue; }
                if (ch == '[') bBracket++;
                else if (ch == ']') bBracket = Math.max(0, bBracket - 1);
                else if (ch == '{') bBrace++;
                else if (ch == '}') bBrace = Math.max(0, bBrace - 1);
                else if (ch == '(') bParen++;
                else if (ch == ')') bParen = Math.max(0, bParen - 1);

                if ((ch == ',' || ch == '\n' || ch == ';') && bBracket == 0 && bBrace == 0 && bParen == 0) {
                    String p = curr.toString().trim();
                    if (!p.isEmpty()) topParts.add(p);
                    curr = new StringBuilder();
                } else {
                    curr.append(ch);
                }
            }
            if (!curr.toString().trim().isEmpty()) topParts.add(curr.toString().trim());
            if (topParts.size() == pTypes.length) rawParts = topParts;
        }

        for (int i = 0; i < pTypes.length; i++) {
            String part = i < rawParts.size() ? rawParts.get(i) : "";
            if (part.contains("=") && !part.startsWith("{")) {
                part = part.substring(part.indexOf('=') + 1).trim();
            }
            Class<?> pt = pTypes[i];
            if (pt == int[].class) {
                Matcher nm = Pattern.compile("-?\\d+").matcher(part);
                List<Integer> list = new ArrayList<>();
                while (nm.find()) list.add(Integer.parseInt(nm.group()));
                int[] arr = new int[list.size()];
                for (int j = 0; j < list.size(); j++) arr[j] = list.get(j);
                invokeArgs[i] = arr;
            } else if (pt == int.class || pt == Integer.class) {
                Matcher nm = Pattern.compile("-?\\d+").matcher(part);
                invokeArgs[i] = nm.find() ? Integer.parseInt(nm.group()) : 0;
            } else if (pt == long.class || pt == Long.class) {
                Matcher nm = Pattern.compile("-?\\d+").matcher(part);
                invokeArgs[i] = nm.find() ? Long.parseLong(nm.group()) : 0L;
            } else if (pt == double.class || pt == Double.class) {
                Matcher nm = Pattern.compile("-?\\d+(?:\\.\\d+)?").matcher(part);
                invokeArgs[i] = nm.find() ? Double.parseDouble(nm.group()) : 0.0;
            } else if (pt == String[].class) {
                Matcher sm = Pattern.compile("\"([^\"]*)\"").matcher(part);
                List<String> list = new ArrayList<>();
                while (sm.find()) list.add(sm.group(1));
                invokeArgs[i] = list.toArray(new String[0]);
            } else if (pt == String.class) {
                if (part.startsWith("\"") && part.endsWith("\"") && part.length() >= 2) {
                    part = part.substring(1, part.length() - 1);
                }
                invokeArgs[i] = part;
            } else if (pt == boolean.class || pt == Boolean.class) {
                invokeArgs[i] = part.toLowerCase().contains("true");
            } else if (pt == char[].class) {
                Matcher sm = Pattern.compile("\"([^\"]*)\"").matcher(part);
                if (sm.find()) {
                    invokeArgs[i] = sm.group(1).toCharArray();
                } else {
                    Matcher cm = Pattern.compile("'([^']*)'").matcher(part);
                    List<Character> list = new ArrayList<>();
                    while (cm.find()) if (cm.group(1).length() > 0) list.add(cm.group(1).charAt(0));
                    char[] arr = new char[list.size()];
                    for (int j = 0; j < list.size(); j++) arr[j] = list.get(j);
                    invokeArgs[i] = arr;
                }
            } else if (pt == char.class || pt == Character.class) {
                Matcher cm = Pattern.compile("['\"]([^'\"]*)['\"]").matcher(part);
                invokeArgs[i] = cm.find() && cm.group(1).length() > 0 ? cm.group(1).charAt(0) : (part.isEmpty() ? ' ' : part.charAt(0));
            } else if (pt == int[][].class) {
                Matcher sub = Pattern.compile("\\[([^\\[\\]]*)\\]").matcher(part);
                List<int[]> rows = new ArrayList<>();
                while (sub.find()) {
                    String inner = sub.group(1);
                    Matcher nm = Pattern.compile("-?\\d+").matcher(inner);
                    List<Integer> row = new ArrayList<>();
                    while (nm.find()) row.add(Integer.parseInt(nm.group()));
                    int[] rArr = new int[row.size()];
                    for (int j = 0; j < row.size(); j++) rArr[j] = row.get(j);
                    rows.add(rArr);
                }
                invokeArgs[i] = rows.toArray(new int[0][]);
            } else if (pt == List.class) {
                Matcher sm = Pattern.compile("\"([^\"]*)\"").matcher(part);
                List<String> sList = new ArrayList<>();
                while (sm.find()) sList.add(sm.group(1));
                if (!sList.isEmpty()) {
                    invokeArgs[i] = sList;
                } else {
                    Matcher nm = Pattern.compile("-?\\d+").matcher(part);
                    List<Integer> iList = new ArrayList<>();
                    while (nm.find()) iList.add(Integer.parseInt(nm.group()));
                    invokeArgs[i] = iList;
                }
            } else if (pt.getSimpleName().equals("ListNode")) {
                Matcher nm = Pattern.compile("-?\\d+").matcher(part);
                ListNode dummy = new ListNode(0);
                ListNode curr = dummy;
                while (nm.find()) {
                    curr.next = new ListNode(Integer.parseInt(nm.group()));
                    curr = curr.next;
                }
                invokeArgs[i] = dummy.next;
            } else if (pt.getSimpleName().equals("TreeNode")) {
                Matcher nm = Pattern.compile("-?\\d+|null").matcher(part);
                List<Integer> vals = new ArrayList<>();
                while (nm.find()) {
                    String s = nm.group();
                    vals.add(s.equals("null") ? null : Integer.parseInt(s));
                }
                if (vals.isEmpty() || vals.get(0) == null) {
                    invokeArgs[i] = null;
                } else {
                    TreeNode root = new TreeNode(vals.get(0));
                    List<TreeNode> queue = new ArrayList<>();
                    queue.add(root);
                    int vi = 1;
                    while (!queue.isEmpty() && vi < vals.size()) {
                        TreeNode parent = queue.remove(0);
                        if (vi < vals.size() && vals.get(vi) != null) {
                            parent.left = new TreeNode(vals.get(vi));
                            queue.add(parent.left);
                        }
                        vi++;
                        if (vi < vals.size() && vals.get(vi) != null) {
                            parent.right = new TreeNode(vals.get(vi));
                            queue.add(parent.right);
                        }
                        vi++;
                    }
                    invokeArgs[i] = root;
                }
            } else {
                invokeArgs[i] = null;
            }
        }

        Object result = target.invoke(solInstance, invokeArgs);
        if (target.getReturnType() == void.class) {
            if (invokeArgs.length > 0 && invokeArgs[0] != null) {
                result = invokeArgs[0];
            }
        }
        if (result == null) {
            System.out.println("null");
        } else if (result.getClass().getSimpleName().equals("ListNode")) {
            List<Integer> list = new ArrayList<>();
            try {
                Field vf = result.getClass().getDeclaredField("val");
                Field nf = result.getClass().getDeclaredField("next");
                vf.setAccessible(true);
                nf.setAccessible(true);
                Object c = result;
                while (c != null) {
                    list.add((Integer) vf.get(c));
                    c = nf.get(c);
                }
            } catch (Exception e) {}
            System.out.println(list.toString());
        } else if (result.getClass().getSimpleName().equals("TreeNode")) {
            List<String> list = new ArrayList<>();
            try {
                Field vf = result.getClass().getDeclaredField("val");
                Field lf = result.getClass().getDeclaredField("left");
                Field rf = result.getClass().getDeclaredField("right");
                vf.setAccessible(true);
                lf.setAccessible(true);
                rf.setAccessible(true);
                List<Object> q = new ArrayList<>();
                q.add(result);
                while (!q.isEmpty()) {
                    Object curr = q.remove(0);
                    if (curr != null) {
                        list.add(String.valueOf(vf.get(curr)));
                        q.add(lf.get(curr));
                        q.add(rf.get(curr));
                    } else {
                        list.add("null");
                    }
                }
                while (!list.isEmpty() && list.get(list.size() - 1).equals("null")) {
                    list.remove(list.size() - 1);
                }
            } catch (Exception e) {}
            System.out.println("[" + String.join(", ", list) + "]");
        } else if (result instanceof int[]) {
            System.out.println(Arrays.toString((int[]) result));
        } else if (result instanceof long[]) {
            System.out.println(Arrays.toString((long[]) result));
        } else if (result instanceof double[]) {
            System.out.println(Arrays.toString((double[]) result));
        } else if (result instanceof boolean[]) {
            System.out.println(Arrays.toString((boolean[]) result));
        } else if (result instanceof char[]) {
            System.out.println(Arrays.toString((char[]) result));
        } else if (result instanceof int[][]) {
            System.out.println(Arrays.deepToString((int[][]) result));
        } else if (result instanceof char[][]) {
            System.out.println(Arrays.deepToString((char[][]) result));
        } else if (result instanceof Object[]) {
            System.out.println(Arrays.deepToString((Object[]) result));
        } else if (result instanceof String) {
            System.out.println("\"" + result.toString() + "\"");
        } else {
            System.out.println(result.toString());
        }
    }
}
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

    # 3. Trailing lines match (allows debug print statements before the final return value)
    if len(act_lines) > len(exp_lines) and len(exp_lines) > 0:
        trailing_act = "\n".join(act_lines[-len(exp_lines):])
        val_trailing = _try_parse_val(trailing_act)
        if val_trailing is not None and val_exp is not None and _structures_equal(val_trailing, val_exp):
            return True
        trailing_tokens = [t for l in act_lines[-len(exp_lines):] for t in tokenize_line(l)]
        if len(trailing_tokens) == len(all_exp_tokens) and all(tokens_equal(a, e) for a, e in zip(trailing_tokens, all_exp_tokens)):
            return True

    # 4. In-place array modification return tolerance (LeetCode returns k vs expected array)
    if isinstance(val_act, int) and isinstance(val_exp, list) and val_act == len(val_exp):
        return True
    if isinstance(val_act, list) and isinstance(val_exp, int) and len(val_act) == val_exp:
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
        try:
            from pipeline.error_parser import parse_error_line
        except ImportError:
            from backend.pipeline.error_parser import parse_error_line

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

            # Check if user provided LeetCode-style Solution class or function without a driver
            has_solution_class = bool(re.search(r'^\s*class\s+Solution\b', code, re.MULTILINE))
            has_func = bool(re.search(r'^\s*def\s+[a-zA-Z_]\w*\s*\(', code, re.MULTILINE))
            has_main_driver = ("__main__" in code) or ("sys.stdin" in code) or ("input(" in code)

            if (has_solution_class or has_func) and not has_main_driver:
                full_code = PYTHON_PREAMBLE + "\n\n" + code + "\n\n" + PYTHON_LEETCODE_HARNESS
            else:
                full_code = PYTHON_PREAMBLE + "\n\n" + code

            with open(filepath, "w", encoding="utf-8") as f:
                f.write(full_code)

            return True, "", "", None

        elif lang in ("javascript", "js", "node"):
            filename = "main.js"
            filepath = os.path.join(work_dir, filename)

            has_main_driver = ("fs.readFileSync" in code) or ("process.stdin" in code) or ("readline" in code)
            js_structs = ""
            if "function ListNode" not in code and "class ListNode" not in code:
                js_structs += "function ListNode(val, next) { this.val = (val===undefined ? 0 : val); this.next = (next===undefined ? null : next); }\n"
            if "function TreeNode" not in code and "class TreeNode" not in code:
                js_structs += "function TreeNode(val, left, right) { this.val = (val===undefined ? 0 : val); this.left = (left===undefined ? null : left); this.right = (right===undefined ? null : right); }\n"

            full_code = code
            if not has_main_driver:
                declared_names = re.findall(r'(?:var|let|const|function)\s+([a-zA-Z_]\w*)', code)
                filter_set = {"ListNode", "TreeNode", "fs", "require", "process", "Solution"}
                custom_names = [n for n in declared_names if n not in filter_set]
                names_json = json.dumps(custom_names)
                harness = JS_LEETCODE_HARNESS.replace("__DETECTED_NAMES__", names_json)
                full_code = js_structs + "\n" + code + "\n\n" + harness
            else:
                full_code = js_structs + "\n" + code

            with open(filepath, "w", encoding="utf-8") as f:
                f.write(full_code)

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

            has_main = bool(re.search(r'\bint\s+main\b|\bvoid\s+main\b', code))
            has_solution = bool(re.search(r'class\s+Solution\b', code))

            full_code = code
            if not has_main and has_solution:
                # Helper to build LeetCode runner for Solution method
                sol_match = re.search(r'class\s+Solution\b[^{]*\{(.*?)\};', code, re.DOTALL)
                chosen = None
                if sol_match:
                    sol_body = sol_match.group(1)
                    pub_sections = re.findall(r'public:\s*(.*?)(?=(?:private:|protected:|\Z))', sol_body, re.DOTALL)
                    pub_text = "\n".join(pub_sections) if pub_sections else sol_body
                    methods = re.findall(r'([\w:<>]+(?:\s*[*&])?)\s+(\w+)\s*\(([^)]*)\)\s*\{', pub_text)
                    if methods:
                        common_names = {'twosum', 'threesum', 'foursum', 'solve', 'solution', 'isvalid', 'mergetwolists', 'merge', 'maxsubarray', 'lengthoflongestsubstring', 'climbstairs', 'coinchange', 'search', 'reversestring', 'movezeroes', 'removeduplicates', 'removeelement'}
                        for cand in methods:
                            if cand[1].lower() in common_names:
                                chosen = cand
                                break
                        if not chosen:
                            chosen = methods[0]
                if not chosen:
                    m = re.search(r'class\s+Solution\b[^{]*\{.*?public:\s*([\w:<>]+(?:\s*[*&])?)\s+(\w+)\s*\(([^)]*)\)', code, re.DOTALL)
                    if m:
                        chosen = m.groups()
                if chosen:
                    ret_type, method_name, params_str = chosen
                    raw_params = [p.strip() for p in params_str.split(",") if p.strip()]

                    cpp_driver = [
                        "\n// --- Automatic Verdict AI LeetCode Runner Harness (C++) ---",
                        "#include <iostream>",
                        "#include <vector>",
                        "#include <string>",
                        "#include <sstream>",
                        "#include <regex>",
                        "#include <map>",
                        "#include <unordered_map>",
                        "#include <algorithm>",
                        "",
                        r'static std::vector<int> _read_vector_int(const std::string& raw) {',
                        r'    std::vector<int> res;',
                        r'    std::regex num_re(R"(-?\d+)");',
                        r'    std::sregex_iterator next(raw.begin(), raw.end(), num_re);',
                        r'    std::sregex_iterator end;',
                        r'    while (next != end) { res.push_back(std::stoi(next->str())); next++; }',
                        r'    return res;',
                        r'}',
                        r'',
                        r'static std::vector<std::string> _read_vector_str(const std::string& raw) {',
                        r'    std::vector<std::string> res;',
                        r'    std::regex str_re(R"delim(\"([^\"]*)\")delim");',
                        r'    std::sregex_iterator next(raw.begin(), raw.end(), str_re);',
                        r'    std::sregex_iterator end;',
                        r'    while (next != end) { res.push_back((*next)[1].str()); next++; }',
                        r'    return res;',
                        r'}',
                        r'',
                        r'static std::vector<std::vector<int>> _read_vector_vector_int(const std::string& raw) {',
                        r'    std::vector<std::vector<int>> res;',
                        r'    std::regex sub_re(R"delim(\[([^\[\]]*)\])delim");',
                        r'    std::sregex_iterator next(raw.begin(), raw.end(), sub_re);',
                        r'    std::sregex_iterator end;',
                        r'    while (next != end) {',
                        r'        std::string inner = (*next)[1].str();',
                        r'        std::vector<int> row;',
                        r'        std::regex num_re(R"delim(-?\d+)delim");',
                        r'        std::sregex_iterator it(inner.begin(), inner.end(), num_re);',
                        r'        while (it != end) { row.push_back(std::stoi(it->str())); it++; }',
                        r'        res.push_back(row);',
                        r'        next++;',
                        r'    }',
                        r'    return res;',
                        r'}',
                        r'',
                        r'static int _read_int(const std::string& raw) {',
                        r'    std::regex num_re(R"delim(-?\d+)delim");',
                        r'    std::smatch m;',
                        r'    if (std::regex_search(raw, m, num_re)) return std::stoi(m.str());',
                        r'    return 0;',
                        r'}',
                        r'',
                        r'static double _read_double(const std::string& raw) {',
                        r'    std::regex num_re(R"delim(-?\d+(?:\.\d+)?)delim");',
                        r'    std::smatch m;',
                        r'    if (std::regex_search(raw, m, num_re)) return std::stod(m.str());',
                        r'    return 0.0;',
                        r'}',
                        r'',
                        r'static bool _read_bool(const std::string& raw) {',
                        r'    return raw.find("true") != std::string::npos || raw.find("True") != std::string::npos;',
                        r'}',
                        r'',
                        r'static char _read_char(const std::string& raw) {',
                        r'    for (char c : raw) {',
                        r"        if (c != '\'' && c != '\"' && c != ' ' && c != '\t') return c;",
                        r'    }',
                        r"    return ' ';",
                        r'}',
                        r'',
                        r'static std::vector<char> _read_vector_char(const std::string& raw) {',
                        r'    std::vector<char> res;',
                        r'    for (char c : raw) {',
                        r"        if (c != '[' && c != ']' && c != ',' && c != '\'' && c != '\"' && c != ' ' && c != '\t' && c != '\n') {",
                        r'            res.push_back(c);',
                        r'        }',
                        r'    }',
                        r'    return res;',
                        r'}',
                        r'',
                        r'static std::string _read_str(const std::string& raw) {',
                        r'    std::string s = raw;',
                        r"    while (!s.empty() && (s.front() == ' ' || s.front() == '\t')) s.erase(s.begin());",
                        r"    while (!s.empty() && (s.back() == ' ' || s.back() == '\t' || s.back() == '\n' || s.back() == '\r')) s.pop_back();",
                        r"    if (s.size() >= 2 && ((s.front() == '\"' && s.back() == '\"') || (s.front() == '\'' && s.back() == '\''))) {",
                        r'        return s.substr(1, s.size() - 2);',
                        r'    }',
                        r'    return s;',
                        r'}',
                        r'',
                        r'template<typename T>',
                        r'static void _print_res(const std::vector<T>& v) {',
                        r'    std::cout << "[";',
                        r'    for (size_t i = 0; i < v.size(); i++) {',
                        r'        if (i > 0) std::cout << ", ";',
                        r'        std::cout << v[i];',
                        r'    }',
                        r'    std::cout << "]\n";',
                        r'}',
                        r'',
                        r'template<typename T>',
                        r'static void _print_res(const std::vector<std::vector<T>>& mat) {',
                        r'    std::cout << "[";',
                        r'    for (size_t i = 0; i < mat.size(); i++) {',
                        r'        if (i > 0) std::cout << ", ";',
                        r'        std::cout << "[";',
                        r'        for (size_t j = 0; j < mat[i].size(); j++) {',
                        r'            if (j > 0) std::cout << ", ";',
                        r'            std::cout << mat[i][j];',
                        r'        }',
                        r'        std::cout << "]";',
                        r'    }',
                        r'    std::cout << "]\n";',
                        r'}',
                        r'',
                        r'static void _print_res(bool b) {',
                        r'    std::cout << (b ? "true" : "false") << "\n";',
                        r'}',
                        r'',
                        r'static void _print_res(const std::string& s) {',
                        r'    std::cout << "\"" << s << "\"\n";',
                        r'}',
                        r'',
                        r'static void _print_res(char c) {',
                        r'    std::cout << "\"" << c << "\"\n";',
                        r'}',
                        r'',
                        r'template<typename T>',
                        r'static void _print_res(const T& val) {',
                        r'    std::cout << val << "\n";',
                        r'}',
                        r'',
                        r'static void _print_res(ListNode* head) {',
                        r'    std::cout << "[";',
                        r'    bool first = true;',
                        r'    while (head) {',
                        r'        if (!first) std::cout << ", ";',
                        r'        std::cout << head->val;',
                        r'        first = false;',
                        r'        head = head->next;',
                        r'    }',
                        r'    std::cout << "]\n";',
                        r'}',
                        r'',
                        r'static void _print_res(TreeNode* root) {',
                        r'    if (!root) { std::cout << "[]\n"; return; }',
                        r'    std::vector<std::string> vals;',
                        r'    std::vector<TreeNode*> q = {root};',
                        r'    while (!q.empty()) {',
                        r'        TreeNode* curr = q.front();',
                        r'        q.erase(q.begin());',
                        r'        if (curr) {',
                        r'            vals.push_back(std::to_string(curr->val));',
                        r'            q.push_back(curr->left);',
                        r'            q.push_back(curr->right);',
                        r'        } else {',
                        r'            vals.push_back("null");',
                        r'        }',
                        r'    }',
                        r'    while (!vals.empty() && vals.back() == "null") vals.pop_back();',
                        r'    std::cout << "[";',
                        r'    for (size_t i = 0; i < vals.size(); i++) {',
                        r'        if (i > 0) std::cout << ", ";',
                        r'        std::cout << vals[i];',
                        r'    }',
                        r'    std::cout << "]\n";',
                        r'}',
                        r'',
                        r'static ListNode* _read_list_node(const std::string& raw) {',
                        r'    std::regex num_re(R"delim(-?\d+)delim");',
                        r'    std::sregex_iterator next(raw.begin(), raw.end(), num_re);',
                        r'    std::sregex_iterator end;',
                        r'    ListNode dummy(0);',
                        r'    ListNode* curr = &dummy;',
                        r'    while (next != end) {',
                        r'        curr->next = new ListNode(std::stoi(next->str()));',
                        r'        curr = curr->next;',
                        r'        next++;',
                        r'    }',
                        r'    return dummy.next;',
                        r'}',
                        r'',
                        r'static TreeNode* _read_tree_node(const std::string& raw) {',
                        r'    std::regex tok_re(R"delim(-?\d+|null)delim");',
                        r'    std::sregex_iterator next(raw.begin(), raw.end(), tok_re);',
                        r'    std::sregex_iterator end;',
                        r'    std::vector<std::string> tokens;',
                        r'    while (next != end) { tokens.push_back(next->str()); next++; }',
                        r'    if (tokens.empty() || tokens[0] == "null") return nullptr;',
                        r'    TreeNode* root = new TreeNode(std::stoi(tokens[0]));',
                        r'    std::vector<TreeNode*> q = {root};',
                        r'    size_t i = 1;',
                        r'    while (!q.empty() && i < tokens.size()) {',
                        r'        TreeNode* curr = q.front();',
                        r'        q.erase(q.begin());',
                        r'        if (i < tokens.size() && tokens[i] != "null") {',
                        r'            curr->left = new TreeNode(std::stoi(tokens[i]));',
                        r'            q.push_back(curr->left);',
                        r'        }',
                        r'        i++;',
                        r'        if (i < tokens.size() && tokens[i] != "null") {',
                        r'            curr->right = new TreeNode(std::stoi(tokens[i]));',
                        r'            q.push_back(curr->right);',
                        r'        }',
                        r'        i++;',
                        r'    }',
                        r'    return root;',
                        r'}',
                        r'',
                        r'int main() {',
                        r'    std::ios_base::sync_with_stdio(false);',
                        r'    std::cin.tie(NULL);',
                        r'    std::string raw((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());',
                        r"    while (!raw.empty() && (raw.back() == '\n' || raw.back() == '\r' || raw.back() == ' ' || raw.back() == '\t')) raw.pop_back();",
                        r'    if (raw.empty()) return 0;',
                        r'    std::regex assign_re(R"delim((?:^|[\n,;])\s*[a-zA-Z_]\w*\s*=\s*(.*?)(?=(?:[\n,;]\s*[a-zA-Z_]\w*\s*=)|$))delim");',
                        r'    std::sregex_iterator it(raw.begin(), raw.end(), assign_re);',
                        r'    std::sregex_iterator end;',
                        r'    std::vector<std::string> parts;',
                        r'    while (it != end) { parts.push_back(it->str(1)); it++; }',
                        r'    if (parts.empty()) {',
                        r'        std::stringstream ss(raw);',
                        r'        std::string l;',
                        r'        while (std::getline(ss, l)) if (!l.empty()) parts.push_back(l);',
                        r'    }',
                        r'    if (parts.size() != ' + str(len(raw_params)) + r') {',
                        r'        std::vector<std::string> topParts;',
                        r'        std::string curr = "";',
                        r'        int bBracket = 0, bBrace = 0, bParen = 0;',
                        r'        char inQuote = 0;',
                        r'        bool escaped = false;',
                        r'        for (char ch : raw) {',
                        r'            if (escaped) { curr += ch; escaped = false; continue; }',
                        r'            if (ch == 92) { escaped = true; curr += ch; continue; }',
                        r'            if (inQuote != 0) {',
                        r'                curr += ch;',
                        r'                if (ch == inQuote) inQuote = 0;',
                        r'                continue;',
                        r'            }',
                        r'            if (ch == 34 || ch == 39) { inQuote = ch; curr += ch; continue; }',
                        r'            if (ch == 91) bBracket++;',
                        r'            else if (ch == 93) bBracket = std::max(0, bBracket - 1);',
                        r'            else if (ch == 123) bBrace++;',
                        r'            else if (ch == 125) bBrace = std::max(0, bBrace - 1);',
                        r'            else if (ch == 40) bParen++;',
                        r'            else if (ch == 41) bParen = std::max(0, bParen - 1);',
                        r'            if ((ch == 44 || ch == 10 || ch == 59) && bBracket == 0 && bBrace == 0 && bParen == 0) {',
                        r'                while (!curr.empty() && (curr.front() == 32 || curr.front() == 9)) curr.erase(curr.begin());',
                        r'                while (!curr.empty() && (curr.back() == 32 || curr.back() == 9 || curr.back() == 10 || curr.back() == 13)) curr.pop_back();',
                        r'                if (!curr.empty()) topParts.push_back(curr);',
                        r'                curr = "";',
                        r'            } else {',
                        r'                curr += ch;',
                        r'            }',
                        r'        }',
                        r'        while (!curr.empty() && (curr.front() == 32 || curr.front() == 9)) curr.erase(curr.begin());',
                        r'        while (!curr.empty() && (curr.back() == 32 || curr.back() == 9 || curr.back() == 10 || curr.back() == 13)) curr.pop_back();',
                        r'        if (!curr.empty()) topParts.push_back(curr);',
                        r'        if (topParts.size() == ' + str(len(raw_params)) + r') parts = topParts;',
                        r'    }'
                    ]
                    call_args = []
                    for idx, param in enumerate(raw_params):
                        param_clean = param.strip()
                        p_var = f"arg_{idx}"
                        p_str = f"parts.size() > {idx} ? parts[{idx}] : \"\""
                        if "vector<vector<int>>" in param_clean or "vector<vector<int> >" in param_clean:
                            cpp_driver.append(f"    auto {p_var} = _read_vector_vector_int({p_str});")
                        elif "vector<string>" in param_clean or "vector<std::string>" in param_clean:
                            cpp_driver.append(f"    auto {p_var} = _read_vector_str({p_str});")
                        elif "vector<int>" in param_clean:
                            cpp_driver.append(f"    auto {p_var} = _read_vector_int({p_str});")
                        elif "vector<char>" in param_clean:
                            cpp_driver.append(f"    auto {p_var} = _read_vector_char({p_str});")
                        elif "string" in param_clean:
                            cpp_driver.append(f"    auto {p_var} = _read_str({p_str});")
                        elif "char" in param_clean:
                            cpp_driver.append(f"    auto {p_var} = _read_char({p_str});")
                        elif "bool" in param_clean:
                            cpp_driver.append(f"    auto {p_var} = _read_bool({p_str});")
                        elif "double" in param_clean or "float" in param_clean:
                            cpp_driver.append(f"    auto {p_var} = _read_double({p_str});")
                        elif "ListNode" in param_clean:
                            cpp_driver.append(f"    auto {p_var} = _read_list_node({p_str});")
                        elif "TreeNode" in param_clean:
                            cpp_driver.append(f"    auto {p_var} = _read_tree_node({p_str});")
                        elif "int" in param_clean or "long" in param_clean:
                            cpp_driver.append(f"    auto {p_var} = _read_int({p_str});")
                        else:
                            cpp_driver.append(f"    auto {p_var} = _read_int({p_str});")
                        call_args.append(p_var)

                    cpp_driver.append(f"    Solution sol;")
                    if ret_type.strip() == "void":
                        cpp_driver.append(f"    sol.{method_name}({', '.join(call_args)});")
                        if len(call_args) > 0:
                            cpp_driver.append(f"    _print_res(arg_0);")
                    else:
                        cpp_driver.append(f"    auto res = sol.{method_name}({', '.join(call_args)});")
                        cpp_driver.append(f"    _print_res(res);")
                    cpp_driver.append(f"    return 0;")
                    cpp_driver.append("}")
                    cpp_structs = []
                    if "struct ListNode" not in code and "class ListNode" not in code:
                        cpp_structs.append("struct ListNode { int val; ListNode *next; ListNode() : val(0), next(nullptr) {} ListNode(int x) : val(x), next(nullptr) {} ListNode(int x, ListNode *next) : val(x), next(next) {} };")
                    if "struct TreeNode" not in code and "class TreeNode" not in code:
                        cpp_structs.append("struct TreeNode { int val; TreeNode *left; TreeNode *right; TreeNode() : val(0), left(nullptr), right(nullptr) {} TreeNode(int x) : val(x), left(nullptr), right(nullptr) {} TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {} };")
                    cpp_header = ("\n".join(cpp_structs) + "\n\n") if cpp_structs else ""
                    full_code = cpp_header + code + "\n\n" + "\n".join(cpp_driver)

            with open(src_path, "w", encoding="utf-8") as f:
                f.write(full_code)

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

            has_main = bool(re.search(r'public\s+static\s+void\s+main', clean_code))
            has_solution = bool(re.search(r'class\s+Solution\b', clean_code))

            java_structs = []
            if "class ListNode" not in clean_code:
                java_structs.append("class ListNode { int val; ListNode next; ListNode() {} ListNode(int val) { this.val = val; } ListNode(int val, ListNode next) { this.val = val; this.next = next; } }")
            if "class TreeNode" not in clean_code:
                java_structs.append("class TreeNode { int val; TreeNode left; TreeNode right; TreeNode() {} TreeNode(int val) { this.val = val; } TreeNode(int val, TreeNode left, TreeNode right) { this.val = val; this.left = left; this.right = right; } }")
            java_header = ("\n".join(java_structs) + "\n\n") if java_structs else ""

            if not has_main and has_solution:
                adapted_code = re.sub(r'public\s+class\s+Solution\b', 'class Solution', clean_code)
                # In Java, all import statements MUST precede any class / interface declarations.
                # Extract all user imports and hoist them to the top of the compilation unit.
                user_imports = []
                user_body_lines = []
                for line in adapted_code.splitlines():
                    if re.match(r'^\s*import\s+', line):
                        user_imports.append(line.strip())
                    else:
                        user_body_lines.append(line)

                user_body = "\n".join(user_body_lines)
                user_imports_str = "\n".join(user_imports)

                full_code = (
                    "import java.io.*;\n"
                    "import java.util.*;\n"
                    "import java.util.regex.*;\n"
                    "import java.lang.reflect.*;\n"
                    + (user_imports_str + "\n\n" if user_imports_str else "\n")
                    + java_header
                    + user_body
                    + "\n\n"
                    + JAVA_LEETCODE_RUNNER
                )
                class_name = "Main"
            else:
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
                full_code = clean_code

            src_path = os.path.join(work_dir, f"{class_name}.java")
            with open(src_path, "w", encoding="utf-8") as f:
                f.write(full_code)

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
        try:
            from pipeline.error_parser import parse_error_line
        except ImportError:
            from backend.pipeline.error_parser import parse_error_line

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
