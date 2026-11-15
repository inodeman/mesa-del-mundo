import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy, List, Pause, Play, SkipBack, SkipForward, Subtitles } from "lucide-react";
import { CHAPTERS } from "@/film/guion";
import {
  HASHTAGS,
  YT_TITLE,
  buildTimeline,
  clock,
  estimateSpoken,
  findSlot,
  sentences,
  totalDuration,
  youtubeDescription,
  type Slot,
} from "@/film/timeline";

function probe(src: string, fallback: number) {
  return new Promise<number>((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    const done = (value: number) => {
      audio.src = "";
      resolve(value);
    };
    audio.onloadedmetadata = () => {
      done(Number.isFinite(audio.duration) && audio.duration > 0.4 ? audio.duration : fallback);
    };
    audio.onerror = () => done(fallback);
    audio.src = src;
  });
}

export function Theater() {
  const [spoken, setSpoken] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [caps, setCaps] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const [ficha, setFicha] = useState(false);
  const [copied, setCopied] = useState("");
  const [clipOn, setClipOn] = useState(true);

  const playingRef = useRef(false);
  const timeRef = useRef(0);
  const originRef = useRef(0);
  const anchorRef = useRef(0);
  const slotIdRef = useRef("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number>(0);

  const slots = useMemo<Slot[]>(() => {
    const durations = spoken ?? CHAPTERS.map((c) => estimateSpoken(c.narration));
    return buildTimeline(CHAPTERS, durations);
  }, [spoken]);

  const total = totalDuration(slots);
  const index = findSlot(slots, time);
  const slot = slots[index];
  const local = Math.max(0, time - slot.start);
  const lines = sentences(slot.narration);
  const weights = lines.map((line) => line.length);
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  let caption = "";
  if (local < slot.spoken) {
    let acc = 0;
    const target = local / Math.max(slot.spoken, 0.1);
    for (let i = 0; i < lines.length; i++) {
      acc += weights[i] / weightSum;
      caption = lines[i];
      if (acc >= target) break;
    }
  }
  const card =
    local >= slot.spoken && slot.cards.length
      ? slot.cards[Math.floor((local - slot.spoken) / 16) % slot.cards.length]
      : null;

  const showChrome = useCallback(() => {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    if (playingRef.current) {
      hideTimer.current = window.setTimeout(() => setChrome(false), 3200);
    }
  }, []);

  const syncMedia = useCallback((t: number, slotsNow: Slot[]) => {
    const i = findSlot(slotsNow, t);
    const current = slotsNow[i];
    const at = t - current.start;
    const audio = audioRef.current;
    const music = musicRef.current;
    const video = videoRef.current;
    if (music && music.paused && playingRef.current) void music.play().catch(() => undefined);
    if (music) music.volume = at < current.spoken ? 0.14 : 0.3;
    if (audio) {
      if (audio.dataset.chapter !== current.id) {
        audio.dataset.chapter = current.id;
        const want = Math.max(0, at);
        audio.onloadedmetadata = () => {
          const limit = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.05) : want;
          audio.currentTime = Math.min(want, limit);
          if (playingRef.current && want < current.spoken) void audio.play().catch(() => undefined);
        };
        audio.src = current.audio;
      } else if (at < current.spoken - 0.15) {
        if (Math.abs(audio.currentTime - at) > 0.6) audio.currentTime = at;
        if (playingRef.current && audio.paused) void audio.play().catch(() => undefined);
      } else if (!audio.paused) {
        audio.pause();
      }
    }
    if (video) {
      const showClip = at < 9.6;
      setClipOn(showClip);
      if (slotIdRef.current !== current.id) {
        slotIdRef.current = current.id;
        const want = Math.min(Math.max(at, 0), 9.2);
        video.onloadeddata = () => {
          video.currentTime = want;
          if (playingRef.current && want < 9.6) void video.play().catch(() => undefined);
        };
        video.src = current.clip;
      } else if (showClip && playingRef.current) {
        if (Math.abs(video.currentTime - at) > 0.55) video.currentTime = Math.min(at, 9.2);
        if (video.paused) void video.play().catch(() => undefined);
      } else if (!video.paused) {
        video.pause();
      }
    }
  }, []);

  useEffect(() => {
    let cancel = false;
    void Promise.all(CHAPTERS.map((c) => probe(c.audio, estimateSpoken(c.narration)))).then((values) => {
      if (!cancel && !playingRef.current && timeRef.current < 0.2) setSpoken(values);
    });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    playingRef.current = playing;
    if (!playing) {
      audioRef.current?.pause();
      musicRef.current?.pause();
      videoRef.current?.pause();
      setChrome(true);
      return;
    }
    originRef.current = timeRef.current;
    anchorRef.current = performance.now();
    showChrome();
    let frame = 0;
    let lastPaint = 0;
    const step = () => {
      const next = originRef.current + (performance.now() - anchorRef.current) / 1000;
      if (next >= total) {
        timeRef.current = total;
        setTime(total);
        setPlaying(false);
        return;
      }
      timeRef.current = next;
      if (performance.now() - lastPaint > 220) {
        lastPaint = performance.now();
        setTime(next);
      }
      syncMedia(next, slots);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, showChrome, slots, syncMedia, total]);

  const arm = (nextPlaying: boolean) => {
    if (nextPlaying) {
      void musicRef.current?.play().catch(() => undefined);
      void audioRef.current?.play().catch(() => undefined);
    }
    setPlaying(nextPlaying);
  };

  const seek = (value: number) => {
    const next = Math.min(Math.max(0, value), total);
    timeRef.current = next;
    originRef.current = next;
    anchorRef.current = performance.now();
    slotIdRef.current = "";
    if (audioRef.current) audioRef.current.dataset.chapter = "";
    setTime(next);
    syncMedia(next, slots);
    showChrome();
  };

  const jump = (i: number) => {
    seek(slots[i]?.start ?? 0);
    setListOpen(false);
    if (!playingRef.current) arm(true);
  };

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopied("");
    }
  };

  const description = youtubeDescription(slots);

  const intro = !playing && time < 0.4;

  return (
    <main
      className="relative min-h-dvh overflow-hidden bg-bg text-fg"
      onPointerDown={showChrome}
      onPointerMove={showChrome}
    >
      <audio ref={audioRef} preload="auto" />
      <audio ref={musicRef} src="/film/music.mp3" loop preload="auto" />

      <img
        src={slot.still}
        alt=""
        className={`still-drift absolute inset-0 h-full w-full object-cover ${clipOn ? "opacity-0" : "opacity-100"}`}
        style={{ animationPlayState: playing && !clipOn ? "running" : "paused" }}
      />
      <video
        ref={videoRef}
        className={`absolute inset-0 h-full w-full object-cover ${clipOn ? "opacity-100" : "opacity-0"}`}
        muted
        playsInline
        poster={slot.still}
      />
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_160px_rgb(16_12_9_/_0.62)]" />

      {!intro ? (
        <div className="pointer-events-none absolute left-0 right-0 top-0 bg-gradient-to-b from-bg/80 to-transparent p-4 sm:p-6">
          <p className="text-xs tracking-[0.22em] text-primary uppercase">{slot.kicker}</p>
          <h1 className="font-display text-3xl leading-none text-balance text-fg sm:text-5xl">{slot.title}</h1>
          <p className="mt-1 text-sm text-fg/80">{slot.place}</p>
        </div>
      ) : null}

      {!intro && caps && caption ? (
        <p className="absolute inset-x-4 bottom-36 rounded-lg bg-bg/75 px-4 py-3 text-center text-sm leading-snug text-pretty text-fg sm:bottom-32 sm:text-base">
          {caption}
        </p>
      ) : null}
      {!intro && !caption && card ? (
        <div className="absolute inset-x-4 bottom-36 rounded-lg border border-border bg-bg/80 px-4 py-3 sm:bottom-32 sm:max-w-md">
          <p className="text-xs tracking-[0.18em] text-primary uppercase">{card.label}</p>
          <p className="mt-1 text-sm leading-snug text-pretty text-fg">{card.text}</p>
        </div>
      ) : null}

      {intro ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg/50 px-6 text-center">
          <p className="text-xs tracking-[0.28em] text-primary uppercase">Película · 1 hora</p>
          <p className="font-display mt-3 text-4xl text-balance text-fg sm:text-6xl">Mesa del Mundo</p>
          <p className="mt-3 max-w-md text-sm text-pretty text-fg/90">
            Los mejores platillos del mundo, en animación 3D y narrados.
          </p>
          <button
            type="button"
            onClick={() => arm(true)}
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-bg"
          >
            <Play className="size-4" fill="currentColor" />
            Reproducir
          </button>
        </div>
      ) : null}

      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg via-bg/90 to-transparent px-3 pt-10 pb-3 transition-opacity sm:px-6 ${chrome || intro ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
          <label className="flex items-center gap-3 text-xs text-muted tabular-nums">
            <span className="w-16">{clock(time)}</span>
            <input
              aria-label="Posición de la película"
              className="h-11 w-full accent-primary"
              type="range"
              min={0}
              max={total}
              step={0.1}
              value={Math.min(time, total)}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span className="w-16 text-right">{clock(total)}</span>
          </label>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <IconButton label="Capítulo anterior" onClick={() => jump(Math.max(0, index - 1))}>
                <SkipBack className="size-5" />
              </IconButton>
              <button
                type="button"
                aria-label={playing ? "Pausa" : "Reproducir"}
                onClick={() => arm(!playing)}
                className="inline-flex size-11 items-center justify-center rounded-full bg-primary text-bg"
              >
                {playing ? <Pause className="size-5" /> : <Play className="size-5" fill="currentColor" />}
              </button>
              <IconButton label="Capítulo siguiente" onClick={() => jump(Math.min(slots.length - 1, index + 1))}>
                <SkipForward className="size-5" />
              </IconButton>
            </div>
            <div className="flex items-center gap-1">
              <IconButton label="Subtítulos" pressed={caps} onClick={() => setCaps((value) => !value)}>
                <Subtitles className="size-5" />
              </IconButton>
              <IconButton label="Capítulos" pressed={listOpen} onClick={() => setListOpen((value) => !value)}>
                <List className="size-5" />
              </IconButton>
              <button
                type="button"
                onClick={() => setFicha((value) => !value)}
                className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-sm text-fg"
              >
                Ficha
              </button>
            </div>
          </div>
        </div>
      </div>

      {listOpen ? (
        <div className="fixed inset-0 z-20 bg-bg/70" onClick={() => setListOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 max-h-[70dvh] overflow-auto rounded-t-xl border border-border bg-surface p-4 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-96 sm:rounded-none"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="font-display text-2xl text-fg">Capítulos</p>
            <ol className="mt-3 flex flex-col">
              {slots.map((item, i) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => jump(i)}
                    className="flex min-h-11 w-full items-center gap-3 border-b border-border py-2 text-left"
                  >
                    <img src={item.still} alt="" className="h-12 w-20 rounded-md object-cover" />
                    <span>
                      <span className="block text-sm text-fg">{item.title}</span>
                      <span className="block text-xs text-muted">
                        {clock(item.start)} · {item.place}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}

      {ficha ? (
        <div className="fixed inset-0 z-20 overflow-auto bg-bg/80 p-4" onClick={() => setFicha(false)}>
          <article
            className="mx-auto mt-6 max-w-xl rounded-xl border border-border bg-surface p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-xs tracking-[0.2em] text-primary uppercase">YouTube</p>
            <h2 className="font-display mt-2 text-3xl text-balance text-fg">Título y descripción</h2>
            <p className="mt-4 text-xs tracking-[0.16em] text-muted uppercase">Título</p>
            <p className="mt-1 text-sm text-pretty text-fg">{YT_TITLE}</p>
            <button
              type="button"
              onClick={() => void copy("title", YT_TITLE)}
              className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm text-primary"
            >
              {copied === "title" ? <Check className="size-4" /> : <Copy className="size-4" />}
              Copiar título
            </button>
            <p className="mt-4 text-xs tracking-[0.16em] text-muted uppercase">Descripción</p>
            <pre className="mt-2 max-h-72 overflow-auto text-sm leading-relaxed whitespace-pre-wrap text-fg">
              {description}
            </pre>
            <button
              type="button"
              onClick={() => void copy("desc", description)}
              className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm text-primary"
            >
              {copied === "desc" ? <Check className="size-4" /> : <Copy className="size-4" />}
              Copiar descripción
            </button>
            <p className="mt-4 text-xs leading-relaxed text-muted">{HASHTAGS.join(" ")}</p>
            <button
              type="button"
              onClick={() => setFicha(false)}
              className="mt-4 inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm text-bg"
            >
              Volver a la película
            </button>
          </article>
        </div>
      ) : null}
    </main>
  );
}

function IconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex size-11 items-center justify-center rounded-full ${pressed ? "text-primary" : "text-fg"}`}
    >
      {children}
    </button>
  );
}
