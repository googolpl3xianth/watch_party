# Convert-Videos.ps1

param (
    [string]$SingleFile = ""
)

$activeScheme = powercfg -getactivescheme
$originalGuid = ([regex]::Match($activeScheme, '(?<=GUID: ).*?(?=\s*\()')).Value

powercfg /setactive c3ec271b-edf6-44e2-8232-7c2fc4879cfd

#$sourceDir = "C:\Users\verti\Projects\watch_party\data\media\uncompressed"
#$destDir   = "C:\Users\verti\Projects\watch_party\data\media\compressed"
$sourceDir = "U:\"
$destDir = "X:\"

$targetAudioLang = "jpn"
$targetSubLang   = "eng"
$chunkSize = 2 # in secs

if (-not (Test-Path -Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir | Out-Null
}

if ($SingleFile -ne "") {
    $videoFiles = Get-Item -LiteralPath $SingleFile
} else {
    $videoFiles = Get-ChildItem -Path $sourceDir -File -Include *.mkv, *.mp4 -Recurse
}

foreach ($vid in $videoFiles) {
    $baseName = $vid.BaseName
    
    $relPath = ""
    if ($vid.FullName.StartsWith($sourceDir, [StringComparison]::OrdinalIgnoreCase)) {
        $relPath = $vid.DirectoryName.Substring($sourceDir.Length).TrimStart('\') 
    }

    $targetParentDir = Join-Path -Path $destDir -ChildPath $relPath
    $outDir = Join-Path -Path $targetParentDir -ChildPath "${baseName}_HLS"
    
    if (-not (Test-Path -LiteralPath $outDir)) {
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    }

    $inputPath = $vid.FullName
    Write-Host "`n[ANALYZING] $baseName..." -ForegroundColor Cyan

    # ==========================================
    # --- 1. VIDEO & AUDIO CHECK ---
    # ==========================================
    $masterPlaylistPath = Join-Path -Path $outDir -ChildPath "master.m3u8"
    
    if (-not (Test-Path -LiteralPath $masterPlaylistPath)) {
        Write-Host "  -> Video missing. Encoding Video/Audio streams..." -ForegroundColor Yellow
        
        $audioCheckCmd = "ffprobe -v error -select_streams a:m:language:$targetAudioLang -show_entries stream=index -of csv=p=0 `"$inputPath`""
        $audioIndexes = (Invoke-Expression $audioCheckCmd) -join "`n"

        $audioMap = "0:a:0"
        if (![string]::IsNullOrWhiteSpace($audioIndexes)) {
            $firstAudioIndex = ($audioIndexes -split '\r?\n')[0].Trim()
            $audioMap = "0:$firstAudioIndex"
            Write-Host "    -> Target audio ($targetAudioLang) found at stream index $firstAudioIndex" -ForegroundColor Green
        } else {
            Write-Host "    -> Target audio ($targetAudioLang) missing. Falling back to default track." -ForegroundColor Yellow
        }

        $segmentFileName = "chunk_%v_%03d.m4s"
        $initFileName = "init_%v.mp4"
        $playlistFileName = "playlist_%v.m3u8"
        $masterPlaylistName = "master.m3u8"

        $ffmpegArgs = @(
            "-loglevel", "warning",
            "-fflags", "+genpts",   
            "-i", "`"$inputPath`"",
            "-filter_complex", "`"[0:v]split=3[v1][v2][v3];[v1]scale=1920:-2,format=yuv420p[v1out];[v2]scale=1920:-2,format=yuv420p[v2out];[v3]scale=1920:-2,format=yuv420p[v3out]`"",
            "-map", "`"[v3out]`"", "-c:v:0", "h264_nvenc", "-b:v:0", "8000k", "-maxrate:v:0", "9000k", "-bufsize:v:0", "18000k", "-g", "48", "-no-scenecut", "1",
            "-map", "`"[v2out]`"", "-c:v:1", "h264_nvenc", "-b:v:1", "14000k", "-maxrate:v:1", "16000k", "-bufsize:v:1", "32000k", "-g", "48", "-no-scenecut", "1",
            "-map", "`"[v1out]`"", "-c:v:2", "h264_nvenc", "-b:v:2", "24000k", "-maxrate:v:2", "28000k", "-bufsize:v:2", "56000k", "-g", "48", "-no-scenecut", "1",

            "-map", "$audioMap", "-c:a", "aac", "-b:a", "192k", "-ac", "2",
            "-fps_mode", "cfr",
            "-video_track_timescale", "90000",
            "-max_muxing_queue_size", "1024",
            "-f", "hls",
            "-hls_time", "${chunkSize}",
            "-hls_playlist_type", "vod",
            "-hls_segment_type", "fmp4",
            "-avoid_negative_ts", "make_non_negative",
            
            "-var_stream_map", "`"v:0,agroup:audio v:1,agroup:audio v:2,agroup:audio a:0,agroup:audio,default:yes`"",
            "-master_pl_name", "`"$masterPlaylistName`"",
            "-hls_segment_filename", "`"$segmentFileName`"",
            "-hls_fmp4_init_filename", "`"$initFileName`"",
            "`"$playlistFileName`""
        )
            
        $ffCommand = "ffmpeg " + ($ffmpegArgs -join " ")
        $cmdArgs = "/c pushd `"$outDir`" && $ffCommand"
        Start-Process -FilePath "cmd.exe" -ArgumentList $cmdArgs -Wait -NoNewWindow
    } else {
        Write-Host "  -> [SKIPPED] Video streams already converted." -ForegroundColor DarkGray
    }

    # ==========================================
    # --- 2. SUBTITLES CHECK ---
    # ==========================================
    $subPathVTT = Join-Path -Path $outDir -ChildPath "subtitles.vtt"
    $subPathASS = Join-Path -Path $outDir -ChildPath "subtitles.ass"
    
    if (-not (Test-Path -LiteralPath $subPathVTT) -and -not (Test-Path -LiteralPath $subPathASS)) {
        $subCheckCmd = "ffprobe -v error -select_streams s:m:language:$targetSubLang -show_entries stream=index,codec_name -of csv=p=0 `"$inputPath`""
        $subInfo = (Invoke-Expression $subCheckCmd) -split '\r?\n' | Select-Object -First 1

        if (![string]::IsNullOrWhiteSpace($subInfo)) {
            $parts = $subInfo -split ','
            $firstSubIndex = $parts[0].Trim()
            $subCodec = $parts[1].Trim()

            Write-Host "  -> $targetSubLang Subtitles detected (Codec: $subCodec). Processing..." -ForegroundColor Yellow
            if ($subCodec -match "^(ass|ssa)$") {
                Write-Host "    -> Complex formatting detected. Extracting raw ASS..." -ForegroundColor DarkGray
                $subCmd = "ffmpeg -v warning -i `"$inputPath`" -map 0:$firstSubIndex -c:s copy `"$subPathASS`" -y"
                Invoke-Expression $subCmd

            } elseif ($subCodec -match "^(hdmv_pgs_subtitle|dvd_subtitle|dvb_subtitle|dvb_teletext|xsub|arib_caption)$") {
                Write-Host "    -> [WARNING] Image-based subtitles detected ($subCodec). These must be hardsubbed. Skipping extraction." -ForegroundColor Red

            } else {
                Write-Host "    -> Standard text format detected ($subCodec). Converting to WebVTT..." -ForegroundColor DarkGray
                $subCmd = "ffmpeg -v warning -i `"$inputPath`" -map 0:$firstSubIndex -c:s webvtt `"$subPathVTT`" -y"
                Invoke-Expression $subCmd

                if (Test-Path -LiteralPath $subPathVTT) {
                    Write-Host "    -> Scrubbing formatting artifacts..." -ForegroundColor DarkGray
                    $vttText = Get-Content -LiteralPath $subPathVTT -Raw -Encoding UTF8
                    $vttText = $vttText -replace '\{.*?\}', '' 
                    $vttText = $vttText -replace '(?m)^m\s+[-0-9\.].*$', ''
                    $vttText | Set-Content -LiteralPath $subPathVTT -Encoding UTF8
                } else {
                    Write-Host "    -> [ERROR] FFmpeg could not convert codec '$subCodec' to WebVTT." -ForegroundColor Red
                }
            }
        } else {
            Write-Host "  -> No subtitles found in source video. Skipping." -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  -> [SKIPPED] Subtitles already extracted." -ForegroundColor DarkGray
    }

    # ==========================================
    # --- 2.5 EXTRACT FONTS (MKV ATTACHMENTS) ---
    # ==========================================
    $fontDir = Join-Path -Path $outDir -ChildPath "fonts"
    
    if (-not (Test-Path -LiteralPath $fontDir)) {
        $fontCheckCmd = "ffprobe -loglevel error -select_streams t -show_entries stream=codec_type -of csv=p=0 `"$inputPath`""
        $hasFonts = (Invoke-Expression $fontCheckCmd) -split '\r?\n' | Select-Object -First 1

        if (![string]::IsNullOrWhiteSpace($hasFonts)) {
            Write-Host "  -> Custom fonts detected. Extracting..." -ForegroundColor Yellow
            New-Item -ItemType Directory -Path $fontDir -Force | Out-Null
            
            $fontCmd = "ffmpeg -dump_attachment:t `"`" -i `"$inputPath`" -y 2>NUL"
            $cmdArgs = "/c pushd `"$fontDir`" && $fontCmd"
            Start-Process -FilePath "cmd.exe" -ArgumentList $cmdArgs -Wait -NoNewWindow
            
            $extractedFonts = Get-ChildItem -LiteralPath $fontDir
            if ($extractedFonts.Count -eq 0) {
                Remove-Item -LiteralPath $fontDir -Force
            } else {
                Write-Host "    -> Fonts successfully dumped into /fonts" -ForegroundColor Green
            }
        } else {
            Write-Host "  -> [SKIPPED] No attached fonts found in MKV." -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  -> [SKIPPED] Fonts already extracted." -ForegroundColor DarkGray
    }

    # ==========================================
    # --- 3. THUMBNAILS CHECK ---
    # ==========================================
    $vttPath = Join-Path -Path $outDir -ChildPath "thumbnails.vtt"
    
    if (-not (Test-Path -LiteralPath $vttPath)) {
        Write-Host "  -> Thumbnails missing. Generating Sprite Sheets..." -ForegroundColor Yellow
        
        $spriteCmd = "ffmpeg -loglevel warning -i `"$inputPath`" -vf `"fps=1/10,scale=160:90,tile=10x10`" `"$outDir\sprite_%03d.jpg`" -y"
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c pushd `"$outDir`" && $spriteCmd" -Wait -NoNewWindow

        Write-Host "    -> Generating thumbnails.vtt coordinate file..." -ForegroundColor Yellow
        $durationStr = (Invoke-Expression "ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 `"$inputPath`"")
        $duration = [math]::Floor([double]$durationStr)

        "WEBVTT`n" | Out-File -LiteralPath $vttPath -Encoding utf8

        $thumbCount = [math]::Floor($duration / 10)
        for ($i = 0; $i -le $thumbCount; $i++) {
            $startTime = $i * 10
            $endTime = ($i + 1) * 10

            $startStr = '{0:hh\:mm\:ss\.fff}' -f [timespan]::FromSeconds($startTime)
            $endStr   = '{0:hh\:mm\:ss\.fff}' -f [timespan]::FromSeconds($endTime)

            $imgIndex = [int]([math]::Floor($i / 100)) + 1
            $imgName = "sprite_{0:D3}.jpg" -f $imgIndex

            $subIndex = $i % 100
            $col = $subIndex % 10
            $row = [int]([math]::Floor($subIndex / 10))

            $x = $col * 160
            $y = $row * 90

            "$startStr --> $endStr" | Out-File -LiteralPath $vttPath -Append -Encoding utf8
            "$imgName#xywh=$x,$y,160,90`n" | Out-File -LiteralPath $vttPath -Append -Encoding utf8
        }
    } else {
        Write-Host "  -> [SKIPPED] Thumbnails already generated." -ForegroundColor DarkGray
    }

    Write-Host "[SUCCESS] Finished checks for $baseName`n" -ForegroundColor Green
}

Write-Host "All video conversions are complete!" -ForegroundColor Cyan
Write-Host "Restoring original power scheme..." -ForegroundColor Gray
powercfg /setactive $originalGuid

#Write-Host "Shutting down the computer in 60 seconds..." -ForegroundColor Red
#Write-Host "(To cancel, open a command prompt and type: shutdown /a)" -ForegroundColor Yellow

#shutdown /s /t 60