#!/bin/bash
# convert_videos.sh

INPUT_PATH="$1"
OUT_DIR="$2"

echo "[PROCESSING] Analyzing: $OUT_DIR..."
mkdir -p "$OUT_DIR"

cd "$OUT_DIR" || exit

PROBE_OPTS="-v error -analyzeduration 10000000 -probesize 10000000"
BASE_NAME=$(basename "$INPUT_PATH" | sed 's/\(.*\)\..*/\1/')

TARGET_AUDIO_LANG="jpn"
TARGET_SUB_LANG="eng"
CHUNK_SIZE="6"

# === 0. SANITY CHECK ===
if [ ! -f "$INPUT_PATH" ]; then
    echo "[FATAL] Input file missing or already deleted: $INPUT_PATH"
    exit 1
fi

echo "[PROCESSING] Creating HLS stream for $BASE_NAME..."

# ==========================================
# --- 1. VIDEO & AUDIO CHECK ---
# ==========================================
if [ ! -f "master.m3u8" ]; then
    echo "  -> Video missing. Encoding Video/Audio streams..."

    # Probe Audio
    AUDIO_INDEX=$(ffprobe -v error -select_streams a:m:language:$TARGET_AUDIO_LANG -show_entries stream=index -of csv=p=0 "$INPUT_PATH" | head -n 1 | tr -d '[:space:]')
    if [ -n "$AUDIO_INDEX" ]; then
        AUDIO_MAP="0:$AUDIO_INDEX"
        echo "    -> Target audio ($TARGET_AUDIO_LANG) found at stream index $AUDIO_INDEX"
    else
        AUDIO_MAP="0:a:0"
        echo "    -> Target audio ($TARGET_AUDIO_LANG) missing. Falling back to default track."
    fi

    # Probe and Encode Video
    ffmpeg -fflags +genpts -i "$INPUT_PATH" \
    -filter_complex "[0:v:0]split=3[v1][v2][v3]; [v1]scale=1920:-2,format=yuv420p[v1out]; [v2]scale=1280:-2,format=yuv420p[v2out]; [v3]scale=854:-2,format=yuv420p[v3out]" \
    -map "[v1out]" -map "$AUDIO_MAP" \
    -map "[v2out]" -map "$AUDIO_MAP" \
    -map "[v3out]" -map "$AUDIO_MAP" \
    -c:v libx264 -preset fast -crf 23 -b:v 0 \
    -g 144 -no-scenecut 1 \
    -maxrate:v:0 8000k -bufsize:v:0 16000k \
    -maxrate:v:1 5000k -bufsize:v:1 10000k \
    -maxrate:v:2 2500k -bufsize:v:2 5000k \
    -c:a aac -b:a 192k -ac 2 \
    -fps_mode cfr -max_muxing_queue_size 1024 \
    -f hls -hls_time "$CHUNK_SIZE" -hls_playlist_type vod -hls_segment_type fmp4 \
    -avoid_negative_ts make_non_negative \
    -var_stream_map "v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p" \
    -hls_segment_filename "%v_chunk_%03d.m4s" \
    -hls_fmp4_init_filename "%v_init.mp4" \
    -master_pl_name "master.m3u8" \
    "%v_playlist.m3u8"
else
    echo "  -> [SKIPPED] Video streams already converted."
fi

# ==========================================
# --- 2. SUBTITLES CHECK ---
# ==========================================
VTT_OUT="subtitles.vtt"
ASS_OUT="subtitles.ass"

if [ ! -f "$VTT_OUT" ] && [ ! -f "$ASS_OUT" ]; then
    SUB_INFO=$(ffprobe $PROBE_OPTS -select_streams s:m:language:$TARGET_SUB_LANG -show_entries stream=index,codec_name -of csv=p=0 "$INPUT_PATH" | head -n 1 | tr -d '[:space:]')

    if [ -n "$SUB_INFO" ]; then
        SUB_INDEX=$(echo "$SUB_INFO" | cut -d',' -f1)
        SUB_CODEC=$(echo "$SUB_INFO" | cut -d',' -f2)

        echo "  -> $TARGET_SUB_LANG Subtitles detected (Codec: $SUB_CODEC). Processing..."

        if [[ "$SUB_CODEC" =~ ^(ass|ssa)$ ]]; then
            echo "    -> Complex formatting detected. Extracting raw ASS..."
            ffmpeg -v warning -i "$INPUT_PATH" -map 0:$SUB_INDEX -c:s copy "$ASS_OUT" -y

        elif [[ "$SUB_CODEC" =~ ^(hdmv_pgs_subtitle|dvd_subtitle|dvb_subtitle|dvb_teletext|xsub|arib_caption)$ ]]; then
            echo "    -> [WARNING] Image-based subtitles detected. These must be hardsubbed. Skipping extraction."

        else
            echo "    -> Standard text format detected. Converting to WebVTT..."
            ffmpeg -v warning -i "$INPUT_PATH" -map 0:$SUB_INDEX -c:s webvtt "$VTT_OUT" -y

            if [ -f "$VTT_OUT" ]; then
                echo "    -> Scrubbing formatting artifacts..."
                sed -i 's/{[^}]*}//g' "$VTT_OUT"
                sed -i '/^m [-0-9\.]/d' "$VTT_OUT"
            else
                echo "    -> [ERROR] FFmpeg could not convert codec '$SUB_CODEC' to WebVTT."
            fi
        fi
    else
        echo "  -> No subtitles found in $TARGET_SUB_LANG. Skipping extraction."
    fi
else
    echo "  -> [SKIPPED] Subtitles already extracted."
fi

# ==========================================
# --- 2.5 EXTRACT FONTS (MKV ATTACHMENTS) ---
# ==========================================
FONT_DIR="fonts"

# Check if the input file has attachment streams (fonts are usually .ttf or .otf)
HAS_FONTS=$(ffprobe -loglevel error -select_streams t -show_entries stream=codec_type -of csv=p=0 "$INPUT_PATH" | head -n 1)

if [ -n "$HAS_FONTS" ]; then
    echo "  -> Custom fonts detected. Extracting..."
    mkdir -p "$FONT_DIR"
    
    cd "$FONT_DIR" || exit
    
    if [[ "$INPUT_PATH" = /* ]]; then
        ABS_INPUT="$INPUT_PATH"
    else
        ABS_INPUT="../$INPUT_PATH"
    fi
    
    ffmpeg -loglevel warning -dump_attachment:t "" -i "$ABS_INPUT" -y 2>/dev/null
    cd ..
    
    if [ -z "$(ls -A "$FONT_DIR" 2>/dev/null)" ]; then
        rm -rf "$FONT_DIR"
    else
        echo "    -> Fonts successfully dumped into /$FONT_DIR"
    fi
else
    echo "  -> [SKIPPED] No attached fonts found in MKV."
fi

# ==========================================
# --- 3. THUMBNAILS CHECK ---
# ==========================================
VTT_FILE="thumbnails.vtt"
if [ ! -f "$VTT_FILE" ]; then
    echo "  -> Thumbnails missing. Generating Sprite Sheets..."
    ffmpeg -loglevel warning -i "$INPUT_PATH" -vf "fps=1/10,scale=160:90,tile=10x10" "sprite_%03d.jpg" -y

    echo "    -> Generating thumbnails.vtt coordinate file..."
    DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT_PATH")
    DURATION=${DURATION%.*}

    echo "WEBVTT" > "$VTT_FILE"
    echo "" >> "$VTT_FILE"

    THUMB_COUNT=$(( DURATION / 10 ))

    for (( i=0; i<=THUMB_COUNT; i++ )); do
        START_TIME=$(( i * 10 ))
        END_TIME=$(( (i + 1) * 10 ))

        START_STR=$(printf "%02d:%02d:%02d.000" $((START_TIME/3600)) $((START_TIME%3600/60)) $((START_TIME%60)))
        END_STR=$(printf "%02d:%02d:%02d.000" $((END_TIME/3600)) $((END_TIME%3600/60)) $((END_TIME%60)))

        IMG_INDEX=$(( i / 100 + 1 ))
        IMG_NAME=$(printf "sprite_%03d.jpg" $IMG_INDEX)

        SUB_INDEX=$(( i % 100 ))
        COL=$(( SUB_INDEX % 10 ))
        ROW=$(( SUB_INDEX / 10 ))

        X=$(( COL * 160 ))
        Y=$(( ROW * 90 ))

        echo "$START_STR --> $END_STR" >> "$VTT_FILE"
        echo "$IMG_NAME#xywh=$X,$Y,160,90" >> "$VTT_FILE"
        echo "" >> "$VTT_FILE"
    done
else
    echo "  -> [SKIPPED] Thumbnails already generated."
fi

# === CLEANUP ===
ROOM_DIR=$(dirname "$OUT_DIR")
chmod -R 777 "$ROOM_DIR"

echo "[SUCCESS] Finished $BASE_NAME"

rm -f "$INPUT_PATH"