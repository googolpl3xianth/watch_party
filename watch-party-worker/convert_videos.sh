#!/bin/bash
# convert_videos.sh

INPUT_PATH="$1"
OUT_DIR="$2"

echo "[PROCESSING] Creating HLS stream: $OUT_DIR..."
mkdir -p "$OUT_DIR"

cd "$OUT_DIR" || exit

PROBE_OPTS="-v error -analyzeduration 10000000 -probesize 10000000"
BASE_NAME=$(basename "$INPUT_PATH" | sed 's/\(.*\)\..*/\1/')

TARGET_AUDIO_LANG="jpn"
TARGET_SUB_LANG="eng"
CHUNK_SIZE="2"

echo "[PROCESSING] Creating HLS stream for $BASE_NAME..."

# --- 1. SNIPER TARGETING: SUBTITLES ---
SUB_INDEX=$(ffprobe $PROBE_OPTS -select_streams s:m:language:$TARGET_SUB_LANG -show_entries stream=index -of csv=p=0 "$INPUT_PATH" | head -n 1 | tr -d '[:space:]')

if [ -n "$SUB_INDEX" ]; then
    echo "  -> $TARGET_SUB_LANG Subtitles detected at index $SUB_INDEX. Extracting..."
    ffmpeg -v warning -i "$INPUT_PATH" -map 0:$SUB_INDEX -c:s webvtt "$OUT_DIR/subtitles.vtt" -y
else
    echo "  -> No subtitles found in $TARGET_SUB_LANG. Skipping extraction."
fi

# --- 2. SNIPER TARGETING: AUDIO ---
AUDIO_INDEX=$(ffprobe -v error -select_streams a:m:language:$TARGET_AUDIO_LANG -show_entries stream=index -of csv=p=0 "$INPUT_PATH" | head -n 1 | tr -d '[:space:]')

if [ -n "$AUDIO_INDEX" ]; then
    AUDIO_MAP="0:$AUDIO_INDEX"
    echo "  -> Target audio ($TARGET_AUDIO_LANG) found at stream index $AUDIO_INDEX"
else
    AUDIO_MAP="0:a:0"
    echo "  -> Target audio ($TARGET_AUDIO_LANG) missing. Falling back to default track."
fi

# --- 3. VIDEO CODEC PROBE ---
VIDEO_CODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$INPUT_PATH" | tr -d '[:space:]')

if [ "$VIDEO_CODEC" = "h264" ]; then
    echo "  -> H.264 Video detected! Initiating 10-second REMUX..."
    ffmpeg -loglevel warning -i "$INPUT_PATH" \
    -c:v copy \
    -map 0:v:0 -map "$AUDIO_MAP" -c:a aac -b:a 192k -ac 2 \
    -f hls -hls_time "$CHUNK_SIZE" -hls_playlist_type vod -hls_segment_type fmp4 \
    -avoid_negative_ts make_non_negative \
    -hls_segment_filename "chunk_%03d.m4s" \
    -hls_fmp4_init_filename "init.mp4" \
    "master.m3u8"
else
    echo "  -> Heavy Codec ($VIDEO_CODEC) detected. Initiating Fast GPU TRANSCODE..."
    # Includes all the Anime VFR timestamp fixes (-fflags +genpts, -fps_mode cfr, -avoid_negative_ts)
    ffmpeg -loglevel warning -fflags +genpts -i "$INPUT_PATH" \
    -c:v h264_nvenc -b:v 6000k -maxrate:v 8000k -bufsize:v 16000k -g 48 -no-scenecut 1 \
    -map 0:v:0 -map "$AUDIO_MAP" -c:a aac -b:a 192k -ac 2 \
    -fps_mode cfr -max_muxing_queue_size 1024 \
    -f hls -hls_time "$CHUNK_SIZE" -hls_playlist_type vod -hls_segment_type fmp4 \
    -avoid_negative_ts make_non_negative \
    -hls_segment_filename "$chunk_%03d.m4s" \
    -hls_fmp4_init_filename "init.mp4" \
    "master.m3u8"
fi

ROOM_DIR=$(dirname "$OUT_DIR")
chmod -R 777 "$ROOM_DIR"

echo "[SUCCESS] Finished $BASE_NAME"
rm -f "$INPUT_PATH"*