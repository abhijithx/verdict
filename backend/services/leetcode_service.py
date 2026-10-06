"""
services/leetcode_service.py — LeetCode GraphQL Client and Problem Importer.

Provides zero-dependency, public integration with LeetCode:
  1. Fetch complete problem details (Title, Difficulty, Content, Code Snippets, Test Cases)
  2. Search and paginate across 4,000+ LeetCode problems via GraphQL
  3. Curated classics catalog (Blind 75 / Top Interview 150)
  4. Clean HTML to Markdown conversion using markdownify
"""

import re
import logging
from typing import Optional, Dict, Any, List
import httpx
from markdownify import markdownify as md

logger = logging.getLogger("LeetCodeService")

LEETCODE_GRAPHQL_URL = "https://leetcode.com/graphql"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

QUESTION_DATA_QUERY = """
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
    content
    difficulty
    exampleTestcases
    sampleTestCase
    codeSnippets {
      langSlug
      lang
      code
    }
    hints
    topicTags {
      name
      slug
    }
  }
}
"""

QUESTION_LIST_QUERY = """
query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    total: totalNum
    questions: data {
      questionFrontendId
      title
      titleSlug
      difficulty
      topicTags {
        name
        slug
      }
    }
  }
}
"""

# Curated classics for instant 1-click loading without searching
CURATED_CLASSICS = [
    {"frontend_id": "1", "title": "Two Sum", "title_slug": "two-sum", "difficulty": "Easy", "tags": ["Array", "Hash Table"]},
    {"frontend_id": "20", "title": "Valid Parentheses", "title_slug": "valid-parentheses", "difficulty": "Easy", "tags": ["String", "Stack"]},
    {"frontend_id": "21", "title": "Merge Two Sorted Lists", "title_slug": "merge-two-sorted-lists", "difficulty": "Easy", "tags": ["Linked List", "Recursion"]},
    {"frontend_id": "3", "title": "Longest Substring Without Repeating Characters", "title_slug": "longest-substring-without-repeating-characters", "difficulty": "Medium", "tags": ["Hash Table", "Sliding Window"]},
    {"frontend_id": "5", "title": "Longest Palindromic Substring", "title_slug": "longest-palindromic-substring", "difficulty": "Medium", "tags": ["Two Pointers", "Dynamic Programming"]},
    {"frontend_id": "15", "title": "3Sum", "title_slug": "3sum", "difficulty": "Medium", "tags": ["Array", "Two Pointers", "Sorting"]},
    {"frontend_id": "42", "title": "Trapping Rain Water", "title_slug": "trapping-rain-water", "difficulty": "Hard", "tags": ["Array", "Two Pointers", "Dynamic Programming", "Stack"]},
    {"frontend_id": "53", "title": "Maximum Subarray", "title_slug": "maximum-subarray", "difficulty": "Medium", "tags": ["Array", "Divide and Conquer", "Dynamic Programming"]},
    {"frontend_id": "70", "title": "Climbing Stairs", "title_slug": "climbing-stairs", "difficulty": "Easy", "tags": ["Math", "Dynamic Programming", "Memoization"]},
    {"frontend_id": "121", "title": "Best Time to Buy and Sell Stock", "title_slug": "best-time-to-buy-and-sell-stock", "difficulty": "Easy", "tags": ["Array", "Dynamic Programming"]},
    {"frontend_id": "146", "title": "LRU Cache", "title_slug": "lru-cache", "difficulty": "Medium", "tags": ["Hash Table", "Linked List", "Design"]},
    {"frontend_id": "200", "title": "Number of Islands", "title_slug": "number-of-islands", "difficulty": "Medium", "tags": ["Array", "DFS", "BFS", "Union Find"]},
    {"frontend_id": "206", "title": "Reverse Linked List", "title_slug": "reverse-linked-list", "difficulty": "Easy", "tags": ["Linked List", "Recursion"]},
    {"frontend_id": "226", "title": "Invert Binary Tree", "title_slug": "invert-binary-tree", "difficulty": "Easy", "tags": ["Tree", "DFS", "BFS", "Binary Tree"]},
    {"frontend_id": "238", "title": "Product of Array Except Self", "title_slug": "product-of-array-except-self", "difficulty": "Medium", "tags": ["Array", "Prefix Sum"]},
    {"frontend_id": "295", "title": "Find Median from Data Stream", "title_slug": "find-median-from-data-stream", "difficulty": "Hard", "tags": ["Heap (Priority Queue)", "Design"]},
    {"frontend_id": "300", "title": "Longest Increasing Subsequence", "title_slug": "longest-increasing-subsequence", "difficulty": "Medium", "tags": ["Array", "Binary Search", "Dynamic Programming"]},
    {"frontend_id": "322", "title": "Coin Change", "title_slug": "coin-change", "difficulty": "Medium", "tags": ["Array", "Dynamic Programming", "BFS"]},
    {"frontend_id": "704", "title": "Binary Search", "title_slug": "binary-search", "difficulty": "Easy", "tags": ["Array", "Binary Search"]},
]


class LeetCodeService:
    """Service to interact with LeetCode GraphQL public endpoints."""

    def __init__(self):
        self._cache: Dict[str, Dict[str, Any]] = {}

    def extract_slug(self, url_or_slug: str) -> str:
        """
        Extract clean problem slug from URL or string.
        Examples:
          - https://leetcode.com/problems/two-sum/ -> two-sum
          - https://leetcode.cn/problems/two-sum -> two-sum
          - two-sum -> two-sum
          - 1. Two Sum -> two-sum
        """
        text = url_or_slug.strip()
        # Check standard URL
        match = re.search(r"leetcode\.(?:com|cn)/problems/([^/?#]+)", text, re.IGNORECASE)
        if match:
            return match.group(1).lower().strip()

        # Remove leading numbers like "1. Two Sum"
        text = re.sub(r"^\d+[\.\s\-]+", "", text)
        slug = re.sub(r"[^a-zA-Z0-9\s\-]", "", text).strip().lower()
        slug = re.sub(r"[\s_]+", "-", slug)
        return slug

    async def fetch_problem(self, url_or_slug: str) -> Dict[str, Any]:
        """
        Fetch full details of a LeetCode problem by URL or slug.
        """
        slug = self.extract_slug(url_or_slug)
        if not slug:
            raise ValueError(f"Could not extract problem slug from '{url_or_slug}'")

        if slug in self._cache:
            return self._cache[slug]

        headers = {
            "User-Agent": USER_AGENT,
            "Referer": f"https://leetcode.com/problems/{slug}/",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            try:
                response = await client.post(
                    LEETCODE_GRAPHQL_URL,
                    json={"query": QUESTION_DATA_QUERY, "variables": {"titleSlug": slug}},
                    headers=headers,
                )
                response.raise_for_status()
                data = response.json()
            except Exception as e:
                logger.error(f"Failed to query LeetCode GraphQL for '{slug}': {e}")
                raise ValueError(f"Failed to fetch problem from LeetCode: {str(e)}")

        question = data.get("data", {}).get("question")
        if not question:
            raise ValueError(f"Problem '{slug}' not found on LeetCode.")

        # Convert HTML to clean markdown
        raw_html = question.get("content") or ""
        markdown_desc = md(raw_html, heading_style="ATX").strip()

        # Extract sample test cases from exampleTestcases and content
        sample_test_cases = self._parse_test_cases(question, markdown_desc)

        # Code snippets mapped by language slug
        snippets = {}
        for s in (question.get("codeSnippets") or []):
            lang_slug = s.get("langSlug", "").lower()
            code = s.get("code", "")
            snippets[lang_slug] = code

        tags = [t.get("name") for t in (question.get("topicTags") or []) if t.get("name")]

        result = {
            "question_id": question.get("questionId"),
            "frontend_id": question.get("questionFrontendId"),
            "title": question.get("title", slug.replace("-", " ").title()),
            "title_slug": question.get("titleSlug", slug),
            "difficulty": (question.get("difficulty") or "Medium").capitalize(),
            "description": markdown_desc,
            "raw_html": raw_html,
            "hints": question.get("hints") or [],
            "topic_tags": tags,
            "code_snippets": snippets,
            "sample_test_cases": sample_test_cases,
            "example_testcases_raw": question.get("exampleTestcases") or "",
        }

        # Cache for performance
        self._cache[slug] = result
        return result

    async def search_problems(
        self,
        keyword: Optional[str] = None,
        difficulty: Optional[str] = None,
        skip: int = 0,
        limit: int = 30
    ) -> Dict[str, Any]:
        """
        Search and paginate through LeetCode's problemset catalog.
        """
        headers = {
            "User-Agent": USER_AGENT,
            "Referer": "https://leetcode.com/problemset/all/",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        filters: Dict[str, Any] = {}
        if keyword and keyword.strip():
            filters["searchKeywords"] = keyword.strip()
        if difficulty and difficulty.upper() in ("EASY", "MEDIUM", "HARD"):
            filters["difficulty"] = difficulty.upper()

        variables = {
            "categorySlug": "",
            "skip": max(0, skip),
            "limit": min(100, max(1, limit)),
            "filters": filters
        }

        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            try:
                response = await client.post(
                    LEETCODE_GRAPHQL_URL,
                    json={"query": QUESTION_LIST_QUERY, "variables": variables},
                    headers=headers,
                )
                response.raise_for_status()
                data = response.json()
            except Exception as e:
                logger.error(f"Error querying LeetCode problemset: {e}")
                # Fallback to filtered curated classics if network or query fails
                filtered = self._filter_curated(keyword, difficulty)
                return {
                    "total": len(filtered),
                    "questions": filtered[skip : skip + limit]
                }

        plist = data.get("data", {}).get("problemsetQuestionList") or {}
        total = plist.get("total", 0)
        raw_questions = plist.get("questions") or []

        formatted_questions = []
        for q in raw_questions:
            formatted_questions.append({
                "frontend_id": q.get("questionFrontendId"),
                "title": q.get("title"),
                "title_slug": q.get("titleSlug"),
                "difficulty": (q.get("difficulty") or "Medium").capitalize(),
                "topic_tags": [t.get("name") for t in (q.get("topicTags") or []) if t.get("name")],
            })

        return {
            "total": total,
            "questions": formatted_questions,
        }

    def get_curated_classics(self) -> List[Dict[str, Any]]:
        """Return the list of curated classic problems."""
        return CURATED_CLASSICS

    def _filter_curated(self, keyword: Optional[str], difficulty: Optional[str]) -> List[Dict[str, Any]]:
        results = CURATED_CLASSICS
        if difficulty:
            diff_norm = difficulty.capitalize()
            results = [c for c in results if c["difficulty"] == diff_norm]
        if keyword:
            kw = keyword.lower().strip()
            results = [
                c for c in results
                if kw in c["title"].lower() or kw in c["title_slug"].lower() or any(kw in t.lower() for t in c.get("tags", []))
            ]
        return results

    def _parse_test_cases(self, question: dict, markdown_desc: str) -> List[Dict[str, str]]:
        """
        Extract structured test cases with both stdin and expected_stdout.
        Prioritizes structured HTML example blocks/pre tags, then Markdown, then raw exampleTestcases.
        """
        from bs4 import BeautifulSoup

        test_cases = []
        raw_html = question.get("content") or ""

        # 1. Primary: Extract from HTML example-block divs or pre tags
        if raw_html:
            try:
                soup = BeautifulSoup(raw_html, "html.parser")
                blocks = soup.find_all("div", class_="example-block")
                if not blocks:
                    blocks = soup.find_all("pre")

                for idx, b in enumerate(blocks, 1):
                    txt = b.get_text()
                    in_m = re.search(r"Input:?\s*\n?(.*?)(?:\n\s*Output:?|\Z)", txt, re.DOTALL | re.IGNORECASE)
                    out_m = re.search(r"Output:?\s*\n?(.*?)(?:\n\s*Explanation:?|\Z)", txt, re.DOTALL | re.IGNORECASE)
                    if in_m:
                        inp = in_m.group(1).strip()
                        outp = out_m.group(1).strip() if out_m else ""
                        test_cases.append({
                            "stdin": inp,
                            "expected_stdout": outp,
                            "description": f"LeetCode Example {idx}"
                        })
            except Exception as e:
                logger.warning(f"Error parsing HTML example blocks: {e}")

        # 2. Secondary: Fallback to regex on Markdown
        if not test_cases and markdown_desc:
            matches = re.finditer(
                r"Example\s*(\d+):.*?\n\s*Input:?\s*(.*?)\n\s*Output:?\s*(.*?)(?=\n\s*(?:Explanation|Example|\*\*Constraints|\Z))",
                markdown_desc,
                re.DOTALL | re.IGNORECASE
            )
            for m in matches:
                ex_num = m.group(1)
                inp = m.group(2).strip()
                outp = m.group(3).strip()
                test_cases.append({
                    "stdin": inp,
                    "expected_stdout": outp,
                    "description": f"LeetCode Example {ex_num}"
                })

        # 3. Tertiary: Fallback to raw exampleTestcases lines
        if not test_cases:
            raw_examples = question.get("exampleTestcases") or ""
            lines = [l.strip() for l in raw_examples.split("\n") if l.strip()]
            for idx, line in enumerate(lines[:5], 1):
                test_cases.append({
                    "stdin": line,
                    "expected_stdout": "",
                    "description": f"LeetCode Sample Input {idx}"
                })

        return test_cases


leetcode_service = LeetCodeService()
