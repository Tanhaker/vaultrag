from uuid import UUID

from pydantic import BaseModel


class UserCtx(BaseModel):
    """Identity of the caller, decoded from a verified JWT. Never built from request bodies."""

    uid: UUID
    tid: UUID
    email: str
    name: str
    roles: list[str]
    depts: list[str]
    clearance: int
    department: str | None = None
