import os
import sys
import pytest
from httpx import AsyncClient, ASGITransport

# Ensure backend root is on sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from main import app
from services.leetcode_service import leetcode_service


def test_slug_extraction():
    """Verify robust extraction of problem slugs across multiple URL formats."""
    assert leetcode_service.extract_slug("https://leetcode.com/problems/two-sum/") == "two-sum"
    assert leetcode_service.extract_slug("https://leetcode.com/problems/trapping-rain-water/description/") == "trapping-rain-water"
    assert leetcode_service.extract_slug("https://leetcode.cn/problems/3sum") == "3sum"
    assert leetcode_service.extract_slug("valid-parentheses") == "valid-parentheses"
    assert leetcode_service.extract_slug("1. Two Sum") == "two-sum"
    assert leetcode_service.extract_slug("42. Trapping Rain Water") == "trapping-rain-water"


@pytest.mark.asyncio
async def test_leetcode_curated_endpoint():
    """Verify /api/leetcode/curated returns top classics."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/api/leetcode/curated")
        assert res.status_code == 200
        items = res.json()
        assert isinstance(items, list)
        assert len(items) >= 15
        assert any(i["title_slug"] == "two-sum" for i in items)
        assert any(i["title_slug"] == "lru-cache" for i in items)


@pytest.mark.asyncio
async def test_leetcode_catalog_search():
    """Verify /api/leetcode/problems can search and filter catalog."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/api/leetcode/problems?keyword=binary%20search&limit=5")
        assert res.status_code == 200
        data = res.json()
        assert "total" in data
        assert "questions" in data
        assert len(data["questions"]) > 0
        q = data["questions"][0]
        assert "title" in q
        assert "title_slug" in q
        assert "difficulty" in q


@pytest.mark.asyncio
async def test_leetcode_fetch_problem():
    """Verify /api/leetcode/fetch returns full problem specification."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post("/api/leetcode/fetch", json={"url_or_slug": "two-sum"})
        assert res.status_code == 200
        data = res.json()
        assert data["title"] == "Two Sum"
        assert data["difficulty"] == "Easy"
        assert len(data["description"]) > 50
        assert "code_snippets" in data
        assert "sample_test_cases" in data
        assert len(data["sample_test_cases"]) > 0
        assert data["sample_test_cases"][0]["stdin"]
        assert data["sample_test_cases"][0]["expected_stdout"] == "[0,1]"


@pytest.mark.asyncio
async def test_leetcode_import_and_session_creation():
    """Verify importing LeetCode problem into Verdict database and launching session."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Import problem into database
        import_res = await ac.post("/api/leetcode/import", json={"url_or_slug": "valid-parentheses"})
        assert import_res.status_code == 200
        prob_data = import_res.json()
        assert prob_data["problem_id"] is not None
        prob_id = prob_data["problem_id"]

        # 2. Verify problem exists in Problem catalog
        get_prob_res = await ac.get(f"/api/problems/{prob_id}")
        assert get_prob_res.status_code == 200
        db_prob = get_prob_res.json()
        assert "Valid Parentheses" in db_prob["title"]

        # 3. Create a session using imported starter code snippet and test cases
        py_snippet = prob_data.get("code_snippets", {}).get("python3", "class Solution:\n    pass\n")
        test_cases = [
            {"stdin": tc.get("stdin", "()"), "expected_stdout": tc.get("expected_stdout", ""), "description": tc.get("description", "Case")}
            for tc in prob_data.get("sample_test_cases", [])
        ]
        if not test_cases:
            test_cases = [{"stdin": "()", "expected_stdout": "true", "description": "Default Sample"}]
        assert test_cases[0]["expected_stdout"] == "true"

        sess_res = await ac.post(f"/api/sessions?problem_id={prob_id}", json={
            "language": "python",
            "submission_label": "LeetCode Import Attempt",
            "code": py_snippet,
            "test_cases": test_cases
        })
        assert sess_res.status_code == 200
        sess_data = sess_res.json()
        sess_id = sess_data["session_id"]

        # 4. Fetch session details and verify test cases are mounted
        sess_detail_res = await ac.get(f"/api/sessions/{sess_id}")
        assert sess_detail_res.status_code == 200
        sess_detail = sess_detail_res.json()
        assert sess_detail["session_id"] == sess_id
        assert len(sess_detail["test_cases"]) == len(test_cases)


@pytest.mark.asyncio
async def test_leetcode_multi_language_execution():
    """Verify LeetCode class Solution and functions execute seamlessly across Python, JS, Java, and C++."""
    from pipeline.code_runner import code_runner

    stdin_input = "nums = [2,7,11,15], target = 9"
    expected = "[0, 1]"

    # 1. Python
    py_code = """
class Solution:
    def twoSum(self, nums: list[int], target: int) -> list[int]:
        d = {}
        for i, n in enumerate(nums):
            if target - n in d:
                return [d[target - n], i]
            d[n] = i
        return []
"""
    res_py = await code_runner.run_test(py_code, "python", 1, stdin_input, expected)
    assert res_py.passed is True

    # 2. JavaScript
    js_code = """
var twoSum = function(nums, target) {
    const map = new Map();
    for (let i = 0; i < nums.length; i++) {
        const diff = target - nums[i];
        if (map.has(diff)) return [map.get(diff), i];
        map.set(nums[i], i);
    }
    return [];
};
"""
    res_js = await code_runner.run_test(js_code, "javascript", 1, stdin_input, expected)
    assert res_js.passed is True

    # 3. Java
    java_code = """
import java.util.*;

class Solution {
    public int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> map = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int comp = target - nums[i];
            if (map.containsKey(comp)) return new int[] { map.get(comp), i };
            map.put(nums[i], i);
        }
        return new int[0];
    }
}
"""
    res_java = await code_runner.run_test(java_code, "java", 1, stdin_input, expected)
    assert res_java.passed is True

    # 4. C++
    cpp_code = """
#include <vector>
#include <unordered_map>
using namespace std;

class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int, int> mp;
        for (int i = 0; i < nums.size(); ++i) {
            int comp = target - nums[i];
            if (mp.count(comp)) return {mp[comp], i};
            mp[nums[i]] = i;
        }
        return {};
    }
};
"""
    res_cpp = await code_runner.run_test(cpp_code, "cpp", 1, stdin_input, expected)
    assert res_cpp.passed is True

