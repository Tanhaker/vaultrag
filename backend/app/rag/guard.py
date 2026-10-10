"""Guards around the pipeline.

preflight()  one RLS-scoped statement: data version, the caller's recent usage, tenant AI usage today
             and a Postgres-cached answer, all in a single round trip.
llm_allowed() the quota guard: over budget the answer is composed verbatim instead of failing.
rewrite_followup() turns "what about MECH?" into a standalone question using the previous turn.
egress()     the last line of defence: inspects the finished answer for canary tokens from documents
             the caller cannot read (blocks the whole answer) and for phone/ID numbers (redacts them).
"""

import hashlib
import re
from dataclasses import dataclass

from ..config import get_settings
from ..db import secure_session
from ..models import UserCtx

DEPTS = {"CSE": r"\bcse\b|computer science", "MECH": r"\bmech\b|mechanical", "CIVIL": r"\bcivil\b",
         "EC": r"\bec\b|electronics"}

CANARY = re.compile(r"\bCANARY-[A-Z0-9]+(?:-[A-Z0-9]+)*\b")
PHONE = re.compile(r"(?:\+91[\s-]?)?(?<!\d)[6-9]\d{9}(?!\d)")
NATIONAL_ID = re.compile(r"(?<!\d)\d{4}\s\d{4}\s\d{4}(?!\d)")


class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int = 60):
        super().__init__("Too many questions in a short time")
        self.retry_after = retry_after


def mentioned_departments(question: str) -> set[str]:
    q = question.lower()
    return {d for d, pat in DEPTS.items() if re.search(pat, q)}


def cache_key(question: str, verbatim: bool, style: str = "") -> str:
    normalised = re.sub(r"\s+", " ", question.strip().lower())
    tag = f"v2|{int(verbatim)}|{normalised}" if not style else f"v2|{int(verbatim)}|{style}|{normalised}"
    return hashlib.sha256(tag.encode()).hexdigest()[:32]


@dataclass
class Preflight:
    kb_version: int | None   # None: unknown, so the cache is neither read nor written
    recent_queries: int
    recent_llm: int
    llm_today: int
    cached: dict | None
    key: str = ""            # the cache key, extended with a fingerprint of the user's private files


async def preflight(user: UserCtx, key: str) -> Preflight:
    s = get_settings()
    try:
        async with secure_session(user) as conn:
            # Private chat attachments change only their owner's answers, so they extend the owner's
            # cache key instead of bumping kb_version for everyone.
            p = await (await conn.execute(
                "SELECT count(*) AS n, coalesce(max(extract(epoch FROM created_at))::bigint, 0) AS t FROM documents"
                " WHERE owner_id = %s AND allowed_roles = '{}' AND allowed_users = ARRAY[%s]::uuid[]",
                (user.uid, user.uid))).fetchone()
            if p["n"]:
                key = f"{key}:p{p['n']}-{p['t']}"
            row = await (await conn.execute(
                "SELECT (SELECT version FROM kb_version) AS kbv,"
                "       (SELECT count(*) FROM audit_log WHERE user_id = %(u)s AND action = 'query'"
                "           AND created_at > now() - interval '10 minutes') AS recent,"
                "       (SELECT coalesce(sum((meta->>'llm_calls')::int), 0) FROM audit_log WHERE user_id = %(u)s"
                "           AND created_at > now() - interval '10 minutes') AS recent_llm,"
                "       llm_calls_today() AS today,"
                "       (SELECT answer FROM answer_cache WHERE user_id = %(u)s AND key = %(k)s"
                "           AND kb_version = (SELECT version FROM kb_version)"
                "           AND created_at > now() - make_interval(hours => %(h)s)) AS cached",
                {"u": user.uid, "k": key, "h": s.answer_cache_hours})).fetchone()
        return Preflight(row["kbv"] or 0, row["recent"], row["recent_llm"], row["today"], row["cached"], key)
    except Exception:
        return Preflight(None, 0, 0, 0, None, key)


def enforce_rate_limit(pf: Preflight) -> None:
    if pf.recent_queries >= get_settings().query_limit_per_10min:
        raise RateLimitExceeded(60)


def llm_allowed(pf: Preflight, verbatim: bool) -> tuple[bool, str]:
    s = get_settings()
    if verbatim:
        return False, "verbatim mode requested"
    if not s.llm_enabled:
        return False, "no generative model configured"
    if pf.llm_today >= s.llm_daily_budget:
        return False, f"daily AI budget used ({pf.llm_today}/{s.llm_daily_budget})"
    if pf.recent_llm >= s.user_llm_per_10min:
        return False, f"fair-use limit ({pf.recent_llm} AI calls in 10 min)"
    return True, ""


_WHAT_ABOUT = re.compile(r"^\s*(?:and\s+)?(?:what|how)\s+about\s+(.+?)\s*\??\s*$", re.I)
_FOLLOW = re.compile(r"^\s*(?:and|also|same for|then|so)\b", re.I)
_PRONOUN = re.compile(r"\b(?:it|its|they|them|their|he|she|his|her)\b"
                      r"|\b(?:that|those|this|these)\b(?=\s*(?:$|[?.!,]|is\b|are\b|was\b|were\b|one\b|mean))", re.I)


_ROLE_WORDS = (r"(?:system\s+)?admin(?:istrator)?|hod|head\s+of\s+(?:the\s+)?department|principal|dean|registrar|"
               r"finance(?:\s+officer)?|accounts?\s+officer|hr|faculty|professor|teacher|staff|sir|madam|ma'am")
_CLAIMS = [
    # "I am the admin", "I'm HOD of CSE", "as the principal"
    re.compile(rf"\b(?:i\s+am|i'm|im|as)\s+(?:an?\s+|the\s+)?(?:\w+\s+){{0,2}}(?:{_ROLE_WORDS})\b(?:\s+of\s+\w+)?[.,!]?", re.I),
    # "main bhi CSE ka HOD hoon", "mai admin hu"
    re.compile(rf"\b(?:main|mai|mein|me)\s+(?:bhi\s+)?(?:\w+\s+){{0,3}}(?:{_ROLE_WORDS})\s+(?:hoon|hun|hu|hai|hoo)\b[.,!]?", re.I),
    # Hindi / Gujarati: "मैं ... HOD हूँ", "હું ... HOD છું"
    re.compile(rf"(?:मैं|में)\s+(?:\S+\s+){{0,3}}?(?:{_ROLE_WORDS}|एडमिन|प्रिंसिपल|प्रधानाचार्य|डीन|शिक्षक|प्रोफेसर|विभागाध्यक्ष)\s+(?:हूँ|हूं|हु)[।,!]?", re.I),
    re.compile(rf"હું\s+(?:\S+\s+){{0,3}}?(?:{_ROLE_WORDS}|એડમિન|પ્રિન્સિપાલ|ડીન|શિક્ષક|પ્રોફેસર|વિભાગાધ્યક્ષ)\s+છું[.,!]?", re.I),
]


def strip_identity_claims(question: str) -> tuple[str, str | None]:
    """Remove "I am the admin"-style claims from the search text. Identity only ever comes from the
    signed login token, so a claim in the question can only add noise to retrieval."""
    claim = None
    for rx in _CLAIMS:
        m = rx.search(question)
        if m:
            claim = claim or m.group(0).strip(" .,!")
            question = rx.sub(" ", question)
    return re.sub(r"\s+", " ", question).strip(" ,"), claim


def rewrite_followup(question: str, history: list[dict]) -> str | None:
    """A standalone version of a follow-up question, or None when it already stands alone.
    Deterministic on purpose: no model call, and the rewrite is shown to the user."""
    if not history:
        return None
    prev = (history[-1].get("question") or "").strip()
    if not prev:
        return None
    q = question.strip()
    m = _WHAT_ABOUT.match(q)
    if m:
        subject = m.group(1)
        new, old = mentioned_departments(subject), mentioned_departments(prev)
        if new and old:
            out = prev
            target = sorted(new)[0]
            for d in old:
                out = re.sub(DEPTS[d], target, out, flags=re.I)
            return out
        return f"{prev.rstrip(' ?')}: {subject}?"
    words = len(q.split())
    if (_FOLLOW.match(q) and words <= 8) or (_PRONOUN.search(q) and words <= 10):
        return f"{q.rstrip(' ?')} (about: {prev.rstrip(' ?')})?"
    return None


async def egress(user: UserCtx, sentences: list[dict]) -> tuple[list[dict], dict]:
    report = {"blocked": False, "redacted": 0, "canaries": []}
    text = " ".join(s["text"] for s in sentences if not s.get("removed"))
    tokens = sorted(set(CANARY.findall(text)))
    if tokens:
        visible: set[str] = set()
        try:
            async with secure_session(user) as conn:
                rows = await (await conn.execute("SELECT token FROM canaries WHERE token = ANY(%s)", (tokens,))).fetchall()
            visible = {r["token"] for r in rows}
        except Exception:
            pass  # unknown: treat every token as forbidden
        forbidden = [t for t in tokens if t not in visible]
        if forbidden:
            report.update(blocked=True, canaries=forbidden)
            return [], report
    if "admin" not in user.roles:
        for s in sentences:
            new, n = PHONE.subn("[phone redacted]", s["text"])
            new, m = NATIONAL_ID.subn("[ID redacted]", new)
            if n or m:
                s["text"] = new
                report["redacted"] += n + m
    return sentences, report
