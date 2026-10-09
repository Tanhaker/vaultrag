from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..deps import CurrentUser
from ..rag import answer

router = APIRouter(tags=["query"])


class QueryIn(BaseModel):
    question: str = Field(min_length=2, max_length=500)


@router.post("/query")
async def query(body: QueryIn, user: CurrentUser) -> dict:
    """Answer a question from sources the caller may read. Retrieval runs as rag_reader under RLS."""
    return await answer.run(user, body.question)
