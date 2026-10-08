from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ..config import get_settings
from ..db import writer_session
from ..deps import CurrentUser
from ..models import UserCtx
from ..security import create_access_token, dummy_hash, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserCtx


@router.post("/login")
async def login(body: LoginIn) -> TokenOut:
    async with writer_session() as conn:
        cur = await conn.execute(
            "SELECT id, tenant_id, email, name, password_hash, roles, department, clearance, dept_scope"
            "  FROM users WHERE lower(email) = lower(%s)",
            (body.email,),
        )
        row = await cur.fetchone()

    if row is None:
        verify_password(body.password, dummy_hash())
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")

    user = UserCtx(
        uid=row["id"],
        tid=row["tenant_id"],
        email=row["email"],
        name=row["name"],
        roles=row["roles"],
        depts=row["dept_scope"],
        clearance=row["clearance"],
        department=row["department"],
    )
    return TokenOut(access_token=create_access_token(user), user=user)


@router.get("/me")
async def me(user: CurrentUser) -> UserCtx:
    return user


@router.get("/demo-users")
async def demo_users() -> list[dict]:
    """Public list of seeded demo accounts for the UI's "view as" switcher (demo mode only)."""
    if not get_settings().demo_mode:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    async with writer_session() as conn:
        cur = await conn.execute(
            "SELECT email, name, roles, department, clearance FROM users"
            " WHERE tenant_id = %s ORDER BY clearance, email",
            (get_settings().tenant_id,),
        )
        return await cur.fetchall()
