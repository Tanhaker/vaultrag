import asyncio
import json

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..deps import CurrentUser
from ..rag import answer
from ..rag.guard import RateLimitExceeded

router = APIRouter(tags=["query"])


class Turn(BaseModel):
    question: str = Field(max_length=500)


class QueryIn(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    verbatim: bool = False                              # quote sources only, no generative model
    history: list[Turn] = Field(default_factory=list, max_length=6)


def _too_many(e: RateLimitExceeded) -> HTTPException:
    return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                         "Too many questions in a short time. Wait a minute and try again.",
                         headers={"Retry-After": str(e.retry_after)})


@router.post("/query")
async def query(body: QueryIn, user: CurrentUser) -> dict:
    """Answer a question from sources the caller may read. Retrieval runs as rag_reader under RLS."""
    try:
        return await answer.run(user, body.question, verbatim=body.verbatim,
                                history=[t.model_dump() for t in body.history])
    except RateLimitExceeded as e:
        raise _too_many(e)


@router.post("/query/stream")
async def query_stream(body: QueryIn, user: CurrentUser) -> StreamingResponse:
    """Same pipeline, streamed as server-sent events: one `step` event per stage as it finishes,
    then a single `answer` event (or `error`)."""
    queue: asyncio.Queue = asyncio.Queue()

    async def runner() -> None:
        try:
            out = await answer.run(user, body.question, verbatim=body.verbatim,
                                   history=[t.model_dump() for t in body.history], on_step=queue.put_nowait)
            queue.put_nowait({"type": "answer", "answer": out})
        except RateLimitExceeded:
            queue.put_nowait({"type": "error", "status": 429,
                              "detail": "Too many questions in a short time. Wait a minute and try again."})
        except Exception:
            queue.put_nowait({"type": "error", "status": 500, "detail": "The pipeline failed. Try again."})
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(runner())

    async def events():
        yield ": stream open\n\n"
        while (event := await queue.get()) is not None:
            yield f"data: {json.dumps(event, default=str)}\n\n"
        await task

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})
