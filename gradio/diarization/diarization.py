import os
import time
import json
import requests
import redis
from datetime import datetime
from pyannote.audio import Pipeline

# =========================
# Environment & Setup
# =========================

HUGGINGFACE_ACCESS_TOKEN = os.getenv("HUGGINGFACE_ACCESS_TOKEN", "")
if not HUGGINGFACE_ACCESS_TOKEN:
    raise EnvironmentError("Missing HUGGINGFACE_ACCESS_TOKEN.")

# Pyannote diarization pipeline
print("🔊 Loading pyannote speaker diarization pipeline...")
pipeline = Pipeline.from_pretrained(
    "pyannote/speaker-diarization-3.1", use_auth_token=HUGGINGFACE_ACCESS_TOKEN
)
print("✅ Pyannote diarization model loaded successfully.")

# Redis connection
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=0)

# Qdrant backend API
QDRANT_HOST = os.getenv("QDRANT_HOST", "http://qdrant:6333")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "file_metadata")

# Output folder for RTTM files
OUTPUT_DIR = "outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Dagster integration (optional)
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
# Helper Functions
# =========================

def hash_string_to_uint64(s):
    """Convert string to uint64 for Qdrant ID"""
    hash_val = 5381
    for c in s:
        hash_val = ((hash_val << 5) + hash_val) + ord(c)
    return hash_val & 0xFFFFFFFFFFFFFFFF

# =========================
# Diarization Function
# =========================

def diarize_file(file_path):
    """Run diarization and return segments + RTTM path."""
    diarization = pipeline(file_path)

    base_name = os.path.splitext(os.path.basename(file_path))[0]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    rttm_path = os.path.join(OUTPUT_DIR, f"{base_name}_{timestamp}.rttm")

    with open(rttm_path, "w") as f:
        diarization.write_rttm(f)

    # Collect all segments
    raw_segments = []
    for segment, _, speaker in diarization.itertracks(yield_label=True):
        duration = segment.end - segment.start
        # Skip very short segments (less than 1 second)
        if duration < 1.0:
            print(f"⏩ Skipping short segment: {speaker} ({duration:.2f}s)")
            continue
        
        raw_segments.append({
            "speaker": speaker,
            "start": round(segment.start, 2),
            "end": round(segment.end, 2)
        })
    
    # Merge nearby segments from the same speaker
    merged_segments = []
    if not raw_segments:
        return merged_segments, rttm_path
    
    current_segment = raw_segments[0].copy()
    
    for next_segment in raw_segments[1:]:
        # If same speaker and gap < 0.5 seconds, merge
        gap = next_segment["start"] - current_segment["end"]
        if (next_segment["speaker"] == current_segment["speaker"] and gap < 0.5):
            # Extend current segment
            current_segment["end"] = next_segment["end"]
            print(f"🔗 Merged segments: {current_segment['speaker']} " 
                  f"({current_segment['start']}s-{current_segment['end']}s)")
        else:
            # Save current and start new
            merged_segments.append(current_segment)
            current_segment = next_segment.copy()
    
    # Don't forget the last segment
    merged_segments.append(current_segment)
    
    print(f"📊 Segments: {len(raw_segments)} raw → {len(merged_segments)} after filtering & merging")
    
    return merged_segments, rttm_path

# =========================
# Qdrant Update Functions
# =========================

def update_parent_metadata(file_id, segment_count):
    """Update parent job status in Qdrant"""
    numeric_id = hash_string_to_uint64(file_id)
    
    print(f"🔍 Looking for parent with file_id: {file_id}")
    print(f"🔍 Computed numeric_id: {numeric_id}")
    
    # First, check if the point exists
    check_url = f"{QDRANT_HOST}/collections/{QDRANT_COLLECTION}/points/{numeric_id}"
    
    try:
        check_resp = requests.get(check_url)
        
        if check_resp.status_code == 404:
            print(f"⚠️ Parent point {numeric_id} not found - it may not have been created yet")
            return
        
        # Point exists, update it
        url = f"{QDRANT_HOST}/collections/{QDRANT_COLLECTION}/points/?wait=true"
        payload = {
            "points": [numeric_id],
            "payload": {
                "status": "diarized",
                "segment_count": segment_count,
                "diarization_completed_at": datetime.now().isoformat()
            }
        }
        
        resp = requests.post(url, json=payload)
        print(f"🔍 Update response status: {resp.status_code}")
        print(f"🔍 Update response: {resp.text}")
        
        if resp.status_code >= 300:
            print(f"⚠️ Failed to update parent metadata: {resp.text}")
        else:
            print(f"✅ Updated parent metadata for file {file_id}")
            
    except Exception as e:
        print(f"⚠️ Exception updating parent metadata: {e}")
        import traceback
        traceback.print_exc()

def create_segment_entries(file_id, segments, minio_url):
    """Create child segment entries in Qdrant"""
    
    points = []
    transcription_jobs = []
    
    for idx, segment in enumerate(segments):
        segment_id = f"{file_id}_seg_{idx:03d}"
        numeric_id = hash_string_to_uint64(segment_id)
        
        # Create 512-dimensional zero vector
        vector = [0.0] * 512
        
        # Prepare segment payload
        segment_payload = {
            "type": "segment",
            "parent_job_id": file_id,
            "segment_index": idx,
            "speaker": segment["speaker"],
            "start_time": segment["start"],
            "end_time": segment["end"],
            "minio_url": minio_url,
            "transcript_text": None,
            "embedding_generated": False,
            "status": "pending_transcription",
            "timestamp": datetime.now().isoformat()
        }
        
        points.append({
            "id": numeric_id,
            "vector": vector,
            "payload": segment_payload
        })
        
        # Add to transcription queue
        transcription_jobs.append({
            "segment_id": segment_id,
            "file_id": file_id,
            "start_time": segment["start"],
            "end_time": segment["end"],
            "speaker": segment["speaker"],
            "minio_url": minio_url
        })
    
    # Insert all segments into Qdrant
    url = f"{QDRANT_HOST}/collections/{QDRANT_COLLECTION}/points?wait=true"
    payload = {"points": points}
    
    try:
        resp = requests.put(url, json=payload)
        if resp.status_code >= 300:
            print(f"⚠️ Failed to create segment entries: {resp.text}")
            return []
        else:
            print(f"✅ Created {len(points)} segment entries in Qdrant")
            return transcription_jobs
    except Exception as e:
        print(f"⚠️ Exception creating segment entries: {e}")
        return []

def push_transcription_jobs(jobs):
    """Push segment jobs to transcription queue"""
    for job in jobs:
        try:
            job_json = json.dumps(job)
            r.lpush("transcription_queue", job_json)
            print(f"✅ Pushed segment {job['segment_id']} to transcription queue")
        except Exception as e:
            print(f"⚠️ Failed to push transcription job: {e}")

# =========================
# Worker Loop
# =========================

def worker_loop():
    print("🚀 Diarization worker started, waiting for jobs...")
    while True:
        try:
            _, job_data = r.blpop("diarization_queue")
            job = json.loads(job_data)
            file_id = job["file_id"]
            minio_url = job["minio_url"]

            print(f"🎙️ Processing file {file_id} from {minio_url}")

            # Download audio from MinIO
            local_path = os.path.join("/tmp", f"{file_id}.wav")
            resp = requests.get(minio_url)
            resp.raise_for_status()
            with open(local_path, "wb") as f:
                f.write(resp.content)

            # Run diarization
            segments, rttm_path = diarize_file(local_path)
            print(f"🗂️ Diarization complete: {len(segments)} segments")

            # Update parent metadata
            update_parent_metadata(file_id, len(segments))

            # Create child segment entries
            transcription_jobs = create_segment_entries(file_id, segments, minio_url)

            # Push segments to transcription queue
            if transcription_jobs:
                push_transcription_jobs(transcription_jobs)
                print(f"✅ Queued {len(transcription_jobs)} segments for transcription")
                log_dagster_event(
                    "file_diarized",
                    "diarized_files",
                    {
                        "file_id": file_id,
                        "segment_count": len(segments),
                        "speakers": list(set(s["speaker"] for s in segments))
                    }
                )

        except Exception as e:
            print(f"⚠️ Error in diarization worker: {e}")
            import traceback
            traceback.print_exc()
            time.sleep(5)

if __name__ == "__main__":
    worker_loop()