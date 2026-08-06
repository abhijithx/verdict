"""
routers/history.py — Shared History API router.

Provides endpoints for listing history items across Recommendation and Evaluation modules,
getting detailed reports by ID, and deleting history records.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from services.history_service import history_service
from services.logger import get_logger

logger = get_logger("HistoryRouter")

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("", response_model=dict)
async def list_history(
    q: Optional[str] = Query(None, description="Search query string"),
    type: str = Query("all", description="Module type filter ('all', 'recommendation', 'evaluation')"),
    db: AsyncSession = Depends(get_db)
):
    """
    List all platform history records with optional search query and type filter.
    """
    return await history_service.get_all_history(
        db=db,
        search_query=q,
        module_type=type
    )


@router.get("/{item_id}", response_model=dict)
async def get_history_detail(
    item_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieve full details for a specific history item by ID (e.g., 'rec_1' or 'eval_2').
    """
    detail = await history_service.get_history_detail(db, item_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"History item '{item_id}' not found.")
    return detail


@router.delete("/{item_id}", response_model=dict)
async def delete_history_item(
    item_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a history item by ID.
    """
    success = await history_service.delete_history_item(db, item_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"History item '{item_id}' not found or deletion failed.")
    return {"message": f"Successfully deleted history item '{item_id}'", "id": item_id}
