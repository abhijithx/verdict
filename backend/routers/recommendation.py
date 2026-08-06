"""
routers/recommendation.py — Solution Recommendation API router.

Handles problem input, calls Gemini via GeminiClient service,
validates output, stores in RecommendationHistory database table,
and returns formatted recommendation JSON response.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from schemas import RecommendationRequest, RecommendationResponse, AlternativeApproach
from services.gemini_client import gemini_client
from services.history_service import history_service
from services.logger import get_logger

logger = get_logger("RecommendationRouter")

router = APIRouter(prefix="/api/recommendation", tags=["recommendation"])


@router.post("", response_model=RecommendationResponse)
async def get_solution_recommendation(
    request: RecommendationRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Generate solution recommendation for a programming problem.
    
    Flow:
      1. Validate request payload
      2. Call Gemini via GeminiClient (with system instruction and JSON validation)
      3. Save result to RecommendationHistory database table
      4. Return structured JSON report to client
    """
    if not request.problem or not request.problem.strip():
        raise HTTPException(status_code=400, detail="Problem statement cannot be empty.")

    logger.info(f"Received recommendation request for language: {request.preferred_language}")

    # Generate recommendation via shared Gemini client
    rec_data = await gemini_client.generate_recommendation(
        problem=request.problem,
        constraints=request.constraints,
        sample_input=request.sample_input,
        sample_output=request.sample_output,
        preferred_language=request.preferred_language
    )

    # Save to history database table
    history_entry = await history_service.create_recommendation_entry(
        db=db,
        problem=request.problem,
        constraints=request.constraints,
        sample_input=request.sample_input,
        sample_output=request.sample_output,
        preferred_language=request.preferred_language,
        recommendation_data=rec_data
    )

    # Transform alternative_approaches list of dicts to schema objects
    alts = []
    for item in rec_data.get("alternative_approaches", []):
        if isinstance(item, dict):
            alts.append(AlternativeApproach(
                name=item.get("name", "Alternative"),
                time_complexity=item.get("time_complexity", "N/A"),
                space_complexity=item.get("space_complexity", "N/A"),
                trade_offs=item.get("trade_offs", "N/A")
            ))

    return RecommendationResponse(
        id=history_entry.id,
        category=rec_data.get("category", "General Algorithm"),
        recommended_algorithm=rec_data.get("recommended_algorithm", "Optimal Strategy"),
        recommended_data_structure=rec_data.get("recommended_data_structure", "Standard Structures"),
        recommended_language=rec_data.get("recommended_language", request.preferred_language),
        time_complexity=rec_data.get("time_complexity", "O(N)"),
        space_complexity=rec_data.get("space_complexity", "O(1)"),
        optimized_code=rec_data.get("optimized_code", ""),
        explanation=rec_data.get("explanation", ""),
        alternative_approaches=alts,
        timestamp=history_entry.timestamp
    )
