"""Design vocabulary: colour names, curated palettes and keyword maps."""
from __future__ import annotations

NAMED_COLORS = {
    "black": "#111111", "white": "#f7f7f5", "red": "#d62828", "crimson": "#b3122e", "maroon": "#6d1a2a",
    "burgundy": "#7a1f3d", "orange": "#f07c1b", "saffron": "#f39c26", "rust": "#b24a1c", "coral": "#f26b5b",
    "peach": "#f6b48f", "yellow": "#f5c518", "gold": "#c9a227", "mustard": "#d4a017", "lime": "#9bd62a",
    "green": "#1f8a3b", "emerald": "#0d8a5f", "mint": "#8fe3c0", "olive": "#6b7a2a", "forest green": "#1d4d2b",
    "neon green": "#39ff14", "teal": "#0e7c7b", "turquoise": "#1bb6b0", "cyan": "#12b5d6", "sky blue": "#5bb8ea",
    "blue": "#1f5fbf", "royal blue": "#2446a6", "navy": "#14213d", "cobalt": "#0047ab", "indigo": "#3b2a8f",
    "purple": "#6a2c91", "violet": "#7f3fbf", "lavender": "#b9a6e0", "magenta": "#c2187a", "pink": "#ef6fa7",
    "hot pink": "#ff2e88", "brown": "#6b4226", "khaki": "#b7a36a", "sand": "#d8c39a", "beige": "#e3d5b8",
    "cream": "#f3ead3", "silver": "#b8bcc2", "grey": "#7d8288", "gray": "#7d8288", "charcoal": "#2e3136",
    "neon orange": "#ff6b1a", "neon yellow": "#e6ff2a",
}

# name, primary, secondary, accent, trim, text, tags
PALETTES = [
    ("Midnight Volt", "#14213d", "#1f5fbf", "#e6ff2a", "#0b1124", "#f7f7f5", {"aggressive", "night", "electric", "football", "esports"}),
    ("Blaze", "#d62828", "#f07c1b", "#f5c518", "#111111", "#f7f7f5", {"aggressive", "fire", "cricket", "football", "kabaddi"}),
    ("Ocean Surge", "#0e7c7b", "#1bb6b0", "#f7f7f5", "#0b3b3a", "#f7f7f5", {"ocean", "tropical", "calm", "volleyball", "running"}),
    ("Royal Heritage", "#2446a6", "#c9a227", "#f7f7f5", "#14213d", "#f7f7f5", {"retro", "classic", "premium", "cricket", "rugby"}),
    ("Forest Trail", "#1d4d2b", "#6b7a2a", "#d8c39a", "#111111", "#f3ead3", {"nature", "outdoor", "trail", "running", "cycling", "camo"}),
    ("Saffron Sun", "#f39c26", "#1f5fbf", "#f7f7f5", "#14213d", "#14213d", {"festive", "india", "cricket", "kabaddi", "bright"}),
    ("Carbon", "#1a1c20", "#2e3136", "#d62828", "#111111", "#f7f7f5", {"minimal", "stealth", "dark", "cycling", "esports"}),
    ("Maroon Legacy", "#6d1a2a", "#c9a227", "#f3ead3", "#2b0a11", "#f3ead3", {"retro", "classic", "vintage", "rugby", "cricket"}),
    ("Neon Arcade", "#1a0f3a", "#c2187a", "#12b5d6", "#0a0620", "#f7f7f5", {"esports", "neon", "electric", "futuristic"}),
    ("Glacier", "#f7f7f5", "#5bb8ea", "#14213d", "#2446a6", "#14213d", {"minimal", "clean", "ice", "badminton", "running"}),
    ("Tropic Punch", "#ef6fa7", "#f5c518", "#1bb6b0", "#6a2c91", "#14213d", {"tropical", "summer", "fun", "volleyball", "netball"}),
    ("Emerald Pride", "#0d8a5f", "#f7f7f5", "#c9a227", "#073d2a", "#f7f7f5", {"classic", "hockey", "football", "nature"}),
    ("Storm", "#2e3136", "#7d8288", "#f5c518", "#111111", "#f5c518", {"storm", "aggressive", "electric", "rugby", "basketball"}),
    ("Sunset Drive", "#6a2c91", "#f26b5b", "#f39c26", "#2a1140", "#f7f7f5", {"retro", "sunset", "gradient", "basketball", "running"}),
    ("Desert Camo", "#b7a36a", "#6b4226", "#d8c39a", "#3a2a18", "#111111", {"camo", "military", "outdoor"}),
    ("Ice Hockey", "#f7f7f5", "#b3122e", "#14213d", "#14213d", "#b3122e", {"hockey", "classic", "clean"}),
]

PATTERN_KEYWORDS = {
    "pinstripe": ["pinstripe", "pin stripe", "baseball"],
    "stripes": ["stripe", "stripes", "striped", "hoops", "bands"],
    "chevron": ["chevron", "zigzag", "zig zag", "arrow"],
    "camo": ["camo", "camouflage", "military", "army"],
    "halftone": ["halftone", "dots", "dotted", "polka", "pop art", "comic"],
    "geometric": ["geometric", "polygon", "low poly", "triangle", "tribal", "maori", "kolam", "aztec", "mosaic"],
    "hexagon": ["hexagon", "hex", "honeycomb", "carbon fibre", "carbon fiber"],
    "waves": ["wave", "waves", "ocean", "water", "flow", "surf", "river"],
    "shards": ["shard", "lightning", "thunder", "electric", "storm", "shatter", "glass", "bolt"],
    "splatter": ["splatter", "paint", "graffiti", "grunge", "ink", "holi", "street"],
    "topo": ["topo", "topographic", "contour", "mountain", "terrain", "trail", "map"],
    "gradient": ["gradient", "fade", "ombre", "sunset"],
}

MOOD_PATTERNS = {
    "aggressive": ["shards", "chevron", "splatter"], "fierce": ["shards", "chevron"],
    "retro": ["stripes", "pinstripe", "halftone"], "vintage": ["pinstripe", "stripes"],
    "classic": ["stripes", "pinstripe"], "minimal": ["pinstripe", "gradient", "halftone"],
    "clean": ["pinstripe", "gradient"], "tropical": ["waves", "geometric"], "summer": ["waves", "halftone"],
    "futuristic": ["hexagon", "geometric", "shards"], "tech": ["hexagon", "geometric"],
    "nature": ["topo", "camo", "waves"], "outdoor": ["topo", "camo"], "fast": ["chevron", "shards", "stripes"],
    "speed": ["chevron", "shards"], "festive": ["splatter", "geometric"], "neon": ["hexagon", "shards"],
    "premium": ["pinstripe", "gradient"], "bold": ["stripes", "chevron", "geometric"],
}

SPORT_PATTERNS = {
    "football": ["stripes", "chevron", "geometric", "shards"], "cricket": ["gradient", "shards", "geometric", "halftone"],
    "basketball": ["halftone", "geometric", "splatter"], "rugby": ["stripes", "chevron", "geometric"],
    "hockey": ["stripes", "chevron"], "volleyball": ["waves", "geometric"], "kabaddi": ["shards", "splatter", "geometric"],
    "cycling": ["topo", "gradient", "chevron", "hexagon"], "running": ["topo", "waves", "gradient"],
    "esports": ["hexagon", "shards", "geometric"], "netball": ["waves", "geometric"], "badminton": ["shards", "waves"],
}

SPORT_ALIASES = {"soccer": "football", "futsal": "football", "t20": "cricket", "ipl": "cricket", "gaming": "esports",
                 "bike": "cycling", "marathon": "running", "athletics": "running", "hoops": "basketball"}

ADJECTIVES = ["Midnight", "Thunder", "Velocity", "Monsoon", "Apex", "Phantom", "Solar", "Crimson", "Glacier",
              "Rogue", "Titan", "Neon", "Heritage", "Voltage", "Summit", "Tidal", "Ember", "Nova"]
NOUNS = ["Strike", "Surge", "Pulse", "Edge", "Rush", "Storm", "Legacy", "Flare", "Drift", "Charge",
         "Rise", "Force", "Ridge", "Wave", "Blitz", "Crest"]
