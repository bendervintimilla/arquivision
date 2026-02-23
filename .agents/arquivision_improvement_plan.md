# ArquiVision AI — Deep Improvement Plan
## Focus: Code Logic, Image Generation Context & Intelligence

---

## 🔴 CRITICAL ISSUES (Fix Now)

### 1. Conversation Context is NOT Injected into Image Generation
**File:** `services/geminiService.ts` → `generateArchitecturalVariations()`
**Problem:** The `AIContext` (conversation summary + user memory) is passed but only used to build the `systemInstruction`. The actual conversation history (what styles the user prefers, previous edits, what they liked/disliked) is NOT woven into the image prompt itself.
**Impact:** Every image generation is essentially stateless — Gemini doesn't know what the user has been working on.

### 2. Scene Analysis Runs on EVERY Edit (Slow Pipeline)
**File:** `services/geminiService.ts` → `analyzeScene()`
**Problem:** The cache uses `imageHash()` which samples characters from the base64 string. When the user uploads a new image that's similar in size, the hash could falsely match. Worse, for edits to the same image, the scene analysis runs every time because the generated output has a different hash than the input.
**Impact:** 3-call pipeline for every single edit: classify → analyze → generate. Should be 2 calls max.

### 3. No Iterative Context Between Generations
**File:** `pages/PhotoEnhancer.tsx`
**Problem:** When a user generates image A, then says "now make the walls darker", the system re-analyzes the NEW image (A) instead of understanding that it should modify the ORIGINAL scene context with cumulative edits.
**Impact:** Context drift — each edit loses track of original architectural constraints.

### 4. useFastModel Never Used from Frontend
**File:** `backend/main.py` (line 261) + `services/backendApiService.ts`
**Problem:** The backend supports `useFastModel` parameter but the frontend NEVER sends it. The fast model (gemini-2.5-flash-image) is faster for iterative drafts but never gets used.
**Impact:** All generations use the heavy Pro model even for quick iterations.

---

## 🟡 IMPORTANT IMPROVEMENTS

### 5. Add "Speed Mode" Toggle for Iterative Work
- Add a UI toggle: "Draft Mode" (fast, lower quality) vs "Final Render" (slow, maximum quality)
- Draft: Uses `gemini-2.5-flash-image` — good for rapid iteration
- Final: Uses `gemini-3-pro-image-preview` — for client-ready renders
- Architects iterate 10-20x before final. Speed matters.

### 6. Build a Proper Prompt Chain with Cumulative Context
Currently the prompt is rebuilt from scratch each time. Instead:
```
Generation 1: "Modern minimalist living room" → Result A
Generation 2: "Make the walls warmer" → Should include: "This is iteration 2 of a design. Previous: modern minimalist living room. Now modify: make walls warmer. Keep everything else."
Generation 3: "Add a fireplace" → Should include full history chain
```

### 7. Reference Image Logic is Weak
**File:** `services/autocadService.ts` → `buildEditPrompt()`
**Problem:** When a reference image is provided, the prompt just says "A second image is provided as visual reference." This is too vague for Gemini.
**Fix:** Should specify: "IMAGE 1 is the current design to edit. IMAGE 2 is the style/material reference. Extract materials, colors, textures, and furniture styles from IMAGE 2 and apply them to IMAGE 1 as the user instructs."

### 8. Mask Editing Has No Smart Prompt
**File:** `pages/PhotoEnhancer.tsx` + `services/geminiService.ts`
**Problem:** When a user paints a mask area, the system sends both the image and mask but the prompt doesn't say "Focus edits ONLY within the masked white region." Gemini may not understand the mask's purpose.
**Fix:** When mask is provided, prepend: "A mask image is included. WHITE areas in the mask indicate WHERE to make changes. BLACK areas must remain UNTOUCHED."

### 9. Plan Studio: Vector Operations Are Fragile
**File:** `pages/PlanToRender.tsx` + `services/cadService.ts`
**Problem:** The vector modification relies on Gemini returning perfect JSON operations. If Gemini hallucinates coordinates, the entire plan breaks silently.
**Fix:** Add validation + bounds checking on operations before applying.

### 10. Video Studio: No Context from Parent Render
**File:** `pages/VideoStudio.tsx`
**Problem:** When generating a video, only the image and a motion prompt are sent. There's no context about WHAT the image represents (architectural style, room type, lighting mood).
**Fix:** Store the original prompt/scene analysis with each gallery asset and inject it into the video generation prompt.

---

## 🟢 ENHANCEMENT OPPORTUNITIES

### 11. Add "Undo Last Edit" (Non-Destructive History)
Currently: Users can click previous images in the history to "go back", but then generating from that point creates a fork with no way to recover the other branch.
Better: Implement a proper undo stack that preserves the conversation linearly.

### 12. Gallery Assets Should Store Their Scene Analysis
**File:** `types.ts` → `RenderAsset`
Add `sceneAnalysis?: SceneAnalysis` and `originalPrompt?: string` to every gallery asset.
This way, when an image is used in Video Studio or re-edited later, the system has full context.

### 13. Smart Preset Suggestions Based on Scene Analysis
After scene analysis, suggest relevant presets. If the scene is "modern minimalist", don't suggest "Modern Minimalist" preset — suggest contrasting styles.

### 14. Multi-Image Comparison Generation
For architects, generating 2-3 variations simultaneously is essential.
Currently only 1 image is generated per request.
Add batch generation (2-3 images per call) using the Pro model's capability.

### 15. Export Capabilities
- Export all iterations as a PDF presentation
- Export before/after comparisons
- Export with annotations

---

## IMPLEMENTATION PRIORITY ORDER

| # | Task | Impact | Effort | Priority |
|---|------|--------|--------|----------|
| 1 | Inject conversation context into prompts | 🔴 Critical | Medium | P0 |
| 6 | Cumulative prompt chain | 🔴 Critical | Medium | P0 |
| 8 | Smart mask prompts | 🟡 High | Low | P0 |
| 5 | Speed mode toggle (draft/final) | 🟡 High | Low | P1 |
| 7 | Better reference image prompts | 🟡 High | Low | P1 |
| 10 | Video context from parent render | 🟡 Medium | Low | P1 |
| 12 | Gallery assets with scene analysis | 🟡 Medium | Medium | P1 |
| 2 | Fix scene analysis caching | 🟡 Medium | Low | P2 |
| 4 | Use fast model from frontend | 🟡 Medium | Low | P2 |
| 9 | Vector operation validation | 🟡 Medium | Medium | P2 |
| 14 | Multi-image generation | 🟢 Nice | Medium | P3 |
| 11 | Proper undo stack | 🟢 Nice | High | P3 |
