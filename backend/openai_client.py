"""
OpenAI image generation client (gpt-image-2).

Two entry points mirror the Gemini path:
  openai_generate — text-to-image (no source image)
  openai_edit     — image-to-image with optional mask + reference image

Both return a list of raw PNG bytes. The caller is responsible for
base64-encoding for the JSON response and for fallback handling.

The OPENAI_API_KEY is read from the environment lazily so missing keys
don't crash module import at startup (matches the Gemini client pattern
in main.py).
"""
import base64
import io
import os
from typing import List, Optional

_client = None


def get_client():
    """Lazy-initialize the OpenAI client. Reads OPENAI_API_KEY from env.

    Timeout default 180s — gpt-image-2's reasoning loop empirically takes
    ~100-120s for HD renders. Retries are disabled (max_retries=0): we have
    our own fallback chain to Gemini Pro in main.py, and SDK-level retries
    would multiply latency without adding reliability.
    """
    global _client
    if _client is None:
        from openai import OpenAI
        api_key = os.environ.get("OPENAI_API_KEY", "")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        timeout = float(os.environ.get("OPENAI_IMAGE_TIMEOUT_S", "180"))
        _client = OpenAI(api_key=api_key, timeout=timeout, max_retries=0)
    return _client


# ---------- size mapping ----------

# Our tier config uses "1K" / "2K" / "4K" labels.
# OpenAI gpt-image-2 takes explicit pixel sizes.
_SIZE_MAP = {
    "1K": "1024x1024",
    "2K": "1536x1024",   # landscape default — good for arch interiors
    "4K": "2048x2048",
    # Pass through anything that's already explicit
    "1024x1024": "1024x1024",
    "1536x1024": "1536x1024",
    "2048x2048": "2048x2048",
}

def _resolve_size(size: Optional[str]) -> str:
    if not size:
        return "1024x1024"
    return _SIZE_MAP.get(size, size)


def _b64_to_bytes(maybe_data_url: Optional[str]) -> Optional[bytes]:
    """Accept either a plain base64 string or a data: URL."""
    if not maybe_data_url:
        return None
    if "," in maybe_data_url:
        maybe_data_url = maybe_data_url.split(",", 1)[1]
    return base64.b64decode(maybe_data_url)


# ---------- public API ----------

def openai_generate(prompt: str, n: int = 1, size: Optional[str] = None,
                    quality: str = "high") -> List[bytes]:
    """Text-to-image. Returns N PNG byte payloads.

    quality: "low" | "medium" | "high". For pure text-to-image we default to
    high because there's no source to be faithful to.
    """
    client = get_client()
    model = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2")
    resp = client.images.generate(
        model=model,
        prompt=prompt,
        n=n,
        size=_resolve_size(size),
        quality=quality,
    )
    out: List[bytes] = []
    for d in resp.data:
        # gpt-image-2 returns b64_json by default
        if getattr(d, "b64_json", None):
            out.append(base64.b64decode(d.b64_json))
        elif getattr(d, "url", None):
            # Fallback path if some accounts get URL responses
            import urllib.request
            with urllib.request.urlopen(d.url) as r:
                out.append(r.read())
    return out


def openai_edit(
    prompt: str,
    image_b64: str,
    mask_b64: Optional[str] = None,
    reference_b64: Optional[str] = None,
    n: int = 1,
    size: Optional[str] = None,
    quality: str = "medium",
) -> List[bytes]:
    """Edit an existing image. Default quality is "medium" — gpt-image-2 at
    "high" can be over-creative and invent architectural elements that don't
    exist in the source. For fidelity-critical architectural edits, "medium"
    preserves the source much better. Use "high" only when the user has
    explicitly opted into Ultra tier."""
    """
    Image-to-image edit. Returns N PNG byte payloads.

    The source image is required. If a mask is provided, edits are
    restricted to the white area of the mask. If a reference image is
    provided, it is sent as a second input image — the prompt should
    instruct the model on how to use IMAGE 1 vs IMAGE 2.
    """
    client = get_client()
    model = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2")

    image_bytes = _b64_to_bytes(image_b64)
    if not image_bytes:
        raise ValueError("openai_edit requires a source image")

    mask_bytes = _b64_to_bytes(mask_b64)
    ref_bytes  = _b64_to_bytes(reference_b64)

    # gpt-image-2 image edit endpoint accepts either a single image or a
    # list of images. A second image is treated as additional reference.
    images_arg: object
    if ref_bytes:
        images_arg = [
            ("source.png", image_bytes, "image/png"),
            ("reference.png", ref_bytes, "image/png"),
        ]
    else:
        images_arg = ("source.png", image_bytes, "image/png")

    kwargs = {
        "model": model,
        "prompt": prompt,
        "image": images_arg,
        "n": n,
        "size": _resolve_size(size),
        "quality": quality,
    }
    if mask_bytes:
        kwargs["mask"] = ("mask.png", mask_bytes, "image/png")

    resp = client.images.edit(**kwargs)
    out: List[bytes] = []
    for d in resp.data:
        if getattr(d, "b64_json", None):
            out.append(base64.b64decode(d.b64_json))
        elif getattr(d, "url", None):
            import urllib.request
            with urllib.request.urlopen(d.url) as r:
                out.append(r.read())
    return out


def estimate_reasoning_tokens(prompt: str) -> int:
    """
    Rough estimate of reasoning tokens used by gpt-image-2 for a given prompt.
    The reasoning loop scales with prompt complexity; empirical baseline is
    ~3-5x the prompt token count. Used by the cost estimator.
    """
    # Approximate 4 chars per token (English/Spanish mix)
    prompt_tokens = max(50, len(prompt) // 4)
    return prompt_tokens * 4
