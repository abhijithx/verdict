"""
routers/leetcode.py — LeetCode problem search, fetch, and import endpoints.

Enables seamless exploration and import of 4,000+ LeetCode problems into Verdict:
  - GET  /api/leetcode/problems  (Search and browse LeetCode catalog)
  - GET  /api/leetcode/curated   (Get top interview classics)
  - POST /api/leetcode/fetch     (Fetch full problem specification)
  - POST /api/leetcode/import    (Fetch and persist problem into database)
"""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import Problem
from schemas import (
    LeetCodeImportRequest,
    LeetCodeProblemDetailResponse,
    LeetCodeCatalogResponse,
    LeetCodeCatalogItem,
)
from services.leetcode_service import leetcode_service

logger = logging.getLogger("LeetCodeRouter")

router = APIRouter(prefix="/api/leetcode", tags=["leetcode"])


@router.get("/curated", response_model=list)
async def get_curated_problems():
    """
    Get curated list of classic LeetCode interview problems (Blind 75 / Top 150).
    """
    return leetcode_service.get_curated_classics()


@router.get("/problems", response_model=LeetCodeCatalogResponse)
async def search_leetcode_catalog(
    keyword: Optional[str] = Query(None, description="Search keyword, problem name, or tag"),
    difficulty: Optional[str] = Query(None, description="Difficulty filter: EASY, MEDIUM, HARD"),
    skip: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(30, ge=1, le=100, description="Items per page"),
    include_curated: bool = Query(True, description="Whether to include curated list in response"),
):
    """
    Search and browse across all 4,000+ problems in LeetCode's catalog.
    """
    try:
        data = await leetcode_service.search_problems(
            keyword=keyword,
            difficulty=difficulty,
            skip=skip,
            limit=limit,
        )
        curated = leetcode_service.get_curated_classics() if include_curated and skip == 0 else None
        return LeetCodeCatalogResponse(
            total=data["total"],
            questions=[LeetCodeCatalogItem(**q) for q in data["questions"]],
            curated=curated,
        )
    except Exception as e:
        logger.error(f"Error querying LeetCode catalog: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to query LeetCode catalog: {str(e)}")


@router.post("/fetch", response_model=LeetCodeProblemDetailResponse)
async def fetch_leetcode_problem(payload: LeetCodeImportRequest):
    """
    Fetch comprehensive problem details from LeetCode by URL or slug.
    Returns title, difficulty, markdown description, code snippets, and sample test cases.
    """
    try:
        details = await leetcode_service.fetch_problem(payload.url_or_slug)
        return LeetCodeProblemDetailResponse(**details)
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Error fetching LeetCode problem: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch problem from LeetCode: {str(e)}")


@router.post("/import", response_model=LeetCodeProblemDetailResponse)
async def import_leetcode_problem(
    payload: LeetCodeImportRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Fetch a LeetCode problem and automatically persist it as a Verdict Problem in the database.
    If the problem already exists in Verdict, returns the existing problem ID.
    """
    try:
        details = await leetcode_service.fetch_problem(payload.url_or_slug)
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Error fetching LeetCode problem for import: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch problem from LeetCode: {str(e)}")

    canonical_title = f"{details['frontend_id']}. {details['title']}" if details.get("frontend_id") else details["title"]
    diff_val = details.get("difficulty", "Medium").lower()
    if diff_val not in ("easy", "medium", "hard"):
        diff_val = "medium"

    # Check if problem with this title or slug already exists
    existing_query = await db.execute(
        select(Problem).where(Problem.title == canonical_title)
    )
    existing_problem = existing_query.scalars().first()

    if existing_problem:
        details["problem_id"] = existing_problem.problem_id
        # Update description if it was empty
        if not existing_problem.description and details.get("description"):
            existing_problem.description = details["description"]
            await db.commit()
    else:
        new_problem = Problem(
            title=canonical_title,
            description=details.get("description", canonical_title),
            difficulty=diff_val,
        )
        db.add(new_problem)
        await db.commit()
        await db.refresh(new_problem)
        details["problem_id"] = new_problem.problem_id

    return LeetCodeProblemDetailResponse(**details)
