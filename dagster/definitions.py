from dagster import Definitions, asset, sensor, RunRequest, DefaultSensorStatus, SkipReason
import requests
import os

# Environment variables
QDRANT_HOST = os.getenv("QDRANT_HOST", "http://qdrant:6333")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "file_metadata")
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))

# Connect to Redis for monitoring
try:
    import redis
    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=0)
except Exception as e:
    print(f"Warning: Could not connect to Redis: {e}")
    r = None

# =========================
# Assets (Data Products)
# =========================

@asset(description="Files uploaded to the system")
def uploaded_files():
    """Query Qdrant for uploaded files"""
    try:
        url = f"{QDRANT_HOST}/collections/{QDRANT_COLLECTION}/points/scroll"
        payload = {
            "limit": 100,
            "with_payload": True,
            "filter": {
                "must": [
                    {"key": "type", "match": {"value": "parent"}},
                    {"key": "status", "match": {"value": "uploaded"}}
                ]
            }
        }
        resp = requests.post(url, json=payload, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            files = data.get("result", {}).get("points", [])
            return {"count": len(files), "files": files}
    except Exception as e:
        print(f"Error querying uploaded files: {e}")
    return {"count": 0, "files": []}

@asset(description="Files that have been converted from video to audio")
def converted_files():
    """Track converted files"""
    # In your case, conversion happens inline, so this tracks all audio files
    return {"count": 0, "note": "Conversion is inline"}

@asset(description="Files that have been diarized (speaker separation)")
def diarized_files():
    """Query Qdrant for diarized files"""
    try:
        url = f"{QDRANT_HOST}/collections/{QDRANT_COLLECTION}/points/scroll"
        payload = {
            "limit": 100,
            "with_payload": True,
            "filter": {
                "must": [
                    {"key": "type", "match": {"value": "parent"}},
                    {"key": "status", "match": {"value": "diarized"}}
                ]
            }
        }
        resp = requests.post(url, json=payload, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            files = data.get("result", {}).get("points", [])
            return {"count": len(files), "files": files}
    except Exception as e:
        print(f"Error querying diarized files: {e}")
    return {"count": 0, "files": []}

@asset(description="Individual segments that have been transcribed")
def transcribed_segments():
    """Query Qdrant for transcribed segments"""
    try:
        url = f"{QDRANT_HOST}/collections/{QDRANT_COLLECTION}/points/scroll"
        payload = {
            "limit": 100,
            "with_payload": True,
            "filter": {
                "must": [
                    {"key": "type", "match": {"value": "segment"}},
                    {"key": "status", "match": {"value": "transcribed"}}
                ]
            }
        }
        resp = requests.post(url, json=payload, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            segments = data.get("result", {}).get("points", [])
            return {"count": len(segments), "segments": segments}
    except Exception as e:
        print(f"Error querying transcribed segments: {e}")
    return {"count": 0, "segments": []}

@asset(description="Files that are fully completed (all segments transcribed)")
def completed_files():
    """Query Qdrant for completed files"""
    try:
        url = f"{QDRANT_HOST}/collections/{QDRANT_COLLECTION}/points/scroll"
        payload = {
            "limit": 100,
            "with_payload": True,
            "filter": {
                "must": [
                    {"key": "type", "match": {"value": "parent"}},
                    {"key": "status", "match": {"value": "transcribed"}}
                ]
            }
        }
        resp = requests.post(url, json=payload, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            files = data.get("result", {}).get("points", [])
            return {"count": len(files), "files": files}
    except Exception as e:
        print(f"Error querying completed files: {e}")
    return {"count": 0, "files": []}

# ... (rest of imports and asset definitions)

# =========================
# Jobs (Bundles of runs)
# =========================
from dagster import define_asset_job

# Define a job that materializes all status assets
asset_monitoring_job = define_asset_job(
    name="qdrant_status_monitoring_job",
    selection=[
        uploaded_files,
        converted_files,
        diarized_files,
        transcribed_segments,
        completed_files
    ]
)

# =========================
# Sensors (Monitors)
# =========================

@sensor(
    name="redis_queue_monitor",
    job_name="qdrant_status_monitoring_job", # Specify the job to run
    default_status=DefaultSensorStatus.RUNNING,
    minimum_interval_seconds=5,
    description="Monitor Redis queue depths and trigger asset updates"
)
def redis_queue_sensor(context):
    """Monitor Redis queue sizes and trigger asset materialization"""
    if r is None:
        context.log.error("Redis not available. Skipping run.")
        return SkipReason("Redis not available")
    
    try:
        conversion_queue = r.llen("conversion_queue")
        diarization_queue = r.llen("diarization_queue")
        transcription_queue = r.llen("transcription_queue")
        
        context.log.info(f"Queue depths - Conversion: {conversion_queue}, Diarization: {diarization_queue}, Transcription: {transcription_queue}")
        
        # 💡 NEW LOGIC: Trigger a run if there are any pending items in any queue
        # This makes the sensor a true 'trigger' for the asset monitoring job
        if conversion_queue > 0 or diarization_queue > 0 or transcription_queue > 0:
            context.log.info("Queue activity detected. Triggering asset update run.")
            
            # The yield RunRequest is what causes the log "Checking for new runs for sensor" 
            # to be followed by a successful run submission, not a 'skipped' message.
            yield RunRequest(
                run_key=f"status_update_{context.cursor}",
                tags={"queue_activity": "true"}
            )
            
        else:
            # Alert if queues are backing up (only run when no activity is detected to reduce noise)
            if transcription_queue > 50:
                context.log.warning(f"⚠️ Transcription queue is backed up: {transcription_queue} items")
            
            yield SkipReason("No queue activity detected, skipping asset materialization.")

    except Exception as e:
        context.log.error(f"Error monitoring queues: {e}")
        yield SkipReason(f"Error monitoring queues: {e}")

# =========================
# Definitions
# =========================

defs = Definitions(
    assets=[
        uploaded_files,
        converted_files,
        diarized_files,
        transcribed_segments,
        completed_files
    ],
    jobs=[asset_monitoring_job], # Add the job definition
    sensors=[redis_queue_sensor]
)