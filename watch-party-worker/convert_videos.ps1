# Convert-Videos.ps1

$activeScheme = powercfg -getactivescheme
$originalGuid = ([regex]::Match($activeScheme, '(?<=GUID: ).*?(?=\s*\()')).Value

powercfg /setactive c3ec271b-edf6-44e2-8232-7c2fc4879cfd

$sourceDir = "C:\Users\verti\Projects\watch_party\media\uncompressed"
$destDir   = "C:\Users\verti\Projects\watch_party\media\compressed"

$targetAudioLang = "jpn"
$targetSubLang   = "eng"
$chunkSize = 2 # in secs

if (-not (Test-Path -Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir | Out-Null
}

param (
    [string]$SingleFile = ""
)

if ($SingleFile -ne "") {
    $videoFiles = Get-Item -LiteralPath $SingleFile
} else {
    $videoFiles = Get-ChildItem -Path $sourceDir -File -Include *.mkv, *.mp4 -Recurse
}

foreach ($vid in $videoFiles) {
    $baseName = $vid.BaseName
    
    $outDir = Join-Path -Path $destDir -ChildPath "${baseName}_HLS"
    
    if (Test-Path -LiteralPath $outDir) {
        Write-Host "[SKIPPED] $baseName is already converted." -ForegroundColor DarkGray
        continue
    }

    Write-Host "[PROCESSING] Creating HLS stream for $baseName..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $outDir | Out-Null

    $inputPath = $vid.FullName

    # --- 1. SUBTITLES ---
    $subCheckCmd = "ffprobe -v error -select_streams s:m:language:$targetSubLang -show_entries stream=index -of csv=p=0 `"$inputPath`""
    $subIndexes = (Invoke-Expression $subCheckCmd) -join "`n"

    if (![string]::IsNullOrWhiteSpace($subIndexes)) {
        Write-Host "  -> $targetSubLang Subtitles detected. Extracting..." -ForegroundColor Yellow
        $firstSubIndex = ($subIndexes -split '\r?\n')[0].Trim()
        $subPath = Join-Path -Path $outDir -ChildPath "subtitles.vtt"
        
        $subCmd = "ffmpeg -v warning -i `"$inputPath`" -map 0:$firstSubIndex -c:s webvtt `"$subPath`" -y"
        Invoke-Expression $subCmd
    } else {
        Write-Host "  -> No subtitles found in $targetSubLang. Skipping extraction." -ForegroundColor DarkGray
    }

    # --- 2. AUDIO ---
    $audioCheckCmd = "ffprobe -v error -select_streams a:m:language:$targetAudioLang -show_entries stream=index -of csv=p=0 `"$inputPath`""
    $audioIndexes = (Invoke-Expression $audioCheckCmd) -join "`n"

    $audioMap = "0:a:0" # Default to the very first audio track if we can't find our target language
    if (![string]::IsNullOrWhiteSpace($audioIndexes)) {
        $firstAudioIndex = ($audioIndexes -split '\r?\n')[0].Trim()
        $audioMap = "0:$firstAudioIndex"
        Write-Host "  -> Target audio ($targetAudioLang) found at stream index $firstAudioIndex" -ForegroundColor Green
    } else {
        Write-Host "  -> Target audio ($targetAudioLang) missing. Falling back to default track." -ForegroundColor Yellow
    }

    # Define the base names for the output files
    $segmentFileName = "chunk_%v_%03d.m4s"
    $initFileName = "init_%v.mp4"
    $playlistFileName = "playlist_%v.m3u8"
    $masterPlaylistName = "master.m3u8"

    $ffmpegArgs = @(
        "-loglevel", "warning",
        "-fflags", "+genpts",   
        "-i", "`"$inputPath`"",
        "-filter_complex", "`"[0:v]split=3[v1][v2][v3];[v1]scale=1920:-2,format=yuv420p[v1out];[v2]scale=1280:-2,format=yuv420p[v2out];[v3]scale=854:-2,format=yuv420p[v3out]`"",

        "-map", "`"[v3out]`"", "-c:v:0", "h264_nvenc", "-b:v:0", "1200k", "-maxrate:v:0", "1500k", "-bufsize:v:0", "3000k", "-g", "48", "-no-scenecut", "1",
        "-map", "`"[v2out]`"", "-c:v:1", "h264_nvenc", "-b:v:1", "3500k", "-maxrate:v:1", "4000k", "-bufsize:v:1", "8000k", "-g", "48", "-no-scenecut", "1",
        "-map", "`"[v1out]`"", "-c:v:2", "h264_nvenc", "-b:v:2", "8000k", "-maxrate:v:2", "9000k", "-bufsize:v:2", "18000k", "-g", "48", "-no-scenecut", "1",

        "-map", "$audioMap", "-c:a", "aac", "-b:a", "192k", "-ac", "2",

        "-fps_mode", "cfr",
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

    Write-Host "  -> Encoding Video/Audio streams..." -ForegroundColor Yellow
        
    $ffCommand = "ffmpeg " + ($ffmpegArgs -join " ")
    
    $cmdArgs = "/c cd /d `"$outDir`" && $ffCommand"
    
    Start-Process -FilePath "cmd.exe" -ArgumentList $cmdArgs -Wait -NoNewWindow
    
    Write-Host "[SUCCESS] Finished $baseName`n" -ForegroundColor Green
}

Write-Host "All video conversions are complete!" -ForegroundColor Cyan
Write-Host "Restoring original power scheme..." -ForegroundColor Gray
powercfg /setactive $originalGuid

#Write-Host "Shutting down the computer in 60 seconds..." -ForegroundColor Red
#Write-Host "(To cancel, open a command prompt and type: shutdown /a)" -ForegroundColor Yellow

#shutdown /s /t 60