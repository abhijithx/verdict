"""
routers/evaluation_profiles.py — CRUD endpoints for evaluation profiles.

Evaluation profiles define how the final score is weighted across
6 dimensions (correctness, performance, optimization, quality,
readability, documentation). This router provides:
  - List all profiles (for the dropdown in New Session modal)
  - Create a custom profile (from the slider UI)
  - Get a single profile by ID
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import EvaluationProfile
from schemas import EvaluationProfileCreate, EvaluationProfileResponse

router = APIRouter(prefix="/api/evaluation-profiles", tags=["evaluation-profiles"])


@router.get("", response_model=list[EvaluationProfileResponse])
async def list_profiles(db: AsyncSession = Depends(get_db)):
    """
    List all evaluation profiles.
    
    Returns all profiles ordered by: default profiles first (alphabetically),
    then custom profiles (by creation date, newest first).
    
    Used to populate the dropdown in the New Session modal.
    """
    result = await db.execute(
        select(EvaluationProfile).order_by(
            EvaluationProfile.is_default.desc(),  # Defaults first
            EvaluationProfile.created_at.asc()     # Then by creation date
        )
    )
    profiles = result.scalars().all()

    return [
        EvaluationProfileResponse(
            profile_id=p.profile_id,
            name=p.name,
            is_default=p.is_default,
            correctness_weight=p.correctness_weight,
            performance_weight=p.performance_weight,
            optimization_weight=p.optimization_weight,
            quality_weight=p.quality_weight,
            readability_weight=p.readability_weight,
            documentation_weight=p.documentation_weight,
            created_at=p.created_at,
        )
        for p in profiles
    ]


@router.post("", response_model=EvaluationProfileResponse)
async def create_profile(
    profile_data: EvaluationProfileCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a custom evaluation profile.
    
    Called from the slider UI when the user saves a new profile.
    The Pydantic schema validates that weights sum to 1.0 (±0.01).
    
    Custom profiles are never marked as default — only the 3 seeded
    profiles have is_default=True.
    """
    # Check for duplicate name
    existing = await db.execute(
        select(EvaluationProfile).where(EvaluationProfile.name == profile_data.name)
    )
    if existing.scalars().first():
        raise HTTPException(
            status_code=409,
            detail=f"Profile '{profile_data.name}' already exists"
        )

    new_profile = EvaluationProfile(
        name=profile_data.name,
        is_default=False,  # Custom profiles are never default
        correctness_weight=profile_data.correctness_weight,
        performance_weight=profile_data.performance_weight,
        optimization_weight=profile_data.optimization_weight,
        quality_weight=profile_data.quality_weight,
        readability_weight=profile_data.readability_weight,
        documentation_weight=profile_data.documentation_weight,
    )
    db.add(new_profile)
    await db.commit()
    await db.refresh(new_profile)

    return EvaluationProfileResponse(
        profile_id=new_profile.profile_id,
        name=new_profile.name,
        is_default=new_profile.is_default,
        correctness_weight=new_profile.correctness_weight,
        performance_weight=new_profile.performance_weight,
        optimization_weight=new_profile.optimization_weight,
        quality_weight=new_profile.quality_weight,
        readability_weight=new_profile.readability_weight,
        documentation_weight=new_profile.documentation_weight,
        created_at=new_profile.created_at,
    )


@router.get("/{profile_id}", response_model=EvaluationProfileResponse)
async def get_profile(profile_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single evaluation profile by ID."""
    result = await db.execute(
        select(EvaluationProfile).where(
            EvaluationProfile.profile_id == profile_id
        )
    )
    profile = result.scalars().first()
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found")

    return EvaluationProfileResponse(
        profile_id=profile.profile_id,
        name=profile.name,
        is_default=profile.is_default,
        correctness_weight=profile.correctness_weight,
        performance_weight=profile.performance_weight,
        optimization_weight=profile.optimization_weight,
        quality_weight=profile.quality_weight,
        readability_weight=profile.readability_weight,
        documentation_weight=profile.documentation_weight,
        created_at=profile.created_at,
    )
