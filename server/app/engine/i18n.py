"""Hindi, Telugu and Tamil support for the offline engine.

The rule engine reads English keywords, so native-script words for colours,
sports, patterns and themes are mapped to their English keyword and appended to
the prompt. Names and numbers are never translated: they are extracted from the
original text so the customer's exact spelling survives.
"""
from __future__ import annotations

import re

LANGUAGE_NAMES = {
    "en": ("English", "English"),
    "hi": ("Hindi", "हिन्दी"),
    "te": ("Telugu", "తెలుగు"),
    "ta": ("Tamil", "தமிழ்"),
}

_SCRIPTS = {"hi": (0x0900, 0x097F), "te": (0x0C00, 0x0C7F), "ta": (0x0B80, 0x0BFF)}
_DIGIT_ZERO = (0x0966, 0x0C66, 0x0BE6)   # Devanagari, Telugu, Tamil zero

KEYWORDS: dict[str, dict[str, str]] = {
    "hi": {
        # colours
        "लाल": "red", "नीला": "blue", "नीले": "blue", "नीली": "blue", "हरा": "green", "हरे": "green", "हरी": "green",
        "पीला": "yellow", "पीले": "yellow", "पीली": "yellow", "काला": "black", "काले": "black", "काली": "black",
        "सफेद": "white", "सफ़ेद": "white", "नारंगी": "orange", "केसरिया": "saffron", "भगवा": "saffron",
        "गुलाबी": "pink", "बैंगनी": "purple", "सुनहरा": "gold", "सुनहरे": "gold", "सुनहरी": "gold", "सोने": "gold",
        "चांदी": "silver", "भूरा": "brown", "आसमानी": "sky blue", "मैरून": "maroon", "नेवी": "navy", "स्लेटी": "grey",
        "फ़िरोज़ी": "turquoise", "फिरोजी": "turquoise",
        # sports
        "फुटबॉल": "football", "क्रिकेट": "cricket", "बास्केटबॉल": "basketball", "रग्बी": "rugby", "हॉकी": "hockey",
        "वॉलीबॉल": "volleyball", "कबड्डी": "kabaddi", "साइकिलिंग": "cycling", "साइकिल": "cycling", "दौड़": "running",
        "रनिंग": "running", "ईस्पोर्ट्स": "esports", "नेटबॉल": "netball", "बैडमिंटन": "badminton",
        # patterns and themes
        "धारियाँ": "stripes", "धारियां": "stripes", "धारी": "stripes", "लहरें": "waves", "लहर": "waves",
        "बिजली": "lightning", "आग": "fire", "तूफान": "storm", "तूफ़ान": "storm", "पहाड़": "mountain", "बाघ": "tiger",
        "शेर": "lion", "मोर": "peacock", "कमल": "lotus", "तिरंगा": "tricolor", "रेट्रो": "retro", "आक्रामक": "aggressive",
        "कैमो": "camo", "छलावरण": "camo", "ज्यामितीय": "geometric", "षट्कोण": "hexagon", "बिंदु": "dots",
        "आधुनिक": "modern", "क्लासिक": "classic",
        # garments
        "कॉलर": "collar", "कफ": "cuffs", "पैटर्न": "pattern", "डिज़ाइन": "design", "डिजाइन": "design",
        "रंग": "colour", "करो": "make", "करें": "make", "बनाओ": "make", "बनाएं": "make", "बदलो": "change",
        "जर्सी": "jersey", "शॉर्ट्स": "shorts", "वी-नेक": "vneck", "वी नेक": "vneck",
    },
    "te": {
        "ఎరుపు": "red", "ఎర్ర": "red", "నీలం": "blue", "నీలి": "blue", "ఆకుపచ్చ": "green", "పచ్చ": "green",
        "పసుపు": "yellow", "నలుపు": "black", "నల్ల": "black", "తెలుపు": "white", "తెల్ల": "white",
        "నారింజ": "orange", "కాషాయ": "saffron", "గులాబీ": "pink", "ఊదా": "purple", "బంగారు": "gold",
        "వెండి": "silver", "గోధుమ": "brown", "నేవీ": "navy",
        "ఫుట్‌బాల్": "football", "ఫుట్బాల్": "football", "క్రికెట్": "cricket", "బాస్కెట్‌బాల్": "basketball",
        "బాస్కెట్బాల్": "basketball", "హాకీ": "hockey", "వాలీబాల్": "volleyball", "కబడ్డీ": "kabaddi",
        "రగ్బీ": "rugby", "సైక్లింగ్": "cycling", "పరుగు": "running", "రన్నింగ్": "running",
        "బ్యాడ్మింటన్": "badminton", "నెట్‌బాల్": "netball", "ఈస్పోర్ట్స్": "esports",
        "చారలు": "stripes", "చార": "stripes", "అలలు": "waves", "అల": "waves", "మెరుపు": "lightning",
        "నిప్పు": "fire", "అగ్ని": "fire", "తుఫాను": "storm", "పులి": "tiger", "సింహం": "lion", "నెమలి": "peacock",
        "కొండ": "mountain", "రెట్రో": "retro", "ఆధునిక": "modern", "కామో": "camo",
        "కాలర్": "collar", "ప్యాటర్న్": "pattern", "డిజైన్": "design", "రంగు": "colour", "చేయండి": "make",
        "చెయ్యి": "make", "మార్చు": "change", "మార్చండి": "change",
        "జెర్సీ": "jersey", "షార్ట్స్": "shorts", "వి-నెక్": "vneck",
    },
    "ta": {
        "சிவப்பு": "red", "நீலம்": "blue", "நீல": "blue", "பச்சை": "green", "மஞ்சள்": "yellow",
        "கருப்பு": "black", "வெள்ளை": "white", "ஆரஞ்சு": "orange", "காவி": "saffron",
        "இளஞ்சிவப்பு": "pink", "ஊதா": "purple", "தங்கம்": "gold", "தங்க": "gold", "வெள்ளி": "silver",
        "பழுப்பு": "brown", "கடற்படை நீலம்": "navy",
        "கால்பந்து": "football", "கிரிக்கெட்": "cricket", "கூடைப்பந்து": "basketball", "ஹாக்கி": "hockey",
        "கைப்பந்து": "volleyball", "கபடி": "kabaddi", "ரக்பி": "rugby", "சைக்கிள்": "cycling", "ஓட்டம்": "running",
        "பூப்பந்து": "badminton", "இறகுப்பந்து": "badminton", "வலைப்பந்து": "netball", "இஸ்போர்ட்ஸ்": "esports",
        "கோடுகள்": "stripes", "கோடு": "stripes", "அலைகள்": "waves", "அலை": "waves", "மின்னல்": "lightning",
        "நெருப்பு": "fire", "புயல்": "storm", "புலி": "tiger", "சிங்கம்": "lion", "மயில்": "peacock",
        "மலை": "mountain", "ரெட்ரோ": "retro", "நவீன": "modern",
        "காலர்": "collar", "வடிவம்": "pattern", "டிசைன்": "design", "நிறம்": "colour", "ஆக்கு": "make",
        "மாற்று": "change", "மாற்றவும்": "change",
        "ஜெர்சி": "jersey", "ஷார்ட்ஸ்": "shorts",
    },
}

# Cue words that introduce a team, player name or number, per language.
CUES = {
    "team": ["team", "club", "टीम", "क्लब", "జట్టు", "టీమ్", "టీం", "அணி", "டீம்"],
    "player": ["player name", "player", "name", "खिलाड़ी", "नाम", "ఆటగాడు", "పేరు", "வீரர்", "பெயர்"],
    "number": ["jersey number", "number", "no.", "no", "num", "#", "नंबर", "संख्या", "నంబర్", "సంఖ్య", "எண்", "நம்பர்"],
}


def normalize_digits(text: str) -> str:
    out = []
    for ch in text:
        o = ord(ch)
        for zero in _DIGIT_ZERO:
            if zero <= o <= zero + 9:
                ch = str(o - zero)
                break
        out.append(ch)
    return "".join(out)


def detect_language(text: str) -> str | None:
    counts = {lang: sum(1 for ch in text if lo <= ord(ch) <= hi) for lang, (lo, hi) in _SCRIPTS.items()}
    lang, n = max(counts.items(), key=lambda kv: kv[1])
    return lang if n else ("en" if re.search(r"[A-Za-z]", text) else None)


def english_keywords(text: str) -> list[str]:
    """English keywords for every native-script keyword found, in order of appearance."""
    found: list[tuple[int, str]] = []
    masked = text
    for table in KEYWORDS.values():
        for word in sorted(table, key=len, reverse=True):
            start = 0
            while (i := masked.find(word, start)) >= 0:
                found.append((i, table[word]))
                masked = masked[:i] + " " * len(word) + masked[i + len(word):]
                start = i + len(word)
    return [w for _, w in sorted(found)]


def normalize(prompt: str) -> str:
    """Prompt with native digits in ASCII and English keywords appended for the rule engine."""
    text = normalize_digits(prompt)
    extra = english_keywords(text)
    return f"{text} {' '.join(extra)}" if extra else text
