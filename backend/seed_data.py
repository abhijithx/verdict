"""
seed_data.py — Seeds the database with default evaluation profiles and sample problems.

Called once at application startup (idempotent — checks if data already exists
before inserting). This ensures the UI has usable data on first run:
  - 3 evaluation profiles (College Default, Contest Mode, Interview Strict)
  - 3 sample coding problems for immediate testing
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models import EvaluationProfile, Problem


async def seed_evaluation_profiles(db: AsyncSession):
    """
    Seed the 3 default evaluation profiles if they don't already exist.
    
    Profile weight distributions (from spec Section 5.2):
      - College Default:  50% correctness, 20% performance, 15% optimization, 10% quality, 0% readability, 5% docs
      - Contest Mode:     70% correctness, 10% performance, 0% optimization, 0% quality, 20% readability, 0% docs
      - Interview Strict: 40% correctness, 20% performance, 20% optimization, 10% quality, 0% readability, 10% docs
    """
    # Check if profiles already exist to make this idempotent
    result = await db.execute(select(EvaluationProfile).limit(1))
    if result.scalars().first() is not None:
        return  # Profiles already seeded, skip

    default_profiles = [
        EvaluationProfile(
            name="College Default",
            is_default=True,
            correctness_weight=0.50,    # Correctness is most important for learning
            performance_weight=0.20,    # Students should consider efficiency
            optimization_weight=0.15,   # Know if there's a better approach
            quality_weight=0.10,        # Basic code quality awareness
            readability_weight=0.00,    # Not separately weighted (folded into quality)
            documentation_weight=0.05,  # Encourage commenting habits
        ),
        EvaluationProfile(
            name="Contest Mode",
            is_default=True,
            correctness_weight=0.70,    # Contests: get the right answer above all
            performance_weight=0.10,    # Time complexity matters for TLE
            optimization_weight=0.00,   # Not separately weighted in contests
            quality_weight=0.00,        # Code quality irrelevant in speed coding
            readability_weight=0.20,    # Readability = style signal (clean contest code)
            documentation_weight=0.00,  # No one documents in a contest
        ),
        EvaluationProfile(
            name="Interview Strict",
            is_default=True,
            correctness_weight=0.40,    # Must work, but interviews weigh more dimensions
            performance_weight=0.20,    # Demonstrate big-O understanding
            optimization_weight=0.20,   # Can you identify the optimal approach?
            quality_weight=0.10,        # Production-quality code matters
            readability_weight=0.00,    # Folded into quality for interview context
            documentation_weight=0.10,  # Good engineers document their code
        ),
    ]

    for profile in default_profiles:
        db.add(profile)
    
    await db.commit()
    print("[SEED] OK - Created 3 default evaluation profiles")


async def seed_problems(db: AsyncSession):
    """
    Seed 3 sample coding problems for immediate testing.
    
    These are classic problems chosen because:
      1. Two Sum — easy, well-known, stdin/stdout I/O is simple
      2. FizzBuzz — easy, good for testing basic logic and output format
      3. Longest Increasing Subsequence — medium, tests dynamic programming
    """
    # Check if problems already exist to make this idempotent
    result = await db.execute(select(Problem).limit(1))
    if result.scalars().first() is not None:
        return  # Problems already seeded, skip

    sample_problems = [
        Problem(
            title="Two Sum",
            description=(
                "Given an array of integers and a target sum, find two numbers in the array "
                "that add up to the target. Return their indices (0-based).\n\n"
                "Input Format:\n"
                "- First line: N (number of elements) and T (target sum), space-separated\n"
                "- Second line: N space-separated integers\n\n"
                "Output Format:\n"
                "- Two space-separated indices of the numbers that add up to T\n"
                "- If multiple solutions exist, return any one\n\n"
                "Example:\n"
                "Input:\n4 9\n2 7 11 15\n"
                "Output:\n0 1\n\n"
                "Constraints:\n"
                "- 2 ≤ N ≤ 10^5\n"
                "- -10^9 ≤ nums[i] ≤ 10^9\n"
                "- Exactly one solution exists"
            ),
            difficulty="easy",
        ),
        Problem(
            title="FizzBuzz",
            description=(
                "Given a positive integer N, print all numbers from 1 to N. But for multiples "
                "of 3, print 'Fizz' instead of the number. For multiples of 5, print 'Buzz'. "
                "For multiples of both 3 and 5, print 'FizzBuzz'.\n\n"
                "Input Format:\n"
                "- A single integer N\n\n"
                "Output Format:\n"
                "- N lines, each containing either the number, 'Fizz', 'Buzz', or 'FizzBuzz'\n\n"
                "Example:\n"
                "Input:\n15\n"
                "Output:\n1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz\n\n"
                "Constraints:\n"
                "- 1 ≤ N ≤ 10^6"
            ),
            difficulty="easy",
        ),
        Problem(
            title="Longest Increasing Subsequence",
            description=(
                "Given an array of integers, find the length of the longest strictly increasing "
                "subsequence (LIS).\n\n"
                "A subsequence is a sequence that can be derived from the array by deleting some "
                "or no elements without changing the order of the remaining elements.\n\n"
                "Input Format:\n"
                "- First line: N (number of elements)\n"
                "- Second line: N space-separated integers\n\n"
                "Output Format:\n"
                "- A single integer: the length of the LIS\n\n"
                "Example:\n"
                "Input:\n8\n10 9 2 5 3 7 101 18\n"
                "Output:\n4\n\n"
                "Explanation: The LIS is [2, 3, 7, 101] or [2, 5, 7, 101], length = 4.\n\n"
                "Constraints:\n"
                "- 1 ≤ N ≤ 2500\n"
                "- -10^4 ≤ nums[i] ≤ 10^4"
            ),
            difficulty="medium",
        ),
    ]

    for problem in sample_problems:
        db.add(problem)
    
    await db.commit()
    print("[SEED] OK - Created 3 sample problems")


async def run_seeds(db: AsyncSession):
    """Run all seed functions. Called from main.py on startup."""
    await seed_evaluation_profiles(db)
    await seed_problems(db)
    print("[SEED] OK - All seed data loaded successfully")
