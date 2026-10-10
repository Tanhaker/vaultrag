"""Reply style ("bhai mode"). The tone and language of the answer follow the question, or the user's own
pick; nothing about the user is stored or profiled. Style only changes wording: retrieval, RLS, citations,
the verifier and the uniform refusal are the same in every style.

Detection is deterministic (no model call), so it costs no quota and is shown to the user."""

import re
from dataclasses import dataclass

LANGS = ("en", "hinglish", "hi", "gu")
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_GUJARATI = re.compile(r"[઀-૿]")

# Romanised Hindi / Gujarati function words. Two or more distinct hits mark the question as Hinglish.
_HINGLISH = {
    "hai", "hain", "kya", "kyu", "kyun", "kaise", "kitna", "kitne", "kitni", "kab", "kaun", "kahan", "mujhe", "mera",
    "meri", "mere", "humko", "hamara", "tum", "aap", "ka", "ki", "ke", "ko", "se", "mein", "nahi", "nahin", "bata",
    "batao", "bataiye", "samjha", "samjhao", "samaj", "chahiye", "kar", "karo", "raha", "rahi", "baaki", "bhi", "aur",
    "toh", "yeh", "ye", "woh", "wo", "kuch", "sab", "abhi", "kal", "bhai", "yaar", "na", "haan", "accha", "acha",
    "che", "shu", "chhe", "keva", "ketla", "ketli", "mane", "maru", "tamaru", "kem", "jo", "nathi", "aapo",
    "kab", "kabb", "ni", "nai", "nahin", "pata", "aata", "ata", "samajh", "bata", "bta", "btao", "kuch", "kch", "hota", "hoti",
}
# More romanised filler that is never a search term.
_FILLER = {
    "dene", "dena", "dete", "lena", "lene", "liye", "lie", "wala", "wale", "wali", "sakta", "sakte", "sakti", "hoga",
    "hogi", "honge", "milega", "milegi", "is", "us", "iska", "uska", "please", "pls", "plz", "bro", "bhaiya", "main",
    "mai", "hoon", "hu", "ho", "tha", "thi", "the", "jaldi", "zara", "ek", "do", "de", "le", "lo", "par", "pe", "wahi",
    "saal", "mahina", "aaj", "kitni", "kitna", "kitne", "kab", "kabb", "ni", "nai", "pata", "aata", "ata", "kuch", "kch",
    "mujhe", "muje", "mko", "mujhko", "samajh", "hota", "hoti", "bta", "btao",
}
# Words that ask for a friendly register.
_CASUAL = re.compile(r"\b(bhai|bhaiya|bhaii+|yaar|yar|bro|bruh|dost|arre|are yaar|ben|behen|didi|boss)\b|भाई|यार|ભાઈ|દોસ્ત", re.I)

# Search vocabulary: regional words -> the English terms the documents use. Appended to the search text
# only; the question shown, audited and cached is the user's own.
_GLOSSARY = {
    r"\b(fees?|fis|shulk)\b|फीस|शुल्क|ફી": "fee",
    r"\b(baaki|baki|bakaya|pending|udhaar)\b|बाकी|बकाया|બાકી": "pending due",
    r"\b(kitna|kitne|kitni|ketla|ketli)\b|कितना|कितने|कितनी|કેટલા|કેટલી": "how much",
    r"\b(hazri|haziri|attendance)\b|उपस्थिति|हाजिरी|હાજરી": "attendance",
    r"\b(pariksha|exam\w*|imtihaan|paper)\b|परीक्षा|પરીક્ષા": "exam examinations",
    r"\b(kab+|kabhi|kyare)\b|कब|ક્યારે": "when date begin",
    r"\b(niyam|rule|kanoon)\b|नियम|નિયમ": "rule policy",
    r"\b(chhutti|chutti|holiday)\b|छुट्टी|રજા": "holiday leave",
    r"\b(paisa|paise|budget)\b|बजट|બજેટ": "budget",
    r"\b(tankhwah|tankha|pagar|salary)\b|वेतन|तनख्वाह|પગાર": "salary",
    r"\b(aakhri|antim|last)\s*(tareekh|tarikh|date)\b|अंतिम तिथि|છેલ્લી તારીખ": "last date deadline",
    r"\b(tareekh|tarikh)\b|तारीख|તારીખ": "date",
    r"\b(vibhag|department)\b|विभाग|વિભાગ": "department",
    r"\b(chhatravritti|scholarship)\b|छात्रवृत्ति|શિષ્યવૃત્તિ": "scholarship",
    r"\b(nyunatam|kam se kam|minimum)\b|न्यूनतम|ઓછામાં ઓછી": "minimum",
}
_GLOSS = [(re.compile(p, re.I), en) for p, en in _GLOSSARY.items()]


@dataclass(frozen=True)
class Style:
    lang: str = "en"         # en | hinglish | hi | gu
    tone: str = "formal"     # formal | bhai
    detected: bool = False   # True when chosen from the question rather than picked by the user

    @property
    def key(self) -> str:
        """Cache-key fragment. The default style is empty so earlier cache entries stay valid."""
        return "" if (self.lang, self.tone) == ("en", "formal") else f"{self.lang}-{self.tone}"

    @property
    def label(self) -> str:
        lang = {"en": "English", "hinglish": "Hinglish", "hi": "हिंदी", "gu": "ગુજરાતી"}[self.lang]
        return f"{'Bhai mode' if self.tone == 'bhai' else 'Formal'} · {lang}"


_STRETCH = re.compile(r"(\w)\1{2,}")
_PUNCT_RUN = re.compile(r"([?!.])\1+")


def normalize(question: str) -> str:
    """Undo chat-style stretching ("exammm kabb haiii????" -> "exam kabb hai?") so words match the
    vocabulary. Letters repeated three or more times collapse to one; doubled letters stay ("book")."""
    q = _STRETCH.sub(r"\1", question)
    return _PUNCT_RUN.sub(r"\1", q).strip()


def detect_lang(question: str) -> str:
    if _GUJARATI.search(question):
        return "gu"
    if _DEVANAGARI.search(question):
        return "hi"
    words = set(re.findall(r"[a-z]+", question.lower()))
    return "hinglish" if len(words & _HINGLISH) >= 2 else "en"


def resolve(question: str, tone: str = "auto", lang: str = "auto") -> Style:
    """tone: auto | formal | bhai. lang: auto | en | hinglish | hi | gu."""
    detected_lang = detect_lang(question)
    out_lang = lang if lang in LANGS else detected_lang
    if tone in ("formal", "bhai"):
        out_tone = tone
    else:
        out_tone = "bhai" if _CASUAL.search(question) else "formal"
    return Style(out_lang, out_tone, detected=(tone not in ("formal", "bhai") and lang not in LANGS))


def search_text(question: str) -> str:
    """The question plus English search terms for any regional words in it. English questions are
    searched exactly as asked, so measured retrieval results are unchanged."""
    lang = detect_lang(question)
    if lang == "en":
        return question
    extra = [en for rx, en in _GLOSS if rx.search(question)]
    if lang == "hinglish":
        # Romanised Hindi filler would count as unmatched search terms; keep only the content words.
        words = re.findall(r"[\w.%₹-]+", question)
        question = " ".join(w for w in words if w.lower().strip(".") not in _HINGLISH | _FILLER)
    return f"{question} {' '.join(dict.fromkeys(extra))}".strip()


# --- wording -------------------------------------------------------------------------------------------
# Refusals are the same whether the information is missing or forbidden, in every style.

REFUSALS = {
    ("en", "formal"): "I don't have information on that in the sources available to you.",
    ("en", "bhai"): "Sorry bro, I don't have information on that in the sources available to you.",
    ("hinglish", "formal"): "Aapke liye available sources mein is baare mein jaankari nahi hai.",
    ("hinglish", "bhai"): "Sorry bhai, tere liye available sources mein is baare mein kuch nahi hai.",
    ("hi", "formal"): "आपके लिए उपलब्ध स्रोतों में इस बारे में जानकारी नहीं है।",
    ("hi", "bhai"): "सॉरी भाई, तेरे लिए उपलब्ध स्रोतों में इस बारे में कुछ नहीं है।",
    ("gu", "formal"): "તમારા માટે ઉપલબ્ધ સ્રોતોમાં આ વિશે માહિતી નથી.",
    ("gu", "bhai"): "સોરી ભાઈ, તારા માટે ઉપલબ્ધ સ્રોતોમાં આ વિશે કંઈ નથી.",
}

# A greeting line shown above answers in bhai mode. It carries no facts, so it is not a cited sentence.
GREETINGS = {
    "en": "Got you, bro. Here's what the sources say:",
    "hinglish": "Arre bhai, tension mat le. Yeh raha seedha source se:",
    "hi": "अरे भाई, टेंशन मत ले। ये रहा सीधा स्रोत से:",
    "gu": "અરે ભાઈ, ચિંતા ના કર. આ રહ્યું સીધું સ્રોતમાંથી:",
}


def refusal(st: Style) -> str:
    return REFUSALS[(st.lang, st.tone)]


def greeting(st: Style) -> str | None:
    return GREETINGS[st.lang] if st.tone == "bhai" else None


def prompt_rules(st: Style) -> str:
    """Extra instructions for the answer model. Empty for the default style."""
    if not st.key:
        return ""
    lang = {
        "en": "Write in simple English.",
        "hinglish": "Write in Hinglish: Hindi in Roman script mixed with common English words, the way students text.",
        "hi": "Write in Hindi (Devanagari script).",
        "gu": "Write in Gujarati (Gujarati script).",
    }[st.lang]
    tone = ("Sound like a warm, helpful elder brother explaining to a younger student: friendly and encouraging, "
            "never rude, no slang beyond 'bhai' or 'yaar', no emojis." if st.tone == "bhai" else "Keep a polite, formal tone.")
    return (f"\nStyle:\n- {lang}\n- {tone}\n"
            "- The style changes only the wording. Keep every fact, number (as digits), date, amount and name exactly as in the sources, "
            "and keep every citation. A friendly tone never justifies using anything outside the sources.")
