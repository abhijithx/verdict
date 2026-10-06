"""
routers/recommendation.py — Solution Recommendation API router.

Handles problem input, calls Gemini via GeminiClient service,
validates output, stores in RecommendationHistory database table,
and returns formatted recommendation JSON response.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from schemas import (
    RecommendationRequest,
    RecommendationResponse,
    AlternativeApproach,
    RecommendationTestCase,
    RecommendationAskRequest,
    RecommendationAskResponse,
)
from services.gemini_client import gemini_client, GeminiAPIError
from services.history_service import history_service
from services.logger import get_logger

logger = get_logger("RecommendationRouter")

from services.rate_limiter import check_ai_rate_limit

router = APIRouter(prefix="/api/recommendation", tags=["recommendation"])


@router.post("", response_model=RecommendationResponse, dependencies=[Depends(check_ai_rate_limit)])
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
    try:
        rec_data = await gemini_client.generate_recommendation(
            problem=request.problem,
            constraints=request.constraints,
            sample_input=request.sample_input,
            sample_output=request.sample_output,
            preferred_language=request.preferred_language
        )
    except GeminiAPIError as e:
        logger.error(f"GeminiAPIError in recommendation: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error in recommendation: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"AI Analysis Failed: {str(e)}")

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

    # Transform sample_test_cases list of dicts to schema objects
    sample_tcs = []
    for tc in rec_data.get("sample_test_cases", []):
        if isinstance(tc, dict):
            sample_tcs.append(RecommendationTestCase(
                stdin=str(tc.get("stdin", "") or ""),
                expected_stdout=str(tc.get("expected_stdout", "") or ""),
                description=str(tc.get("description", "Sample Case") or "Sample Case")
            ))

    return RecommendationResponse(
        id=history_entry.id,
        title=rec_data.get("title", "Optimal Solution"),
        difficulty=rec_data.get("difficulty", "medium"),
        category=rec_data.get("category", "General Algorithm"),
        recommended_algorithm=rec_data.get("recommended_algorithm", "Optimal Strategy"),
        recommended_data_structure=rec_data.get("recommended_data_structure", "Standard Structures"),
        recommended_language=rec_data.get("recommended_language", request.preferred_language),
        time_complexity=rec_data.get("time_complexity", "O(N)"),
        space_complexity=rec_data.get("space_complexity", "O(1)"),
        optimized_code=rec_data.get("optimized_code", ""),
        explanation=rec_data.get("explanation", ""),
        alternative_approaches=alts,
        sample_test_cases=sample_tcs,
        timestamp=history_entry.timestamp
    )


@router.post("/ask", response_model=RecommendationAskResponse, dependencies=[Depends(check_ai_rate_limit)])
async def ask_recommendation_copilot(
    request: RecommendationAskRequest
):
    """
    Ask follow-up questions, debug logic, request edge-case analysis or
    code optimizations from Verdict AI Copilot for this problem.
    """
    if not request.question or not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    logger.info(f"AI Copilot question for algorithm '{request.algorithm}': {request.question[:60]}")

    result = await gemini_client.answer_recommendation_question(
        problem=request.problem,
        question=request.question,
        code=request.code,
        algorithm=request.algorithm,
        language=request.language,
        chat_history=request.chat_history,
    )

    return RecommendationAskResponse(
        answer=result.get("answer", ""),
        suggested_improvements=result.get("suggested_improvements", []),
        code_update=result.get("code_update")
    )

