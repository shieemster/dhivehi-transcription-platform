import os
import time
import json
import base64
import requests
import redis
import torch
import threading
import urllib3
import google.generativeai as genai
from datetime import datetime
from transformers import WhisperProcessor, WhisperForConditionalGeneration
import librosa
import tempfile
import noisereduce as nr
from minio import Minio
from minio.credentials import StaticProvider
from minio.sse import SseCustomerKey
# =========================
# Environment & Setup
# =========================

# Redis connection
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
r = redis.Redis(
    host=REDIS_HOST, port=REDIS_PORT, db=0,
    socket_keepalive=True, health_check_interval=30, retry_on_timeout=True,
    socket_timeout=None,
)

# Qdrant backend API
QDRANT_HOST = os.getenv("QDRANT_HOST", "http://qdrant:6333")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "file_metadata")

# MinIO credentials for downloading segments — TLS-only (required for
# SSE-C: the decryption key travels as an HTTP header and must never go
# over plain HTTP). The cert is self-signed for local dev, so rather than
# disabling verification we pin trust to this specific cert, same approach
# as the Go backend.
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "minio:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minio")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minio123")
MINIO_CERT_PATH = os.getenv("MINIO_CERT_PATH", "/app/certs/public.crt")

_minio_http_client = urllib3.PoolManager(
    cert_reqs="CERT_REQUIRED",
    ca_certs=MINIO_CERT_PATH,
)

minio_client = Minio(
    MINIO_ENDPOINT,
    credentials=StaticProvider(MINIO_ACCESS_KEY, MINIO_SECRET_KEY),
    secure=True,
    http_client=_minio_http_client,
)

# Real embeddings for semantic search — replaces the 512-dim zero-vector
# placeholder every segment used to be stored with (Qdrant was configured
# with real vector search in mind but nothing ever populated real vectors).
# EMBEDDING_DIM must match the Qdrant collection's existing vector size
# (512, fixed at collection-creation time) — Gemini's gemini-embedding-001
# supports an explicit output_dimensionality to truncate to exactly that,
# via Matryoshka representation learning, so no collection migration is
# needed. If no key is configured (or a call fails), embeddings fall back
# to a zero vector rather than breaking transcription itself.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
EMBEDDING_DIM = 512
EMBEDDING_MODEL = "models/gemini-embedding-001"

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    print("⚠️ GEMINI_API_KEY not set — segments will be stored with a zero vector; semantic search won't find anything")


def generate_embedding(text: str):
    """Returns (vector, generated). generated=False means the zero-vector
    fallback was used (no key configured, empty text, or the API call
    failed) — callers should keep embedding_generated=False in that case
    so it's visible which segments actually got a real embedding."""
    if not GEMINI_API_KEY or not text or not text.strip():
        return [0.0] * EMBEDDING_DIM, False
    try:
        result = genai.embed_content(
            model=EMBEDDING_MODEL,
            content=text,
            task_type="retrieval_document",
            output_dimensionality=EMBEDDING_DIM,
        )
        return result["embedding"], True
    except Exception as e:
        print(f"⚠️ Embedding generation failed, falling back to zero vector: {e}")
        return [0.0] * EMBEDDING_DIM, False

# SSE-C key — same 32-byte AES-256 key (base64-encoded in the env) that the
# Go backend uses.
_sse_c_key_b64 = os.getenv("SSE_C_KEY", "")
if not _sse_c_key_b64:
    raise EnvironmentError("Missing SSE_C_KEY.")
_sse_c_key_bytes = base64.b64decode(_sse_c_key_b64)
if len(_sse_c_key_bytes) != 32:
    raise EnvironmentError(f"SSE_C_KEY must decode to exactly 32 bytes (AES-256), got {len(_sse_c_key_bytes)}")
sse_c = SseCustomerKey(_sse_c_key_bytes)

def download_from_minio_url(minio_url: str) -> bytes:
    """Fetch an object's bytes via the authenticated MinIO client instead
    of a plain HTTP GET, which now correctly returns 403 on private buckets."""
    path = minio_url.split(f"{MINIO_ENDPOINT}/", 1)[-1]
    bucket, object_name = path.split("/", 1)
    response = minio_client.get_object(bucket, object_name, ssec=sse_c)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()

#Dagster integration
DAGSTER_ENABLED = os.getenv("DAGSTER_ENABLED", "false").lower() == "true"
DAGSTER_API_URL = os.getenv("DAGSTER_API_URL", "http://dagster:3000")

def log_dagster_event(event_type, asset_key, metadata):
    """Send event to Dagster for tracking"""
    if not DAGSTER_ENABLED:
        return
    
    try:
        import requests
        payload = {
            "event_type": event_type,
            "asset_key": asset_key,
            "metadata": metadata,
            "timestamp": datetime.now().isoformat()
        }
        requests.post(f"{DAGSTER_API_URL}/events", json=payload, timeout=2)
    except Exception as e:
        print(f"⚠️ Failed to log Dagster event: {e}")


# =========================
# Load Whisper Model
# =========================

print("🔊 Loading Whisper model...")
# Load from local checkpoint
#model_path = "/app/models/checkpoint-3000"
model_path = "Devion333/whisper-small-dv-syn"

try:
    # Try loading with auto classes first (more flexible)
    from transformers import AutoProcessor, AutoModelForSpeechSeq2Seq
    processor = AutoProcessor.from_pretrained(model_path, use_fast=False)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(model_path)
except Exception as e:
    print(f"⚠️ Auto loading failed: {e}")
    print("Trying WhisperProcessor...")
    # Fallback to WhisperProcessor
    processor = WhisperProcessor.from_pretrained(model_path, use_fast=False)
    model = WhisperForConditionalGeneration.from_pretrained(model_path)

model.eval()

# Use GPU if available
device = "cuda" if torch.cuda.is_available() else "cpu"
model = model.to(device)
print(f"✅ Whisper model loaded from {model_path} on {device}")

# =========================
# Helper Functions
# =========================

def hash_string_to_uint64(s):
    """Convert string to uint64 for Qdrant ID"""
    hash_val = 5381
    for c in s:
        hash_val = ((hash_val << 5) + hash_val) + ord(c)
    return hash_val & 0xFFFFFFFFFFFFFFFF

def download_audio_segment(minio_url, start_time, end_time):
    """Download audio from MinIO and extract segment"""
    try:
        # Download full audio file
        audio_bytes = download_from_minio_url(minio_url)

        # Save to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp_file:
            tmp_file.write(audio_bytes)
            tmp_path = tmp_file.name
        
        # Load audio and extract segment
        audio, sr = librosa.load(tmp_path, sr=16000)
        audio = nr.reduce_noise(y=audio, sr=sr)
        # Extract segment based on timestamps
        start_sample = int(start_time * sr)
        end_sample = int(end_time * sr)
        segment_audio = audio[start_sample:end_sample]
        
        # Clean up temp file
        os.unlink(tmp_path)
        
        return segment_audio, sr
        
    except Exception as e:
        print(f"⚠️ Error downloading audio segment: {e}")
        return None, None

def transcribe_audio(audio, sr=16000):
    """Transcribe audio using Whisper model"""
    try:
        print(f"🔍 Transcribing audio segment (length: {len(audio)/sr:.2f}s)")
        
        # Convert to input features
        input_features = processor(audio, sampling_rate=sr, return_tensors="pt").input_features
        input_features = input_features.to(device)
        
        # Force Dhivehi decoding - only get the IDs, don't pass task
        forced_decoder_ids = processor.get_decoder_prompt_ids(language="si")
        
        print(f"🔍 Generating transcription...")
        # Generate transcription
        with torch.no_grad():
            predicted_ids = model.generate(
                input_features,
                forced_decoder_ids=forced_decoder_ids,
                do_sample=False,
                temperature=0.0,
                num_beams=1,
                max_new_tokens=444,
            )
        
        transcription = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]
        return transcription
        
    except Exception as e:
        print(f"⚠️ Error transcribing audio: {e}")
        import traceback
        traceback.print_exc()
        return None

def update_segment_in_qdrant(segment_id, transcription):
    """Update segment with transcription in Qdrant"""
    numeric_id = hash_string_to_uint64(segment_id)
    
    print(f"🔍 Updating segment {segment_id} (numeric_id: {numeric_id})")
    
    # First, get the existing point to preserve all fields
    check_url = f"{QDRANT_HOST}/collections/{QDRANT_COLLECTION}/points/{numeric_id}"
    
    try:
        check_resp = requests.get(check_url)
        print(f"🔍 Point exists check: {check_resp.status_code}")
        
        if check_resp.status_code == 404:
            print(f"⚠️ Segment point {numeric_id} not found in Qdrant")
            return
        
        # Get existing point data
        point_data = check_resp.json()
        existing_payload = point_data.get("result", {}).get("payload", {})
        existing_vector = point_data.get("result", {}).get("vector", [0.0] * 512)

        print(f"🔍 Existing payload keys: {list(existing_payload.keys())}")

        # Now that we have real transcript text, compute a real embedding —
        # the zero vector set at diarization time was only ever a
        # placeholder (there was no text yet to embed at that point).
        embedding, embedding_generated = generate_embedding(transcription)
        vector = embedding if embedding_generated else existing_vector

        # Merge with new transcription data
        updated_payload = {**existing_payload}
        updated_payload["transcript_text"] = transcription
        updated_payload["status"] = "transcribed"
        updated_payload["transcription_completed_at"] = datetime.now().isoformat()
        updated_payload["embedding_generated"] = embedding_generated

        # Use upsert endpoint to update the entire point
        url = f"{QDRANT_HOST}/collections/{QDRANT_COLLECTION}/points?wait=true"
        payload = {
            "points": [{
                "id": numeric_id,
                "vector": vector,
                "payload": updated_payload
            }]
        }
        
        resp = requests.put(url, json=payload)
        print(f"🔍 Update response status: {resp.status_code}")
        print(f"🔍 Update response: {resp.text}")
        
        if resp.status_code >= 300:
            print(f"⚠️ Failed to update segment in Qdrant: {resp.text}")
        else:
            print(f"✅ Updated segment {segment_id} in Qdrant")
            
    except Exception as e:
        print(f"⚠️ Exception updating segment in Qdrant: {e}")
        import traceback
        traceback.print_exc()

def update_parent_status(file_id):
    """Update parent job status after all segments are transcribed"""
    numeric_id = hash_string_to_uint64(file_id)
    
    print(f"🔍 Updating parent status for {file_id} (numeric_id: {numeric_id})")
    
    # First, get the existing point
    check_url = f"{QDRANT_HOST}/collections/{QDRANT_COLLECTION}/points/{numeric_id}"
    
    try:
        check_resp = requests.get(check_url)
        print(f"🔍 Parent point exists check: {check_resp.status_code}")
        
        if check_resp.status_code == 404:
            print(f"⚠️ Parent point {numeric_id} not found")
            return
        
        # Get existing point data
        point_data = check_resp.json()
        existing_payload = point_data.get("result", {}).get("payload", {})
        existing_vector = point_data.get("result", {}).get("vector", [0.0] * 512)
        
        # Merge with new status
        updated_payload = {**existing_payload}
        updated_payload["status"] = "transcribed"
        updated_payload["transcription_completed_at"] = datetime.now().isoformat()
        
        # Use upsert endpoint
        url = f"{QDRANT_HOST}/collections/{QDRANT_COLLECTION}/points?wait=true"
        payload = {
            "points": [{
                "id": numeric_id,
                "vector": existing_vector,
                "payload": updated_payload
            }]
        }
        
        resp = requests.put(url, json=payload)
        print(f"🔍 Parent update response: {resp.status_code}")
        
        if resp.status_code >= 300:
            print(f"⚠️ Failed to update parent status: {resp.text}")
        else:
            print(f"✅ Updated parent {file_id} status to transcribed")
            
    except Exception as e:
        print(f"⚠️ Exception updating parent status: {e}")
        import traceback
        traceback.print_exc()

def check_all_segments_transcribed(file_id):
    """Check if all segments for a parent job are transcribed"""
    # Query Qdrant for all segments of this parent
    url = f"{QDRANT_HOST}/collections/{QDRANT_COLLECTION}/points/scroll"
    payload = {
        "limit": 100,
        "with_payload": True,
        "filter": {
            "must": [
                {
                    "key": "parent_job_id",
                    "match": {"value": file_id}
                }
            ]
        }
    }
    
    try:
        resp = requests.post(url, json=payload)
        if resp.status_code >= 300:
            return False
        
        data = resp.json()
        segments = data.get("result", {}).get("points", [])
        
        # Check if all segments have status "transcribed"
        all_transcribed = all(
            seg.get("payload", {}).get("status") == "transcribed" 
            for seg in segments
        )
        
        return all_transcribed
        
    except Exception as e:
        print(f"⚠️ Error checking segment status: {e}")
        return False

# =========================
# Health heartbeat
# =========================

WORKER_NAME = "transcription"

def _heartbeat_loop():
    # Independent daemon thread — see the matching comment in convert.py.
    while True:
        try:
            r.set(f"worker_heartbeat:{WORKER_NAME}", str(int(time.time())), ex=30)
        except Exception:
            pass
        time.sleep(10)

# =========================
# Worker Loop
# =========================

def worker_loop():
    print("🚀 Transcription worker started, waiting for jobs...")
    print(f"🔍 Connected to Redis at {REDIS_HOST}:{REDIS_PORT}")
    print(f"🔍 Connected to Qdrant at {QDRANT_HOST}")
    
    while True:
        try:
            
            result = r.blpop("transcription_queue", timeout=10)

            if result is None:
                continue  # no job yet

            _, job_data = result
            job = json.loads(job_data)

            segment_id = job["segment_id"]
            file_id = job["file_id"]
            start_time = job["start_time"]
            end_time = job["end_time"]
            speaker = job["speaker"]
            minio_url = job["minio_url"]

            print(f"\n{'='*60}")
            print(f"🎙️ Processing segment {segment_id}")
            print(f"   Speaker: {speaker}")
            print(f"   Time: {start_time}s - {end_time}s")
            print(f"   URL: {minio_url}")
            print(f"{'='*60}\n")

            # Download and transcribe
            print("📥 Downloading audio segment...")
            audio, sr = download_audio_segment(minio_url, start_time, end_time)
            if audio is None:
                print(f"⚠️ Failed to download audio for segment {segment_id}")
                continue

            print(f"✅ Audio downloaded ({len(audio)/sr:.2f}s)")
            transcription = transcribe_audio(audio, sr)
            if transcription is None:
                print(f"⚠️ Failed to transcribe segment {segment_id}")
                continue

            print(f"📝 Transcription complete: {transcription}")
            log_dagster_event(
                "segment_transcribed",
                "transcribed_segments",
                {
                    "segment_id": segment_id,
                    "file_id": file_id,
                    "speaker": speaker,
                    "duration": end_time - start_time,
                    "transcription_length": len(transcription)
                }
            )

            # Update Qdrant
            print("💾 Updating Qdrant...")
            update_segment_in_qdrant(segment_id, transcription)

            # Check if all segments are done
            print(f"🔍 Checking if all segments complete for parent {file_id}...")
            if check_all_segments_transcribed(file_id):
                update_parent_status(file_id)
                print(f"✅ All segments transcribed for parent job {file_id}")
                log_dagster_event(
                    "file_fully_transcribed",
                    "completed_files",
                    {
                        "file_id": file_id,
                        "total_segments": "auto"
                    }
                )
            else:
                print(f"⏳ Still waiting for other segments of parent {file_id}")

        except Exception as e:
            print(f"⚠️ Error in transcription worker: {e}")
            import traceback
            traceback.print_exc()
            time.sleep(5)

if __name__ == "__main__":
    threading.Thread(target=_heartbeat_loop, daemon=True).start()
    worker_loop()