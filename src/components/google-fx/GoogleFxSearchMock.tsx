/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  ChevronDown,
  Mic,
  Pause,
  Play,
  Plus,
  Search,
  Share2,
  X,
} from "lucide-react";

type RuntimeRef = {
  rafId: number | null;
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  mediaSource: MediaElementAudioSourceNode | null;
  frequencyData: Uint8Array | null;
  currentRate: number;
  targetRate: number;
  phase: number;
  lastIntensity: number;
  lastReactUpdate: number;
  isPlaying: boolean;
};

const BASE_RATE = 17938;
const MIN_CHART = 17000;
const MAX_CHART = 18500;

// Aggressive, but not monstrous.
// Tweak these safely if you want more/less movement.
const EDM_LINE_WAVE = 210;
const EDM_BASS_PUNCH = 105;
const EDM_MID_RIPPLE = 34;
const EDM_BREATHING_WAVE = 16;
const EDM_RATE_VOLATILITY = 980;

// Put your mp3 here:
// public/audio/oke-gas.mp3
const AUDIO_SRC = "/audio/oke-gas.mp3";

const tabs = ["AI Mode", "All", "Finance", "News", "Images", "Shopping", "Forums", "More", "Tools"];
const ranges = ["1D", "5D", "1M", "1Y", "5Y", "Max"];

const googleLikeSeries = [
  17370, 17425, 17555, 17512, 17555, 17562, 17598, 17600, 17600,
  17698, 17765, 17670, 17692, 17676, 17679, 17696, 17750, 17718,
  17802, 17782, 17813, 17812, 17802, 17842, 17833, 17995, 17955,
  18080, 18080, 18022, 18188, 18038, 17950,
];

function formatIDR(value: number) {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatShortTime(value: number) {
  if (!Number.isFinite(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getCssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function sampleFrequency(freq: Uint8Array, index: number, total: number) {
  const exact = (index / Math.max(1, total - 1)) * (freq.length - 1);
  const left = Math.floor(exact);
  const right = Math.min(freq.length - 1, left + 1);
  const mix = exact - left;

  return (freq[left] * (1 - mix) + freq[right] * mix) / 255;
}

export function GoogleFxSearchMock() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const runtime = useRef<RuntimeRef>({
    rafId: null,
    audioContext: null,
    analyser: null,
    mediaSource: null,
    frequencyData: null,
    currentRate: BASE_RATE,
    targetRate: BASE_RATE,
    phase: 0,
    lastIntensity: 0,
    lastReactUpdate: 0,
    isPlaying: false,
  });

  const [rate, setRate] = useState(BASE_RATE);
  const [usd, setUsd] = useState("1");
  const [searchQuery, setSearchQuery] = useState("usd to idr");
  const [trafficLabel, setTrafficLabel] = useState("idle");
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioError, setAudioError] = useState("");

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const converted = useMemo(() => {
    const parsed = Number(usd.replace(",", "."));
    return formatIDR((Number.isFinite(parsed) ? parsed : 0) * rate);
  }, [rate, usd]);

  const setupAudio = async () => {
    if (typeof window === "undefined") return;

    const audioElement = playerRef.current;
    if (!audioElement) return;

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("This browser does not support Web Audio API.");
    }

    if (!runtime.current.audioContext) {
      runtime.current.audioContext = new AudioContextClass();
    }

    const audioContext = runtime.current.audioContext;

    if (!runtime.current.analyser) {
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      analyser.connect(audioContext.destination);

      runtime.current.analyser = analyser;
      runtime.current.frequencyData = new Uint8Array(analyser.frequencyBinCount);
    }

    if (!runtime.current.mediaSource) {
      runtime.current.mediaSource = audioContext.createMediaElementSource(audioElement);
      runtime.current.mediaSource.connect(runtime.current.analyser);
    }

    await audioContext.resume();
  };

  const drawChart = (audioIsPlaying: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const width = rect.width;
    const height = rect.height;

    const plotLeft = 54;
    const plotRight = width - 2;
    const plotTop = 10;
    const plotBottom = height - 34;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;

    const grid = "rgba(154, 160, 166, 0.24)";
    const muted = "rgba(232, 234, 237, 0.86)";
    const green = getCssVar("--google-fx-green", "#81c995");

    let freq: Uint8Array | null = null;
    let intensity = 0;
    let bassEnergy = 0;
    let midEnergy = 0;

    if (
      audioIsPlaying &&
      runtime.current.analyser &&
      runtime.current.frequencyData
    ) {
      runtime.current.analyser.getByteFrequencyData(runtime.current.frequencyData);
      freq = runtime.current.frequencyData;

      for (let i = 0; i < freq.length; i += 1) {
        intensity += freq[i] / 255;
      }

      intensity /= freq.length;

      const bassBins = Math.max(1, Math.floor(freq.length * 0.14));
      const midStart = Math.floor(freq.length * 0.18);
      const midEnd = Math.max(midStart + 1, Math.floor(freq.length * 0.48));

      for (let i = 0; i < bassBins; i += 1) {
        bassEnergy += freq[i] / 255;
      }

      for (let i = midStart; i < midEnd; i += 1) {
        midEnergy += freq[i] / 255;
      }

      bassEnergy /= bassBins;
      midEnergy /= (midEnd - midStart);

      runtime.current.lastIntensity += (intensity - runtime.current.lastIntensity) * 0.18;
      runtime.current.phase += 0.032 + bassEnergy * 0.026;
    } else {
      runtime.current.lastIntensity = 0;
    }

    ctx.clearRect(0, 0, width, height);

    ctx.font = "700 11px Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = muted;

    [18500, 18000, 17500, 17000].forEach((value) => {
      const y = plotTop + ((MAX_CHART - value) / (MAX_CHART - MIN_CHART)) * plotHeight;

      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();

      ctx.fillText(new Intl.NumberFormat("id-ID").format(value), 0, y);
    });

    ctx.font = "700 12px Arial, sans-serif";
    ctx.fillStyle = "#e8eaed";
    ctx.fillText("20 May", plotLeft + plotWidth * 0.34, height - 16);
    ctx.fillText("1 Jun", plotLeft + plotWidth * 0.75, height - 16);

    const points = googleLikeSeries.map((value, index) => {
      let yValue = value;

      if (audioIsPlaying && freq) {
        const raw = sampleFrequency(freq, index, googleLikeSeries.length);
        const shaped = Math.pow(raw, 0.58);

        // More energetic than the first version, but still inside Google's compact chart.
        const audioWave = (shaped - 0.38) * EDM_LINE_WAVE;
        const bassPunch = Math.sin(runtime.current.phase * 2.25 + index * 0.42) * bassEnergy * EDM_BASS_PUNCH;
        const midRipple = Math.sin(runtime.current.phase * 3.6 + index * 1.08) * midEnergy * EDM_MID_RIPPLE;
        const breathingWave = Math.sin(runtime.current.phase * 1.85 + index * 0.82) * EDM_BREATHING_WAVE;

        yValue = value + audioWave + bassPunch + midRipple + breathingWave;

        // Guard rails: keep it looking like Google, not earthquake telemetry.
        yValue = Math.max(MIN_CHART + 140, Math.min(MAX_CHART - 140, yValue));
      }

      const x = plotLeft + (index / (googleLikeSeries.length - 1)) * plotWidth;
      const y = plotTop + ((MAX_CHART - yValue) / (MAX_CHART - MIN_CHART)) * plotHeight;

      return { x, y };
    });

    const area = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
    area.addColorStop(0, "rgba(129, 201, 149, 0.34)");
    area.addColorStop(0.72, "rgba(129, 201, 149, 0.11)");
    area.addColorStop(1, "rgba(129, 201, 149, 0.01)");

    ctx.beginPath();
    ctx.moveTo(points[0].x, plotBottom);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(points[points.length - 1].x, plotBottom);
    ctx.closePath();
    ctx.fillStyle = area;
    ctx.fill();

    if (audioIsPlaying) {
      ctx.save();
      ctx.shadowColor = "rgba(129, 201, 149, 0.62)";
      ctx.shadowBlur = 8 + runtime.current.lastIntensity * 12;
      ctx.strokeStyle = "rgba(129, 201, 149, 0.34)";
      ctx.lineWidth = 5.2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();

      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });

      ctx.stroke();
      ctx.restore();
    }

    ctx.strokeStyle = green;
    ctx.lineWidth = audioIsPlaying ? 2.65 : 2.35;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();

    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });

    ctx.stroke();

    const last = points[points.length - 1];
    ctx.fillStyle = green;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
    ctx.fill();

    if (audioIsPlaying) {
      const smoothIntensity = runtime.current.lastIntensity;
      const volatility = (smoothIntensity - 0.26) * EDM_RATE_VOLATILITY;
      const bassKick = bassEnergy * 180;
      const marketBreath = Math.sin(runtime.current.phase * 1.35) * 28;

      runtime.current.targetRate = BASE_RATE + volatility + bassKick + marketBreath;
      runtime.current.currentRate += (runtime.current.targetRate - runtime.current.currentRate) * 0.09;

      const now = performance.now();

      // Update React UI only 10 times/second, not 60 times/second.
      // Canvas still animates at full FPS.
      if (now - runtime.current.lastReactUpdate > 100) {
        runtime.current.lastReactUpdate = now;
        setRate(runtime.current.currentRate);
        setTrafficLabel(`edm ${Math.min(100, Math.round((smoothIntensity + bassEnergy * 0.35) * 145))}%`);
      }
    }
  };

  useEffect(() => {
    const loop = () => {
      drawChart(runtime.current.isPlaying);
      runtime.current.rafId = window.requestAnimationFrame(loop);
    };

    runtime.current.rafId = window.requestAnimationFrame(loop);

    const handleResize = () => drawChart(runtime.current.isPlaying);
    window.addEventListener("resize", handleResize);

    return () => {
      if (runtime.current.rafId) {
        window.cancelAnimationFrame(runtime.current.rafId);
      }
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const resetToIdle = () => {
    runtime.current.isPlaying = false;
    runtime.current.lastIntensity = 0;
    runtime.current.currentRate = BASE_RATE;
    runtime.current.targetRate = BASE_RATE;
    setRate(BASE_RATE);
    setTrafficLabel("idle");
  };

  const syncAudioDuration = () => {
    const audioElement = playerRef.current;
    if (!audioElement) return;

    const nextDuration = Number.isFinite(audioElement.duration) ? audioElement.duration : 0;

    if (nextDuration > 0) {
      setDuration(nextDuration);
    }
  };

  const seekByClientX = (clientX: number) => {
    const audioElement = playerRef.current;
    const progressElement = progressRef.current;

    if (!audioElement || !progressElement) return;

    const realDuration = Number.isFinite(audioElement.duration) ? audioElement.duration : duration;
    if (!realDuration || realDuration <= 0) return;

    const rect = progressElement.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const nextTime = ratio * realDuration;

    audioElement.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const stopDragging = () => {
    draggingRef.current = false;
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", stopDragging);
    window.removeEventListener("touchmove", handleTouchMove);
    window.removeEventListener("touchend", stopDragging);
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!draggingRef.current) return;
    seekByClientX(event.clientX);
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (!draggingRef.current) return;
    const touch = event.touches[0];
    if (!touch) return;
    seekByClientX(touch.clientX);
  };

  const handleProgressMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    seekByClientX(event.clientX);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDragging);
  };

  const handleProgressTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;

    draggingRef.current = true;
    seekByClientX(touch.clientX);

    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", stopDragging);
  };

  const togglePlay = async () => {
    const audioElement = playerRef.current;
    if (!audioElement) return;

    setAudioError("");

    try {
      if (!audioElement.getAttribute("src")) {
        audioElement.src = AUDIO_SRC;
        audioElement.load();
      }

      syncAudioDuration();

      if (audioElement.paused) {
        await setupAudio();
        await audioElement.play();

        runtime.current.isPlaying = true;
        setIsPlaying(true);
      } else {
        audioElement.pause();

        runtime.current.isPlaying = false;
        setIsPlaying(false);
      }
    } catch (error) {
      console.error("Audio play failed:", error);

      runtime.current.isPlaying = false;
      setIsPlaying(false);
      setAudioError(`Cannot play audio. Check this file: public${AUDIO_SRC}`);
    }
  };

  return (
    <main className="min-h-screen bg-[#202124] text-[#e8eaed] antialiased [--google-fx-green:#81c995]">
      <header className="border-b border-[#3c4043]">
        <div className="mx-auto flex h-[78px] w-full max-w-[1066px] items-center gap-10 px-6">
          <div className="select-none text-[30px] font-medium tracking-[-1.9px] text-white">
            Google
          </div>

          <div className="flex h-[52px] flex-1 items-center rounded-full bg-[#4b4f56] pl-5 pr-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search Google or type a URL"
              className="h-full flex-1 border-0 bg-transparent p-0 text-[16px] font-medium text-[#f1f3f4] shadow-none outline-none placeholder:text-[#bdc1c6]"
            />

            <div className="ml-auto flex shrink-0 items-center gap-4 text-[#bdc1c6]">
              {searchQuery ? (
                <button type="button" onClick={() => setSearchQuery("")} aria-label="Clear search">
                  <X className="h-5 w-5" />
                </button>
              ) : null}
              <div className="h-8 w-px bg-[#6b6f75]" />
              <Mic className="h-5 w-5" />
              <Camera className="h-5 w-5" />
              <Search className="h-5 w-5" />
            </div>
          </div>
        </div>

        <div className="mx-auto flex max-w-[681px] items-end gap-7 px-2 text-[14px] font-medium text-[#9aa0a6] md:ml-[calc(50%-340px)]">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              className={[
                "relative pb-[13px] transition-colors hover:text-[#e8eaed]",
                tab === "All" ? "text-[#e8eaed] after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-full after:bg-[#e8eaed]" : "",
              ].join(" ")}
            >
              {tab}
              {["More", "Tools"].includes(tab) ? (
                <ChevronDown className="ml-1 inline h-3 w-3 align-middle" />
              ) : null}
            </button>
          ))}
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-[681px] grid-cols-1 gap-8 px-2 pt-8 md:grid-cols-[318px_1fr]">
        <div>
          <p className="text-[16px] font-medium text-[#bdc1c6]">1 United States Dollar equals</p>

          <div className="mt-1 text-[40px] font-normal leading-[1.05] tracking-[-1.2px] text-[#e8eaed]">
            {formatIDR(rate)}
          </div>

          <h1 className="mt-1 text-[40px] font-normal leading-[1.12] tracking-[-1.6px] text-[#e8eaed]">
            Indonesian Rupiah
          </h1>

          <p className="mt-4 text-[12px] font-medium text-[#9aa0a6]">
            10 Jun, 08.46 UTC · From Morningstar · Disclaimer
          </p>

          <div className="mt-5 overflow-hidden rounded-[6px] border border-[#5f6368]">
            <div className="grid h-[46px] grid-cols-[120px_1fr] border-b border-[#3c4043]">
              <input
                value={usd}
                onChange={(event) => setUsd(event.target.value)}
                className="h-full rounded-none border-0 bg-transparent px-3 text-[16px] font-medium text-[#e8eaed] shadow-none outline-none"
              />
              <button className="flex items-center justify-end gap-2 border-l border-[#3c4043] px-3 text-[14px] font-semibold text-[#e8eaed]">
                United States Dollar <ChevronDown className="h-4 w-4 text-[#9aa0a6]" />
              </button>
            </div>

            <div className="grid h-[46px] grid-cols-[120px_1fr]">
              <input
                value={converted}
                readOnly
                className="h-full rounded-none border-0 bg-transparent px-3 text-[16px] font-medium text-[#e8eaed] shadow-none outline-none"
              />
              <button className="flex items-center justify-end gap-2 border-l border-[#3c4043] px-3 text-[14px] font-semibold text-[#e8eaed]">
                Indonesian Rupiah <ChevronDown className="h-4 w-4 text-[#9aa0a6]" />
              </button>
            </div>
          </div>
        </div>

        <div className="relative pt-1">
          <div className="mb-[23px] flex items-center justify-between">
            <div className="flex gap-[22px] text-[13px] font-bold text-[#9aa0a6]">
              {ranges.map((range) => (
                <button
                  key={range}
                  type="button"
                  className={[
                    "rounded-full px-2 py-[5px] transition-colors hover:text-[#e8eaed]",
                    range === "1M" ? "bg-[#3a424c] text-[#d2e3fc]" : "",
                  ].join(" ")}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          <canvas ref={canvasRef} className="h-[180px] w-full" />

          <div className="mt-3 flex items-center justify-end text-[11px] font-semibold text-[#9aa0a6]">
            <span className="mr-2 h-2 w-2 rounded-full bg-[#81c995]" />
            traffic: {trafficLabel}
          </div>
        </div>

        <div className="relative z-20 md:col-span-2">
          <div className="w-full rounded-[14px] border border-[#3c4043] bg-[#202124] p-3">
            <audio
              ref={playerRef}
              preload="metadata"
              src={AUDIO_SRC}
              onLoadedMetadata={syncAudioDuration}
              onLoadedData={syncAudioDuration}
              onDurationChange={syncAudioDuration}
              onCanPlay={syncAudioDuration}
              onTimeUpdate={(event) => {
                if (!draggingRef.current) setCurrentTime(event.currentTarget.currentTime || 0);
              }}
              onPlay={() => {
                runtime.current.isPlaying = true;
                setIsPlaying(true);
              }}
              onPause={() => {
                runtime.current.isPlaying = false;
                setIsPlaying(false);
              }}
              onEnded={() => {
                setIsPlaying(false);
                resetToIdle();
              }}
              onError={() => setAudioError(`Audio not found or cannot be loaded: public${AUDIO_SRC}`)}
              className="hidden"
            />

            <div className="flex w-full items-center gap-3">
              <button
                type="button"
                onClick={togglePlay}
                className="relative z-30 grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full bg-[#a8c7fa] p-0 text-[#062e6f] hover:bg-[#b8d1ff]"
                aria-label={isPlaying ? "Pause song" : "Play song"}
              >
                {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
              </button>

              <div className="min-w-[44px] text-right text-[11px] font-semibold tabular-nums text-[#bdc1c6]">
                {formatShortTime(currentTime)}
              </div>

              <div
                ref={progressRef}
                role="slider"
                aria-label="Audio progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                tabIndex={0}
                onMouseDown={handleProgressMouseDown}
                onTouchStart={handleProgressTouchStart}
                className="group relative h-7 flex-1 cursor-pointer select-none"
              >
                <div className="absolute left-0 top-1/2 h-[4px] w-full -translate-y-1/2 rounded-full bg-[#3c4043]" />
                <div
                  className="absolute left-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-[#8ab4f8]"
                  style={{ width: `${progress}%` }}
                />
                <div
                  className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8ab4f8] shadow-[0_0_0_5px_rgba(138,180,248,0.12)] transition-transform group-hover:scale-110"
                  style={{ left: `${progress}%` }}
                />
              </div>

              <div className="min-w-[44px] text-[11px] font-semibold tabular-nums text-[#bdc1c6]">
                {formatShortTime(duration)}
              </div>
            </div>

            <p className="mt-2 text-[11px] font-medium text-[#9aa0a6]">
              Load your mp3 from <code className="rounded bg-[#303134] px-1 py-0.5">public{AUDIO_SRC}</code>
            </p>

            {audioError ? (
              <p className="mt-2 text-[11px] font-semibold text-[#f28b82]">
                {audioError}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="relative z-0 mx-auto mt-8 w-full max-w-[681px] px-2">
        <div className="relative border-t border-[#3c4043] pt-0">
          <button
            type="button"
            className="absolute left-1/2 top-0 flex h-10 w-[372px] max-w-[80vw] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#303134] text-[14px] font-bold text-[#e8eaed] hover:bg-[#36383d] hover:text-white"
          >
            More about USD/IDR
            <ChevronDown className="ml-2 h-4 w-4 -rotate-90" />
          </button>

          <div className="pt-16">
            <h2 className="text-[24px] font-semibold tracking-[-0.5px] text-[#e8eaed]">
              People also ask
            </h2>

            {[
              "How much is 1 USD in IDR?",
              "Why is rupiah so weak?",
              "How much is 1 dollar in Indonesian rupiah today?",
              "How much is $100 worth in Bali?",
            ].map((question) => (
              <button
                key={question}
                type="button"
                className="flex w-full items-center justify-between border-b border-[#3c4043] py-4 text-left text-[16px] font-semibold text-[#e8eaed]"
              >
                {question}
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#2b2d33]">
                  <ChevronDown className="h-5 w-5 text-[#bdc1c6]" />
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* <div className="fixed right-[257px] top-[166px] hidden items-center gap-3 xl:flex">
        <button className="grid h-32 w-32 scale-[0.38] place-items-center rounded-full border border-[#5f6368] text-[#8ab4f8]">
          <Share2 className="h-11 w-11" />
        </button>
        <button className="flex h-32 scale-[0.38] items-center rounded-full bg-[#a8c7fa] px-8 text-[32px] font-medium text-[#062e6f] hover:bg-[#b8d1ff]">
          <Plus className="mr-2 h-8 w-8" />
          Follow
        </button>
      </div> */}
    </main>
  );
}
