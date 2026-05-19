import requests
import json
import base64

pixel_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

payload = {
    "prompt": "A futuristic city skyline at night with neon lights.",
    "qualityTier": 2, 
    "image": f"data:image/png;base64,{pixel_b64}"
}
print("Sending request to local API...")
try:
    response = requests.post("http://localhost:8000/api/generate-image", json=payload)
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        print("Success! Got image.")
    else:
        print(f"Error: {response.text}")
except Exception as e:
    print(f"Req failed: {e}")
