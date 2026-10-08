import hashlib
import hmac
import json
import time
from functools import lru_cache
from uuid import UUID

import bcrypt
import jwt

from .config import get_settings
from .models import UserCtx


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


@lru_cache
def dummy_hash() -> str:
    """Compared against when the email is unknown, so login timing doesn't reveal valid accounts."""
    return hash_password("vaultrag-timing-equaliser")


def create_access_token(user: UserCtx) -> str:
    s = get_settings()
    now = int(time.time())
    claims = {
        "sub": str(user.uid),
        "tid": str(user.tid),
        "email": user.email,
        "name": user.name,
        "roles": user.roles,
        "depts": user.depts,
        "clr": user.clearance,
        "dept": user.department,
        "iat": now,
        "exp": now + s.jwt_expire_minutes * 60,
    }
    return jwt.encode(claims, s.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> UserCtx:
    s = get_settings()
    claims = jwt.decode(
        token, s.jwt_secret, algorithms=["HS256"], options={"require": ["exp", "sub", "tid"]}
    )
    return UserCtx(
        uid=UUID(claims["sub"]),
        tid=UUID(claims["tid"]),
        email=claims["email"],
        name=claims["name"],
        roles=claims["roles"],
        depts=claims["depts"],
        clearance=claims["clr"],
        department=claims.get("dept"),
    )


def sign_payload(payload: dict) -> tuple[str, str]:
    """Serialise and HMAC a DB security context. Verified in Postgres by app_ctx()."""
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    sig = hmac.new(get_settings().ctx_hmac_secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return body, sig


def sign_db_context(user: UserCtx) -> tuple[str, str]:
    return sign_payload(
        {
            "uid": str(user.uid),
            "tid": str(user.tid),
            "roles": sorted(user.roles),
            "depts": sorted(user.depts),
            "clr": user.clearance,
            "exp": int(time.time()) + get_settings().ctx_ttl_seconds,
        }
    )
