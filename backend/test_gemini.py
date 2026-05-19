import os
import time
import base64
from dotenv import load_dotenv
from google import genai
from google.genai import types

def test_api():
    load_dotenv(override=True)
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY not found in .env")
        return
        
    print("Testing connection to Gemini API...")
    client = genai.Client(api_key=api_key)
    
    # Test 2: Gemini 3 Pro Image
    print("\n--- Test 2: gemini-3-pro-image-preview ---")
    try:
        response = client.models.generate_content(
            model="gemini-3-pro-image-preview",
            contents=["A simple red apple on a white table."],
            config=types.GenerateContentConfig(response_modalities=["IMAGE"])
        )
        print("Success! Image generated.")
    except Exception as e:
        print(f"API Error: {str(e)}")
        if "503" in str(e):
            print("The image model is still experiencing high demand (503 Service Unavailable).")

    # Test 3: Veo video generation
    print("\n--- Test 3: veo-3.1-fast-generate-preview ---")
    try:
        # Create a tiny 1x1 black pixel image in base64
        pixel_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        image_bytes = base64.b64decode(pixel_b64)
        source_image = types.Image(image_bytes=image_bytes, mime_type="image/png")
        
        operation = client.models.generate_videos(
            model="veo-3.1-fast-generate-preview",
            prompt="A panning shot of a black screen.",
            image=source_image,
            config=types.GenerateVideosConfig(number_of_videos=1, aspect_ratio="16:9")
        )
        print("Success! Video generation operation started successfully.")
        print(f"Operation ID: {operation.name}")
    except Exception as e:
        print(f"API Error: {str(e)}")
        if "503" in str(e):
            print("The video model is still experiencing high demand (503 Service Unavailable).")

if __name__ == "__main__":
    test_api()
