from collections.abc import AsyncIterator
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from psycopg import AsyncConnection

from .db import secure_session
from .models import UserCtx
from .security import decode_access_token

_bearer = HTTPBearer(auto_error=False)


async def current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> UserCtx:
    if creds is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"}
        )
    try:
        return decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"}
        )


async def reader_conn(user: Annotated[UserCtx, Depends(current_user)]) -> AsyncIterator[AsyncConnection]:
    async with secure_session(user) as conn:
        yield conn


CurrentUser = Annotated[UserCtx, Depends(current_user)]
ReaderConn = Annotated[AsyncConnection, Depends(reader_conn)]
