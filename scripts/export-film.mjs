import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/workspace";
const WORK = "/tmp/mesa-film";
const FINAL = path.join(ROOT, "artifacts", "mesa-del-mundo-60min.mp4");
const SAMPLE = process.argv.includes("--sample");

fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(path.dirname(FINAL), { recursive: true });

const source = fs.readFileSync(path.join(ROOT, "src/film/guion.ts"), "utf8");

function pull(key) {
  return [...source.matchAll(new RegExp(`${key}:\\s*"([^"]*)"`, "g"))].map((match) => match[1]);
}

const ids = pull("id");
const titles = pull("title");
const places = pull("place");
const stills = pull("still").map((item) => path.join(ROOT, "public", item));
const clips = pull("clip").map((item) => path.join(ROOT, "public", item));
const audios = pull("audio").map((item) => path.join(ROOT, "public", item));
const narrations = pull("narration");
const cardLabels = pull("label");
const cardTexts = pull("text");

if (ids.length !== narrations.length || ids.length !== audios.length) {
  throw new Error(`Guion parse mismatch ${ids.length} ${narrations.length} ${audios.length}`);
}

const chapters = ids.map((id, index) => ({ id, title: titles[index], place: places[index] }));
let cardCursor = 0;
const cards = [];
const chunks = source.split("id:").slice(1);
for (const chunk of chunks) {
  const count = [...chunk.matchAll(/label:/g)].length;
  cards.push(
    Array.from({ length: count }, (_, i) => ({
      label: cardLabels[cardCursor + i],
      text: cardTexts[cardCursor + i],
    })),
  );
  cardCursor += count;
}

function mediaDuration(file) {
  const probe = spawnSync("ffmpeg", ["-hide_banner", "-i", file], { encoding: "utf8" });
  const match = `${probe.stderr}\n${probe.stdout}`.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`No duration for ${file}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function sentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const HOUR = 3600;
const spoken = audios.map((file, index) => {
  try {
    return mediaDuration(file);
  } catch {
    const words = narrations[index].trim().split(/\s+/).length;
    return Math.max(12, words / 2.2);
  }
});

const weights = chapters.map((chapter) => (chapter.id === "prologo" || chapter.id === "epilogo" ? 0.5 : 1));
const mins = spoken.map((value, index) => value + (chapters[index].id === "prologo" ? 8 : 14));
const extra = Math.max(0, HOUR - mins.reduce((sum, value) => sum + value, 0));
const weightSum = weights.reduce((sum, value) => sum + value, 0);
let cursor = 0;
const slots = chapters.map((chapter, index) => {
  const duration = SAMPLE && index === 0 ? 18 : mins[index] + (extra * weights[index]) / weightSum;
  const slot = {
    ...chapter,
    still: stills[index],
    clip: clips[index],
    audio: audios[index],
    narration: narrations[index],
    cards: cards[index] ?? [],
    spoken: spoken[index],
    start: cursor,
    duration,
  };
  cursor += duration;
  return slot;
});
const active = SAMPLE ? slots.slice(0, 1) : slots;

function stamp(seconds) {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function assTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.max(0, seconds % 60);
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function assEscape(text) {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\N").replace(/\{/g, "\\{");
}

function writeAss(slot, file) {
  const events = [
    `Dialogue: 0,${assTime(0.4)},${assTime(Math.min(6.2, slot.duration - 0.2))},Title,,0,0,0,,${assEscape(slot.title)}`,
    `Dialogue: 0,${assTime(0.8)},${assTime(Math.min(6.2, slot.duration - 0.2))},Place,,0,0,0,,${assEscape(slot.place)}`,
  ];
  const lines = sentences(slot.narration);
  const weight = lines.reduce((sum, line) => sum + line.length, 0) || 1;
  let from = 0.35;
  const spokenEnd = Math.min(slot.spoken, slot.duration - 0.4);
  for (const line of lines) {
    const span = ((line.length / weight) * Math.max(1, spokenEnd - 0.35));
    const to = Math.min(spokenEnd, from + span);
    events.push(`Dialogue: 0,${assTime(from)},${assTime(Math.max(from + 0.4, to))},Cap,,0,0,0,,${assEscape(line)}`);
    from = to;
  }
  slot.cards.forEach((card, index) => {
    const start = spokenEnd + index * 16;
    if (start >= slot.duration - 1) return;
    const end = Math.min(slot.duration - 0.3, start + 15);
    events.push(
      `Dialogue: 0,${assTime(start)},${assTime(end)},Card,,0,0,0,,${assEscape(`${card.label}\\N${card.text}`)}`,
    );
  });
  const ass = `\uFEFF[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,DejaVu Serif,60,&H00D8EAF4,&H000000FF,&H00100C09,&H64000000,-1,0,0,0,100,100,0,0,1,3,0,8,70,70,64,1
Style: Place,DejaVu Sans,28,&H004AA0E0,&H000000FF,&H00100C09,&H00000000,0,0,0,0,100,100,1,0,1,2,0,8,70,70,138,1
Style: Cap,DejaVu Sans,34,&H00D8EAF4,&H000000FF,&H00100C09,&H96000000,0,0,0,0,100,100,0,0,1,3,0,2,80,80,42,1
Style: Card,DejaVu Sans,32,&H00D8EAF4,&H000000FF,&H00100C09,&H8C000000,0,0,0,0,100,100,0,0,1,2,0,2,90,90,48,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
  fs.writeFileSync(file, ass);
}

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-y", ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    const tail = (result.stderr || "").slice(-2500);
    throw new Error(`ffmpeg failed\n${tail}`);
  }
}

function renderSlot(slot, index) {
  const out = path.join(WORK, `ch-${String(index).padStart(2, "0")}.mp4`);
  const ass = path.join(WORK, `ch-${String(index).padStart(2, "0")}.ass`);
  writeAss(slot, ass);
  const clipLen = Math.min(8, Math.max(3, slot.duration - 4));
  const stillLen = Math.max(1, slot.duration - clipLen);
  const travel = Math.min(220, 8 * stillLen);
  const assPath = ass.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  console.log(`render ${slot.id} ${slot.duration.toFixed(1)}s`);
  ffmpeg([
    "-i",
    slot.clip,
    "-loop",
    "1",
    "-i",
    slot.still,
    "-f",
    "lavfi",
    "-t",
    stillLen.toFixed(3),
    "-i",
    "color=c=black:s=1280x720:r=24",
    "-i",
    slot.audio,
    "-stream_loop",
    "-1",
    "-i",
    path.join(ROOT, "public/film/music.mp3"),
    "-filter_complex",
    [
      `[0:v]trim=0:${clipLen.toFixed(3)},setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=24,setsar=1[clip]`,
      `[1:v]scale=1680:945:force_original_aspect_ratio=increase,crop=1680:945,setsar=1[bg]`,
      `[2:v][bg]overlay=x='-30-${travel.toFixed(1)}*t/${stillLen.toFixed(3)}':y=-36:shortest=1,fps=24,setsar=1[still]`,
      `[clip][still]concat=n=2:v=1:a=0[vcat]`,
      `[vcat]subtitles='${assPath}'[v]`,
      `[3:a]adelay=280|280,apad,atrim=0:${slot.duration.toFixed(3)},volume=1.35,asplit=2[nar][sc]`,
      `[4:a]atrim=0:${slot.duration.toFixed(3)},volume=0.22[mus]`,
      `[mus][sc]sidechaincompress=threshold=0.02:ratio=8:attack=140:release=780[bed]`,
      `[nar][bed]amix=inputs=2:duration=longest:dropout_transition=0,alimiter=limit=0.92,atrim=0:${slot.duration.toFixed(3)}[a]`,
    ].join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    slot.duration.toFixed(3),
    "-r",
    "24",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    out,
  ]);
  return out;
}

const parts = active.map((slot, index) => renderSlot(slot, index));
const list = path.join(WORK, "list.txt");
fs.writeFileSync(list, parts.map((file) => `file '${file}'`).join("\n"));
const target = SAMPLE ? path.join(WORK, "sample.mp4") : FINAL;
ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", target]);

const lines = [
  "MESA DEL MUNDO | Los mejores platillos del mundo · película 3D narrada (1 hora)",
  "",
  "Una película documental de una hora sobre los mejores platillos del mundo. Animación 3D, narrada en español: de un mole negro de Oaxaca a un trompo al pastor en la Ciudad de México.",
  "",
  "No es un ranking con medalla. Es una mesa. Doce platillos, el fuego que los sostiene y las manos que los repiten.",
  "",
  "CAPÍTULOS",
  ...slots.map((slot) => `${stamp(slot.start)}  ${slot.title} — ${slot.place}`),
  "",
  "Producción Mesa del Mundo · InodeAi",
  "",
  "#MesaDelMundo #Gastronomía #ComidaDelMundo #Documental #Animación3D #FoodFilm #Cocina #PlatillosDelMundo #InodeAi #México #MoleNegro #Sushi #PizzaNapolitana #PatoPekinés #Biryani #Pho #Paella #Ceviche #Tagine #CoqAuVin #Feijoada #TacosAlPastor #DocumentalDeComida #RecetasDelMundo",
  "",
].join("\n");
fs.writeFileSync(path.join(ROOT, "artifacts", "YOUTUBE.txt"), lines);
const total = slots.reduce((sum, slot) => sum + slot.duration, 0);
console.log(`done ${target} timeline ${total.toFixed(1)}s sample=${SAMPLE}`);
