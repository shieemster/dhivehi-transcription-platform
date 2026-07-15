import os
import time
import json
import requests
import redis
import tempfile
import subprocess
from datetime import datetime
from minio import Minio

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

# MinIO connection
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "minio:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minio")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minio123")

from minio.credentials import StaticProvider
minio_client = Minio(
    MINIO_ENDPOINT,
    credentials=StaticProvider(MINIO_ACCESS_KEY, MINIO_SECRET_KEY),
    secure=False
)

print("✅ Connected to MinIO and Redis")

def download_from_minio_url(minio_url: str) -> bytes:
    """
    Fetch an object's bytes using the authenticated MinIO client instead of
    a plain HTTP GET. Buckets are private now (no more public-read policy —
    that was itself a security vulnerability), so a raw requests.get() on
    the stored URL will always return 403. This parses "bucket/object" out
    of the URL and downloads it the same way the backend does internally.
    """
    # minio_url looks like: http://minio:9000/<bucket>/<object_name>
    path = minio_url.split(f"{MINIO_ENDPOINT}/", 1)[-1]
    bucket, object_name = path.split("/", 1)
    response = minio_client.get_object(bucket, object_name)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()

# Dagster integration 
DAGSTER_ENABLED = os.getenv("DAGSTER_ENABLED", "false").lower() == "true"
DAGSTER_API_URL = os.getenv("DAGSTER_API_URL", "http://dagster:3000")

def log_dagster_event(event_type, asset_key, metadata):
    """Send event to Dagster for tracking"""
    if not DAGSTER_ENABLED:
        return
    
    try:
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
# Conversion Functions
# =========================

def is_video_file(filename):
    """Check if file is a video based on extension"""
    video_extensions = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v', '.mpeg', '.mpg']
    return any(filename.lower().endswith(ext) for ext in video_extensions)

def convert_video_to_audio(video_path, output_path):
    """Convert video to audio using ffmpeg"""
    try:
        print(f"🎬 Converting video to audio...")
        
        # Use ffmpeg to extract audio
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vn',  # No video
            '-acodec', 'pcm_s16le',  # PCM audio codec
            '-ar', '16000',  # 16kHz sample rate
            '-ac', '1',  # Mono
            '-y',  # Overwrite output file
            output_path
        ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        if result.returncode != 0:
            print(f"⚠️ FFmpeg error: {result.stderr}")
            return False
        
        print(f"✅ Conversion complete")
        return True
        
    except subprocess.TimeoutExpired:
        print(f"⚠️ Conversion timed out")
        return False
    except Exception as e:
        print(f"⚠️ Conversion error: {e}")
        return False

def process_file(file_id, minio_url, filename):
    """Download, convert if needed, and re-upload"""
    try:
        print(f"\n{'='*60}")
        print(f"📁 Processing: {filename}")
        print(f"   File ID: {file_id}")
        print(f"   URL: {minio_url}")
        print(f"{'='*60}\n")
        
        # Check if it's a video file
        is_video = is_video_file(filename)
        
        if not is_video:
            print(f"🎵 File is already audio, skipping conversion")
            # Push directly to diarization queue
            job = {
                "file_id": file_id,
                "minio_url": minio_url
            }
            r.lpush("diarization_queue", json.dumps(job))
            print(f"✅ Pushed to diarization queue")
            log_dagster_event(
                "conversion_skipped",
                "converted_files",
                {"file_id": file_id, "reason": "already_audio"}
            )
            return
        
        # Download video file
        print(f"📥 Downloading video file...")
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(filename)[1]) as tmp_video:
            video_path = tmp_video.name
            tmp_video.write(download_from_minio_url(minio_url))
        
        print(f"✅ Downloaded: {os.path.getsize(video_path) / (1024*1024):.2f} MB")
        
        # Convert to audio
        audio_path = video_path.replace(os.path.splitext(filename)[1], '.wav')
        
        if not convert_video_to_audio(video_path, audio_path):
            print(f"⚠️ Failed to convert video")
            os.unlink(video_path)
            return
        
        # Upload converted audio to MinIO
        print(f"📤 Uploading converted audio to MinIO...")
        bucket = "uploads"
        audio_filename = f"{file_id}_converted.wav"
        
        minio_client.fput_object(
            bucket,
            audio_filename,
            audio_path,
            content_type="audio/wav"
        )
        
        new_minio_url = f"http://{MINIO_ENDPOINT}/{bucket}/{audio_filename}"
        print(f"✅ Uploaded: {new_minio_url}")
        
        # Clean up temp files
        os.unlink(video_path)
        os.unlink(audio_path)
        
        # Push to diarization queue with new audio URL
        job = {
            "file_id": file_id,
            "minio_url": new_minio_url
        }
        r.lpush("diarization_queue", json.dumps(job))
        print(f"✅ Pushed converted audio to diarization queue")
        # Already added in artifact ✅
        log_dagster_event(
            "video_converted",
            "converted_files",
            {
                "file_id": file_id,
                "original_format": os.path.splitext(filename)[1],
                "converted_url": new_minio_url
            }
        )
        
    except Exception as e:
        print(f"⚠️ Error processing file: {e}")
        import traceback
        traceback.print_exc()

# =========================
# Worker Loop
# =========================

def worker_loop():
    print("🚀 Conversion worker started, waiting for jobs...")
    print(f"🔍 Connected to Redis at {REDIS_HOST}:{REDIS_PORT}")
    print(f"🔍 Connected to MinIO at {MINIO_ENDPOINT}")
    
    while True:
        try:
            
            result = r.blpop("conversion_queue", timeout=10)
            
            if result is None:
                continue  # no job yet
            
            _, job_data = result
            job = json.loads(job_data)
            
            file_id = job["file_id"]
            minio_url = job["minio_url"]
            filename = job.get("filename", "unknown")
            
            process_file(file_id, minio_url, filename)
            
        except Exception as e:
            print(f"⚠️ Error in conversion worker: {e}")
            import traceback
            traceback.print_exc()
            time.sleep(5)

if __name__ == "__main__":
    worker_loop()