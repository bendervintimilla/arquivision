"""
Native function-calling agent for ArquiVision.

Mirrors the pattern taught in the Generative AI course (Conchita): plain Python
functions are passed to `tools=[...]` in a single generate_content call and the
google-genai SDK runs the function-calling loop automatically — no LangChain,
no ADK.

Tools here produce large artifacts (rendered images) that we DON'T want to feed
back into the model (it can't consume raw bytes and it would burn tokens). So
each tool stashes its output images into a request-scoped context and returns
only a small status dict for the model to reason over. The HTTP layer reads the
collected images out of the context after the run and returns them to the client.
"""
import base64
import json
import contextvars

from models_config import (
    GEMINI_FAST_TEXT,
    TIER_CONFIG,
)

# Request-scoped state, set by run_agent() before each turn. Using contextvars
# keeps it safe across concurrent requests (each gets its own copy).
_ctx = contextvars.ContextVar("arquivision_agent_ctx")


def _extract_images(resp):
    """Pull all inline image parts out of a generate_content response."""
    out = []
    if resp.candidates:
        for part in resp.candidates[0].content.parts:
            if getattr(part, "inline_data", None):
                b64 = base64.b64encode(part.inline_data.data).decode()
                mime = part.inline_data.mime_type or "image/png"
                out.append(f"data:{mime};base64,{b64}")
    return out


def _render(model, parts, tier):
    """Run a tier's worth of image generations (honoring n variations) and push
    the results into the request context. Returns how many images were made."""
    from google.genai import types
    ctx = _ctx.get()
    image_size = tier.get("image_size")
    cfg = types.GenerateContentConfig(
        response_modalities=["IMAGE"],
        image_config=types.ImageConfig(image_size=image_size) if image_size else None,
    )
    made = 0
    for _ in range(tier.get("n", 1)):
        try:
            resp = ctx["client"].models.generate_content(model=model, contents=parts, config=cfg)
            imgs = _extract_images(resp)
            if imgs:
                ctx["images"].append(imgs[0])
                made += 1
        except Exception:
            break
    return made


def _tier_for(quality_tier):
    return TIER_CONFIG.get(max(0, min(3, int(quality_tier))), TIER_CONFIG[2])


# ------------------------------- TOOLS -------------------------------
# Each docstring IS the description the model sees — keep them precise.

def generate_render(prompt: str, quality_tier: int = 2) -> dict:
    """Generate a brand-new photorealistic architectural render from a text description.

    Use this when the user wants a NEW image created from scratch (there is no
    source photo to transform).

    Args:
        prompt: Detailed description of the architectural scene to render.
        quality_tier: 0=Draft (fast), 1=Standard, 2=HD (default), 3=Ultra.
    """
    from google.genai import types
    tier = _tier_for(quality_tier)
    made = _render(tier["model"], [types.Part.from_text(text=prompt)], tier)
    return {"status": "ok" if made else "failed", "images_generated": made, "tier": tier["label"]}


def edit_render(instruction: str, quality_tier: int = 2) -> dict:
    """Transform/enhance the image the user uploaded, following an instruction.

    Use this when the user uploaded a photo, sketch or CAD screenshot and wants
    it rendered or modified (e.g. 'render this sketch', 'make it modern',
    'add warm daylight').

    Args:
        instruction: What to change about the uploaded image.
        quality_tier: 0=Draft, 1=Standard, 2=HD (default), 3=Ultra.
    """
    from google.genai import types
    ctx = _ctx.get()
    if not ctx.get("image_b64"):
        return {"status": "error", "message": "No image was uploaded to edit."}
    tier = _tier_for(quality_tier)
    clean = ctx["image_b64"].split(",")[1] if "," in ctx["image_b64"] else ctx["image_b64"]
    parts = [
        types.Part.from_bytes(data=base64.b64decode(clean), mime_type=ctx.get("image_mime", "image/png")),
        types.Part.from_text(text=instruction),
    ]
    made = _render(tier["model"], parts, tier)
    return {"status": "ok" if made else "failed", "images_generated": made, "tier": tier["label"]}


def analyze_plan() -> dict:
    """Analyze the uploaded architectural floor plan and return detected rooms/zones.

    Use this when the user uploaded a floor plan or blueprint and asks about its
    layout, rooms or spatial structure (NOT when they want a render).
    """
    from google.genai import types
    ctx = _ctx.get()
    if not ctx.get("image_b64"):
        return {"status": "error", "message": "No floor plan was uploaded."}
    clean = ctx["image_b64"].split(",")[1] if "," in ctx["image_b64"] else ctx["image_b64"]
    resp = ctx["client"].models.generate_content(
        model=GEMINI_FAST_TEXT,
        contents=[
            types.Part.from_bytes(data=base64.b64decode(clean), mime_type=ctx.get("image_mime", "image/png")),
            types.Part.from_text(text=(
                "Analyze this architectural floor plan. Return JSON with a 'rooms' array "
                "(each {name, approx_area, notes}) and a short 'summary' string."
            )),
        ],
        config={"response_mime_type": "application/json"},
    )
    try:
        return {"status": "ok", "analysis": json.loads(resp.text or "{}")}
    except Exception:
        return {"status": "ok", "analysis_text": (resp.text or "")[:1500]}


TOOLS = [generate_render, edit_render, analyze_plan]

SYSTEM_INSTRUCTION = (
    "You are ArquiVision, an architectural rendering assistant. Pick the right tool "
    "for the user's request:\n"
    "- generate_render: a brand-new image from a text description (nothing uploaded).\n"
    "- edit_render: transform the image the user uploaded.\n"
    "- analyze_plan: inspect an uploaded floor plan's layout.\n"
    "Default to quality_tier 2 (HD) unless the user asks for fast/draft (0) or ultra (3). "
    "After the tools run, briefly tell the user what you produced in one or two sentences. "
    "The generated images are returned to the user separately — never try to describe "
    "their pixels or invent their contents."
)


def run_agent(user_message: str, image_b64: str = "", image_mime: str = "image/png", client=None):
    """Run one agent turn with native automatic function calling.

    Returns {"text": str, "images": [data_url, ...], "tools_used": [str, ...]}.
    """
    from google.genai import types

    token = _ctx.set({
        "client": client,
        "image_b64": image_b64,
        "image_mime": image_mime,
        "images": [],
    })
    try:
        # Give the routing model the image too, so it can tell a floor plan from a
        # photo and route to analyze_plan vs edit_render intelligently.
        contents = []
        if image_b64:
            clean = image_b64.split(",")[1] if "," in image_b64 else image_b64
            contents.append(types.Part.from_bytes(data=base64.b64decode(clean), mime_type=image_mime))
        contents.append(types.Part.from_text(text=user_message or "Render this."))

        resp = client.models.generate_content(
            model=GEMINI_FAST_TEXT,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                tools=TOOLS,  # ← native automatic function calling (Conchita pattern)
            ),
        )

        ctx = _ctx.get()
        tools_used = []
        try:
            for entry in (resp.automatic_function_calling_history or []):
                for p in (entry.parts or []):
                    if getattr(p, "function_call", None):
                        tools_used.append(p.function_call.name)
        except Exception:
            pass

        return {
            "text": resp.text or "",
            "images": ctx["images"],
            "tools_used": tools_used,
        }
    finally:
        _ctx.reset(token)
