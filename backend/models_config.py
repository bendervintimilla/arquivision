"""
Single source of truth for model IDs, tier mapping, and pricing.

Phase 0 (today): Mirror current Gemini-only setup. Zero behavior change.
Phase 1 (next): Add OpenAI (gpt-image-2) as primary for tiers 1/2/3, with
Gemini Pro as silent fallback. Touch only this file + provider dispatch in
main.py — no other call sites should reference model IDs directly.
"""
import os

# ---------- Image models ----------

# Today's primary image model (tiers 1/2/3 by default)
# Phase 1: this becomes the fallback; OPENAI_IMAGE_MODEL takes the primary slot.
GEMINI_PRO_IMAGE = "gemini-3-pro-image-preview"

# Draft / fast iteration image model (tier 0 always)
GEMINI_FAST_IMAGE = "gemini-2.5-flash-image"

# Phase 1 target — env-overridable so we can swap without code changes
OPENAI_IMAGE_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2")

# ---------- Text / vision models (unchanged across phases) ----------

# Used for intent classification, scene analysis, context summarization
GEMINI_FAST_TEXT = "gemini-2.5-flash"

# ---------- Video model (Phase 5 reconsiders) ----------

VIDEO_MODEL = "veo-3.1-fast-generate-preview"
VIDEO_MODEL_STANDARD = "veo-3.1-generate-preview"  # Phase 5 fallback / quality tier

# ---------- Tier configuration ----------
#
# Phase 0 (today): provider == "gemini" everywhere except note the intent.
# Phase 1 (next): flip provider to "openai" for tiers 1/2/3 by changing this
# table only — the dispatcher in main.py reads `provider` to choose the client.

# Phase 1 ACTIVE: tiers 1/2/3 route to OpenAI gpt-image-2 by default.
# Tier 0 stays on Gemini Flash (cheap iteration). On any OpenAI failure
# the dispatcher walks FALLBACK_CHAIN to Gemini Pro then Gemini Flash.
TIER_CONFIG = {
    0: {
        "provider": "gemini",
        "model": GEMINI_FAST_IMAGE,
        "image_size": None,  # Flash uses its default
        "n": 1,
        "label": "Draft",
    },
    1: {
        "provider": "openai",
        "model": OPENAI_IMAGE_MODEL,
        "image_size": "1K",
        "n": 2,  # batch of 2 variations for the architect to choose
        "label": "Standard",
    },
    2: {
        "provider": "openai",
        "model": OPENAI_IMAGE_MODEL,
        "image_size": "2K",
        "n": 2,  # batch of 2 variations at HD
        "label": "HD",
    },
    3: {
        "provider": "openai",
        "model": OPENAI_IMAGE_MODEL,
        "image_size": "4K",
        "n": 1,  # Ultra is the hero shot — single image, no batch
        "label": "Ultra",
    },
}

# Per-provider fallback chain. When the primary provider/model fails (503,
# 429, network), the dispatcher walks this chain in order. Each step is
# (provider, model). Phase 1 wires this; Phase 0 keeps the legacy single
# 503-fallback path inside the dispatcher.

FALLBACK_CHAIN = {
    "openai": [("gemini", GEMINI_PRO_IMAGE), ("gemini", GEMINI_FAST_IMAGE)],
    "gemini": [("gemini", GEMINI_FAST_IMAGE)],
}

# ---------- Pricing ----------
#
# Two units appear here:
#   per-token (text/vision models, prompt + completion)
#   per-image (image generation models, by output resolution)
#
# Costs are USD per 1K tokens (text) OR USD per image (image). Cost
# computation in main.py picks the right unit based on the model's entry
# shape.

MODEL_PRICING = {
    # Text/vision — per 1K tokens
    GEMINI_FAST_TEXT:    {"input_per_1k": 0.000075, "output_per_1k": 0.000300},

    # Image — per call (Gemini bills per output image; resolution affects
    # tokens but we charge a flat per-image rate at our level)
    GEMINI_FAST_IMAGE:   {"per_image": 0.005},
    GEMINI_PRO_IMAGE:    {"per_image": 0.080},

    # Phase 1: OpenAI gpt-image-2 pricing differs by output size.
    # Confirm current prices at integration time — placeholders below.
    OPENAI_IMAGE_MODEL: {
        "per_image_by_size": {
            "1K":          0.080,
            "1024x1024":   0.080,
            "1536x1024":   0.120,
            "1024x1536":   0.120,
            "2K":          0.120,
            "2048x2048":   0.250,
            "4K":          0.250,
        },
        # Reasoning tokens are billed separately by OpenAI for gpt-image-2
        "reasoning_per_1k": 0.015,
    },
}

# ---------- Quality-tier prompt suffixes ----------
#
# Appended to the user prompt at generation time to nudge the model toward
# the expected output quality for the tier. Tier 3 is a checklist (not an
# adjective stack) — models follow checklists more reliably.

QUALITY_PROMPT_SUFFIX = {
    0: "",
    1: "\nOUTPUT QUALITY: High quality architectural render.",
    2: (
        "\nOUTPUT QUALITY: Professional HD quality. Sharp details, accurate "
        "material textures, correct lighting physics. No compression artifacts."
    ),
    3: (
        "\nOUTPUT QUALITY — Ultra 4K. Verify before finalizing:\n"
        "[ ] Every material surface shows visible texture "
        "(wood grain, stone veining, fabric weave)\n"
        "[ ] Shadows have correct soft falloff and contact darkening\n"
        "[ ] Specular highlights present on glass, metal, polished surfaces\n"
        "[ ] Reflections in mirrors and water are geometrically correct\n"
        "[ ] No banding in color gradients\n"
        "[ ] No jagged edges on furniture silhouettes\n"
        "[ ] Window exteriors are photographic, not painterly\n"
        "[ ] Any visible text is legible and spelled correctly"
    ),
}

# ---------- Helpers ----------

def get_tier_config(tier: int) -> dict:
    """Clamp the tier to a valid range and return its config."""
    tier = max(0, min(3, int(tier)))
    return TIER_CONFIG[tier]


def estimate_image_cost(model: str, image_size: str | None) -> float:
    """Estimate the per-call cost for an image generation model."""
    pricing = MODEL_PRICING.get(model, {})
    if "per_image" in pricing:
        return float(pricing["per_image"])
    if "per_image_by_size" in pricing and image_size:
        return float(pricing["per_image_by_size"].get(image_size, 0.0))
    return 0.0
