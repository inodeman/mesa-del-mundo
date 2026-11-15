export type Card = { label: string; text: string };

export type Chapter = {
  id: string;
  kicker: string;
  title: string;
  place: string;
  still: string;
  clip: string;
  audio: string;
  narration: string;
  cards: Card[];
};

export const HOUR = 3600;

export const YT_TITLE =
  "MESA DEL MUNDO | Los mejores platillos del mundo · película 3D narrada (1 hora)";

export const HASHTAGS = [
  "#MesaDelMundo",
  "#Gastronomía",
  "#ComidaDelMundo",
  "#Documental",
  "#Animación3D",
  "#FoodFilm",
  "#Cocina",
  "#PlatillosDelMundo",
  "#InodeAi",
  "#México",
  "#MoleNegro",
  "#Sushi",
  "#PizzaNapolitana",
  "#PatoPekinés",
  "#Biryani",
  "#Pho",
  "#Paella",
  "#Ceviche",
  "#Tagine",
  "#CoqAuVin",
  "#Feijoada",
  "#TacosAlPastor",
  "#DocumentalDeComida",
  "#RecetasDelMundo",
];

export type Slot = Chapter & { start: number; duration: number; spoken: number };

export function sentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function estimateSpoken(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(12, words / 2.2);
}

export function buildTimeline(chapters: Chapter[], spoken: number[]): Slot[] {
  const weights = chapters.map((c) => (c.id === "prologo" || c.id === "epilogo" ? 0.5 : 1));
  const mins = spoken.map((s, i) => s + (chapters[i].id === "prologo" ? 8 : 14));
  const sum = mins.reduce((a, b) => a + b, 0);
  const extra = Math.max(0, HOUR - sum);
  const wsum = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  return chapters.map((c, i) => {
    const duration = mins[i] + (extra * weights[i]) / wsum;
    const slot: Slot = { ...c, start: cursor, duration, spoken: spoken[i] };
    cursor += duration;
    return slot;
  });
}

export function stamp(seconds: number) {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function clock(seconds: number) {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function youtubeDescription(slots: Slot[]) {
  const lines = slots.map((s) => `${stamp(s.start)}  ${s.title} — ${s.place}`).join("\n");
  return [
    "Una película documental de una hora sobre los mejores platillos del mundo. Animación 3D, narrada en español: de un mole negro de Oaxaca a un trompo al pastor en la Ciudad de México.",
    "",
    "No es un ranking con medalla. Es una mesa. Doce platillos, el fuego que los sostiene y las manos que los repiten.",
    "",
    "CAPÍTULOS",
    lines,
    "",
    "Producción Mesa del Mundo · InodeAi",
    "",
    HASHTAGS.join(" "),
  ].join("\n");
}

export function findSlot(slots: Slot[], time: number) {
  const t = Math.min(Math.max(0, time), Math.max(0, totalDuration(slots) - 0.05));
  let idx = 0;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].start <= t) idx = i;
  }
  return idx;
}

export function totalDuration(slots: Slot[]) {
  if (!slots.length) return HOUR;
  const last = slots[slots.length - 1];
  return last.start + last.duration;
}
