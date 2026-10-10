"""Small talk. Greetings, thanks, "how are you", "who are you / what can you do" and goodbyes get a
conversational reply in the user's own style instead of the uniform refusal.

Safety: a small-talk reply never touches retrieval and contains no facts from the knowledge base, so it
needs no citation and cannot leak. The suggested questions depend only on the user's signed role, never
on what exists in the corpus. Detection is deterministic (no model call) and only fires on short
messages with no question topic in them."""

import re

from .retrieve import subject_terms
from .style import Style

_INTENTS: list[tuple[str, re.Pattern]] = [
    ("thanks", re.compile(r"\b(thanks|thank\s*you|thx|ty|shukriya|dhanyavaad|dhanyavad|aabhar|aabhaar)\b|धन्यवाद|शुक्रिया|આભાર", re.I)),
    ("bye", re.compile(r"\b(bye|goodbye|good\s*night|see\s*you|alvida|chalo|chal\s*bye|tata)\b|अलविदा|આવજો", re.I)),
    ("who", re.compile(r"\b(who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|how\s+do(es)?\s+(you|this)\s+work|help( me)?|"
                       r"(tum|aap|tu)\s+(kaun|kon)\s+(ho|hai)|kya\s+kar\s+sakt[ea]\s+ho|tame\s+kon\s+cho)\b|तुम कौन|आप कौन|તમે કોણ", re.I)),
    ("how", re.compile(r"\b(how\s+are\s+you|how\s+r\s+u|how's\s+it\s+going|what'?s\s+up|wassup|sup|kaisa\s+hai|kaise\s+ho|kaisi\s+ho|"
                       r"kya\s+haal|kya\s+chal\s+raha|kem\s+cho|majama|maja\s+ma)\b|कैसे हो|कैसा है|क्या हाल|કેમ છો|મજામાં", re.I)),
    ("greet", re.compile(r"^\W*(hi+|hello+|hey+|hii+|yo|namaste|namaskar|namaskaar|good\s+(morning|afternoon|evening)|"
                         r"jai\s+shree\s+krishna|ram\s+ram|salaam|bhai|bro|yaar)\b|नमस्ते|नमस्कार|નમસ્તે|જય શ્રી કૃષ્ણ", re.I)),
]
# Words that only carry the greeting; anything else is treated as a topic.
_FILLER = set("""hi hii hiii hello hey yo namaste namaskar namaskaar good morning afternoon evening night bhai bro yaar dost buddy
how are you r u is it going what s up wassup sup kaisa kaise kaisi hai ho haal kya chal raha kem cho majama maja ma thanks thank
thx ty shukriya dhanyavaad dhanyavad aabhar bye goodbye see alvida chalo tata who can do does this work help me tum aap tu kaun kon
sakte sakta tame jai shree krishna ram salaam the a an ok okay acha accha and to you there sir madam ji please pls na re are arre
""".split())


def intent(question: str) -> str | None:
    q = question.strip()
    if not q or len(q.split()) > 9:
        return None
    hit = next((name for name, rx in _INTENTS if rx.search(q)), None)
    if not hit:
        return None
    latin = re.findall(r"[a-z']+", q.lower())
    topic = [w for w in latin if w not in _FILLER] + sorted(subject_terms(q) - _FILLER)
    return None if topic else hit  # "hi, what is my fee?" is a question, not small talk


def suggestions(roles: list[str]) -> list[str]:
    if "student" in roles:
        return ["What are my pending fees?", "What is the minimum attendance needed to sit the exam?", "When do end-semester exams begin?"]
    if "finance" in roles:
        return ["Who has pending fee payments?", "What is the average pending fee by department?", "Is a fee increase planned for 2027-28?"]
    if "hr" in roles:
        return ["Summarise the faculty appraisal results.", "How many faculty are recommended for promotion?", "What is the B.Tech fee structure this year?"]
    if "hod" in roles:
        return ["What is my department's budget for 2026-27?", "How much of the budget has been utilised?", "What was the placement percentage last year?"]
    if "faculty" in roles:
        return ["By how much can moderation revise marks?", "How early must question papers be submitted?", "What was the CSE placement percentage last year?"]
    return ["What is the B.Tech fee structure this year?", "When is the robotics workshop?", "How many students are in each department?"]


_R = {
    ("greet", "en", "formal"): ["Hello {first}! I can answer questions from the university documents and records you're cleared to read."],
    ("greet", "en", "bhai"): ["Hey {first}! Good to see you. Ask me anything about college stuff and I'll find it in the sources you can see."],
    ("greet", "hinglish", "formal"): ["Namaste {first}! Main aapke liye available university documents aur records se jawab de sakta hoon."],
    ("greet", "hinglish", "bhai"): ["Arre {first} bhai, kya haal! Bol, college ke baare mein kya jaanna hai? Main tere sources se dhoond deta hoon."],
    ("greet", "hi", "formal"): ["नमस्ते {first}! मैं आपके लिए उपलब्ध दस्तावेज़ों और रिकॉर्ड से जवाब दे सकता हूँ।"],
    ("greet", "hi", "bhai"): ["अरे {first} भाई, क्या हाल! बोल, कॉलेज के बारे में क्या जानना है?"],
    ("greet", "gu", "formal"): ["નમસ્તે {first}! હું તમારા માટે ઉપલબ્ધ દસ્તાવેજો અને રેકોર્ડમાંથી જવાબ આપી શકું છું."],
    ("greet", "gu", "bhai"): ["અરે {first} ભાઈ, કેમ છે! બોલ, કોલેજ વિશે શું જાણવું છે?"],
    ("how", "en", "formal"): ["I'm doing well, thank you for asking, {first}. How can I help you today?"],
    ("how", "en", "bhai"): ["All good here, {first}! Ready when you are. What do you want to find out?"],
    ("how", "hinglish", "formal"): ["Main bilkul theek hoon, poochne ke liye shukriya {first}. Batayiye, kya madad karun?"],
    ("how", "hinglish", "bhai"): ["Main ekdum mast hoon bhai! Tu bata, kya help chahiye? Fees, attendance, exams, sab dekh lunga."],
    ("how", "hi", "formal"): ["मैं ठीक हूँ, पूछने के लिए धन्यवाद {first}। बताइए, क्या मदद करूँ?"],
    ("how", "hi", "bhai"): ["मैं एकदम मस्त हूँ भाई! तू बता, क्या मदद चाहिए?"],
    ("how", "gu", "formal"): ["હું મજામાં છું, પૂછવા બદલ આભાર {first}. કહો, શું મદદ કરું?"],
    ("how", "gu", "bhai"): ["હું એકદમ મજામાં છું ભાઈ! તું બોલ, શું મદદ જોઈએ?"],
    ("who", "en", "formal"): ["I'm DefRAG, the university's assistant. I answer from PDFs, scanned notices and database records, "
                             "but only the ones your login allows, and every fact I give is cited to its source."],
    ("who", "en", "bhai"): ["I'm DefRAG! Think of me as the senior who has read every circular. I only use what you're allowed to see, "
                            "and I show you exactly where each answer came from."],
    ("who", "hinglish", "formal"): ["Main DefRAG hoon, university ka assistant. Main sirf wahi documents aur records use karta hoon jo aapke login ko "
                                    "allowed hain, aur har jawab ka source dikhata hoon."],
    ("who", "hinglish", "bhai"): ["Main DefRAG hoon bhai, woh senior jisne har circular padh rakha hai! Sirf tere allowed sources se bolta hoon, "
                                  "aur har baat ka proof bhi deta hoon."],
    ("who", "hi", "formal"): ["मैं DefRAG हूँ, विश्वविद्यालय का सहायक। मैं केवल वही दस्तावेज़ उपयोग करता हूँ जिनकी आपको अनुमति है, और हर जवाब का स्रोत दिखाता हूँ।"],
    ("who", "hi", "bhai"): ["मैं DefRAG हूँ भाई! सिर्फ़ तेरे अनुमति वाले स्रोतों से बोलता हूँ, और हर बात का सबूत देता हूँ।"],
    ("who", "gu", "formal"): ["હું DefRAG છું, યુનિવર્સિટીનો સહાયક. હું ફક્ત તમને માન્ય દસ્તાવેજોમાંથી જવાબ આપું છું અને દરેક જવાબનો સ્રોત બતાવું છું."],
    ("who", "gu", "bhai"): ["હું DefRAG છું ભાઈ! ફક્ત તને માન્ય સ્રોતોમાંથી બોલું છું, અને દરેક વાતનો પુરાવો આપું છું."],
    ("thanks", "en", "formal"): ["You're welcome, {first}. Ask me anything else whenever you need."],
    ("thanks", "en", "bhai"): ["Anytime, {first}! That's what I'm here for."],
    ("thanks", "hinglish", "formal"): ["Aapka swagat hai {first}. Kuch aur jaanna ho toh zaroor poochiye."],
    ("thanks", "hinglish", "bhai"): ["Arre koi baat nahi bhai! Kuch aur chahiye toh bol dena."],
    ("thanks", "hi", "formal"): ["आपका स्वागत है {first}। कुछ और जानना हो तो ज़रूर पूछिए।"],
    ("thanks", "hi", "bhai"): ["अरे कोई बात नहीं भाई! कुछ और चाहिए तो बोल देना।"],
    ("thanks", "gu", "formal"): ["આપનું સ્વાગત છે {first}. બીજું કંઈ જાણવું હોય તો જરૂર પૂછજો."],
    ("thanks", "gu", "bhai"): ["અરે કોઈ વાંધો નહીં ભાઈ! બીજું કંઈ જોઈએ તો કહેજે."],
    ("bye", "en", "formal"): ["Goodbye, {first}. Come back any time."],
    ("bye", "en", "bhai"): ["Catch you later, {first}! All the best."],
    ("bye", "hinglish", "formal"): ["Alvida {first}, phir milenge."],
    ("bye", "hinglish", "bhai"): ["Chal bhai, milte hain! All the best."],
    ("bye", "hi", "formal"): ["अलविदा {first}, फिर मिलेंगे।"],
    ("bye", "hi", "bhai"): ["चल भाई, मिलते हैं! ऑल द बेस्ट।"],
    ("bye", "gu", "formal"): ["આવજો {first}, ફરી મળીશું."],
    ("bye", "gu", "bhai"): ["ચાલ ભાઈ, મળીએ! ઑલ ધ બેસ્ટ."],
}
_NUDGE = {
    "en": "You could ask me, for example:",
    "hinglish": "Yeh pooch ke dekh:",
    "hi": "उदाहरण के लिए आप यह पूछ सकते हैं:",
    "gu": "ઉદાહરણ તરીકે તમે આ પૂછી શકો:",
}


def reply(kind: str, st: Style, name: str) -> tuple[list[str], str | None]:
    """(sentences, nudge line). Goodbyes and thanks carry no nudge."""
    first = name.replace("Dr. ", "").replace("Prof. ", "").split()[0] if name else ""
    text = [t.format(first=first).replace("  ", " ") for t in _R[(kind, st.lang, st.tone)]]
    return text, (None if kind in ("bye", "thanks") else _NUDGE[st.lang])
