from dagster import (
    asset, Definitions, AssetExecutionContext,
    sensor, RunRequest, DefaultSensorStatus
)
import redis
import json

# Connect to your existing Redis
r = redis.Redis(host='redis', port=6379, db=0)

# Define assets that represent your pipeline stages
@asset
def uploaded_files():
    """Track files uploaded to system"""
    # Query Qdrant for files with status='uploaded'
    pass

@asset(deps=[uploaded_files])
def converted_files():
    """Track files that have been converted"""
    # Query Qdrant for files with status='converted'
    pass

@asset(deps=[converted_files])
def diarized_files():
    """Track files that have been diarized"""
    # Query Qdrant for files with status='diarized'
    pass

@asset(deps=[diarized_files])
def transcribed_segments():
    """Track segments that have been transcribed"""
    # Query Qdrant for segments with status='transcribed'
    pass

# Sensor to monitor Redis queues
@sensor(
    job_name="pipeline_monitor",
    default_status=DefaultSensorStatus.RUNNING
)
def redis_queue_sensor(context):
    """Monitor Redis queue depths"""
    conversion_queue_size = r.llen("conversion_queue")
    diarization_queue_size = r.llen("diarization_queue")
    transcription_queue_size = r.llen("transcription_queue")
    
    context.log.info(f"Queue sizes - Conversion: {conversion_queue_size}, "
                    f"Diarization: {diarization_queue_size}, "
                    f"Transcription: {transcription_queue_size}")
    
    # Alert if queues are too large
    if transcription_queue_size > 100:
        context.log.warning(f"Transcription queue is backed up: {transcription_queue_size}")

defs = Definitions(
    assets=[uploaded_files, converted_files, diarized_files, transcribed_segments],
    sensors=[redis_queue_sensor]
)