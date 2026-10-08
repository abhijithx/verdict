"""
history_service.py — Shared History Service for Verdict AI Platform.

Manages query, creation, lookup, and deletion of Recommendation and Evaluation history entries.
"""

from typing import List, Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, or_

from models import RecommendationHistory, Session, AnalysisResult, Problem
from services.logger import get_logger

logger = get_logger("HistoryService")


class HistoryService:
    """Service class for managing platform history."""

    @staticmethod
    async def create_recommendation_entry(
        db: AsyncSession,
        problem: str,
        constraints: Optional[str],
        sample_input: Optional[str],
        sample_output: Optional[str],
        preferred_language: str,
        recommendation_data: Dict[str, Any],
        user_id: Optional[int] = None
    ) -> RecommendationHistory:
        """Create and store a recommendation history item."""
        entry = RecommendationHistory(
            user_id=user_id,
            problem=problem,
            constraints=constraints,
            sample_input=sample_input,
            sample_output=sample_output,
            preferred_language=preferred_language or recommendation_data.get("recommended_language", "Auto-select"),
            category=recommendation_data.get("category"),
            recommended_algorithm=recommendation_data.get("recommended_algorithm"),
            recommended_data_structure=recommendation_data.get("recommended_data_structure"),
            recommended_language=recommendation_data.get("recommended_language", preferred_language or "Auto-select"),
            time_complexity=recommendation_data.get("time_complexity"),
            space_complexity=recommendation_data.get("space_complexity"),
            optimized_code=recommendation_data.get("optimized_code"),
            explanation=recommendation_data.get("explanation"),
            alternative_approaches=recommendation_data.get("alternative_approaches"),
        )
        db.add(entry)
        await db.commit()
        await db.refresh(entry)
        logger.info(f"Saved Recommendation history entry ID {entry.id}")
        return entry

    @staticmethod
    async def get_all_history(
        db: AsyncSession,
        search_query: Optional[str] = None,
        module_type: str = "all"
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        Fetch unified history items (recommendation and evaluation).
        """
        results: List[Dict[str, Any]] = []

        # Fetch Recommendation History
        if module_type in ("all", "recommendation"):
            rec_stmt = select(RecommendationHistory).order_by(RecommendationHistory.timestamp.desc())
            if search_query:
                rec_stmt = rec_stmt.where(
                    or_(
                        RecommendationHistory.problem.ilike(f"%{search_query}%"),
                        RecommendationHistory.category.ilike(f"%{search_query}%"),
                        RecommendationHistory.recommended_algorithm.ilike(f"%{search_query}%")
                    )
                )
            rec_res = await db.execute(rec_stmt)
            rec_entries = rec_res.scalars().all()
            for rec in rec_entries:
                results.append({
                    "id": f"rec_{rec.id}",
                    "raw_id": rec.id,
                    "module": "recommendation",
                    "title": rec.problem[:60] + ("..." if len(rec.problem) > 60 else ""),
                    "problem": rec.problem,
                    "category": rec.category or "General",
                    "algorithm": rec.recommended_algorithm,
                    "language": rec.recommended_language or rec.preferred_language,
                    "complexity": f"{rec.time_complexity or 'N/A'} time | {rec.space_complexity or 'N/A'} space",
                    "timestamp": rec.timestamp.isoformat() if rec.timestamp else None,
                })

        # Fetch Evaluation History (from Sessions)
        if module_type in ("all", "evaluation"):
            eval_stmt = (
                select(Session, Problem, AnalysisResult)
                .join(Problem, Session.problem_id == Problem.problem_id)
                .outerjoin(AnalysisResult, Session.session_id == AnalysisResult.session_id)
                .order_by(Session.created_at.desc())
            )
            if search_query:
                eval_stmt = eval_stmt.where(
                    or_(
                        Problem.title.ilike(f"%{search_query}%"),
                        Problem.description.ilike(f"%{search_query}%"),
                        Session.submission_label.ilike(f"%{search_query}%"),
                        Session.language.ilike(f"%{search_query}%")
                    )
                )
            eval_res = await db.execute(eval_stmt)
            eval_rows = eval_res.all()
            for sess, prob, ana in eval_rows:
                verdict = ana.verdict if ana else sess.status
                score = ana.final_score if ana else None
                results.append({
                    "id": f"eval_{sess.session_id}",
                    "raw_id": sess.session_id,
                    "session_id": sess.session_id,
                    "problem_id": sess.problem_id,
                    "status": sess.status,
                    "score": score,
                    "module": "evaluation",
                    "title": prob.title if prob else f"Session #{sess.session_id}",
                    "problem": prob.description if prob else "",
                    "submission_label": sess.submission_label,
                    "language": sess.language,
                    "verdict": verdict,
                    "final_score": score,
                    "complexity": f"{ana.time_complexity or 'N/A'} time" if ana else "N/A",
                    "timestamp": sess.created_at.isoformat() if sess.created_at else None,
                    "created_at": sess.created_at.isoformat() if sess.created_at else None,
                })

        # Sort all results by timestamp descending
        results.sort(key=lambda x: x["timestamp"] or "", reverse=True)
        return {"items": results}

    @staticmethod
    async def get_history_detail(
        db: AsyncSession,
        item_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get full detail of a specific history item."""
        if item_id.startswith("rec_"):
            raw_id = int(item_id.replace("rec_", ""))
            stmt = select(RecommendationHistory).where(RecommendationHistory.id == raw_id)
            res = await db.execute(stmt)
            rec = res.scalars().first()
            if not rec:
                return None
            return {
                "id": item_id,
                "module": "recommendation",
                "problem": rec.problem,
                "constraints": rec.constraints,
                "sample_input": rec.sample_input,
                "sample_output": rec.sample_output,
                "preferred_language": rec.preferred_language,
                "category": rec.category,
                "recommended_algorithm": rec.recommended_algorithm,
                "recommended_data_structure": rec.recommended_data_structure,
                "recommended_language": rec.recommended_language,
                "time_complexity": rec.time_complexity,
                "space_complexity": rec.space_complexity,
                "optimized_code": rec.optimized_code,
                "explanation": rec.explanation,
                "alternative_approaches": rec.alternative_approaches or [],
                "timestamp": rec.timestamp.isoformat() if rec.timestamp else None,
            }
        elif item_id.startswith("eval_"):
            raw_id = int(item_id.replace("eval_", ""))
            stmt = (
                select(Session, Problem, AnalysisResult)
                .join(Problem, Session.problem_id == Problem.problem_id)
                .outerjoin(AnalysisResult, Session.session_id == AnalysisResult.session_id)
                .where(Session.session_id == raw_id)
            )
            res = await db.execute(stmt)
            row = res.first()
            if not row:
                return None
            sess, prob, ana = row
            return {
                "id": item_id,
                "module": "evaluation",
                "session_id": sess.session_id,
                "problem_title": prob.title if prob else "",
                "problem": prob.description if prob else "",
                "language": sess.language,
                "user_code": sess.code,
                "submission_label": sess.submission_label,
                "status": sess.status,
                "analysis": {
                    "verdict": ana.verdict if ana else None,
                    "final_score": ana.final_score if ana else None,
                    "time_complexity": ana.time_complexity if ana else None,
                    "space_complexity": ana.space_complexity if ana else None,
                    "code_explanation": ana.code_explanation if ana else None,
                    "optimization_suggestions": ana.optimization_suggestions_json if ana else [],
                } if ana else None,
                "timestamp": sess.created_at.isoformat() if sess.created_at else None,
            }
        return None

    @staticmethod
    async def delete_history_item(
        db: AsyncSession,
        item_id: str
    ) -> bool:
        """Delete a history item by ID."""
        if item_id.startswith("rec_"):
            raw_id = int(item_id.replace("rec_", ""))
            rec_check = await db.execute(select(RecommendationHistory).where(RecommendationHistory.id == raw_id))
            if not rec_check.scalars().first():
                return False
            await db.execute(delete(RecommendationHistory).where(RecommendationHistory.id == raw_id))
            await db.commit()
            return True
        elif item_id.startswith("eval_"):
            raw_id = int(item_id.replace("eval_", ""))
            sess_check = await db.execute(select(Session).where(Session.session_id == raw_id))
            if not sess_check.scalars().first():
                return False
            from models import DryRunResult, GeneratedTestCase, ExecutionResult, AnalysisResult
            await db.execute(delete(AnalysisResult).where(AnalysisResult.session_id == raw_id))
            await db.execute(delete(ExecutionResult).where(ExecutionResult.session_id == raw_id))
            await db.execute(delete(GeneratedTestCase).where(GeneratedTestCase.session_id == raw_id))
            await db.execute(delete(DryRunResult).where(DryRunResult.session_id == raw_id))
            await db.execute(delete(Session).where(Session.session_id == raw_id))
            await db.commit()
            return True
        return False


history_service = HistoryService()
