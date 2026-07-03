import os
import json
import google.generativeai as genai
from flask import Flask, request, jsonify

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if not GEMINI_API_KEY:
    print("Warning: GEMINI_API_KEY not set")

genai.configure(api_key=GEMINI_API_KEY)

PROMPT_TEMPLATE = """You are a transcript analysis assistant. Given a transcript with speaker labels, perform the following tasks:

1. Translate the Dhivehi text to English
2. Extract keywords as a JSON list of strings (important topics/terms, empty list if none found)
3. Extract named entities grouped by type (persons, locations, organizations, events)
4. Write a summary of 3-5 sentences in English
5. Classify the conversation context as one of: threat, alibi, general_discussion, emergency, other

If the transcript is very short or unclear, still return valid JSON with best-effort values.
Respond ONLY with a valid JSON object and nothing else. No markdown, no explanation, no code fences.
Use exactly these keys:
- "english_translation": string
- "keywords": list of strings
- "entities": object with keys "persons", "locations", "organizations", "events" (each a list of strings)
- "summary": string
- "classification": string (one of: threat, alibi, general_discussion, emergency, other)

Transcript:
{transcript}"""

app = Flask(__name__)


def call_gemini(transcript_text: str) -> dict:
    if not GEMINI_API_KEY:
        return {
            "english_translation": "",
            "keywords": [],
            "entities": {"persons": [], "locations": [], "organizations": [], "events": []},
            "summary": "Analysis unavailable: GEMINI_API_KEY not configured.",
            "classification": "other",
        }

    model = genai.GenerativeModel("gemini-2.5-flash")
    prompt = PROMPT_TEMPLATE.format(transcript=transcript_text)
    response = model.generate_content(prompt)
    text = response.text.strip()

    # Strip markdown fences if Gemini ignores the instruction
    if text.startswith("```json"):
        text = text[len("```json"):]
    if text.startswith("```"):
        text = text[len("```"):]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    return json.loads(text)


@app.route("/run/predict", methods=["POST"])
def predict():
    try:
        body = request.get_json(force=True)
        # Gradio-compatible envelope: {"data": ["transcript text"]}
        data = body.get("data", [])
        if not data or not isinstance(data, list) or not data[0]:
            return jsonify({"error": "missing transcript text in data[0]"}), 400

        transcript_text = data[0]
        result = call_gemini(transcript_text)
        # Return Gradio-compatible envelope so the Go handler needs no changes
        return jsonify({"data": [json.dumps(result, ensure_ascii=False)]})

    except json.JSONDecodeError as e:
        return jsonify({"error": f"Gemini returned non-JSON response: {e}"}), 502
    except Exception as e:
        print(f"Analysis error: {e}")
        fallback = {
            "english_translation": "",
            "keywords": [],
            "entities": {"persons": [], "locations": [], "organizations": [], "events": []},
            "summary": f"Analysis failed: {str(e)}",
            "classification": "other",
        }
        return jsonify({"data": [json.dumps(fallback, ensure_ascii=False)]})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    print("Starting Flask analysis service on port 7861")
    app.run(host="0.0.0.0", port=7861, debug=False)