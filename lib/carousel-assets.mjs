export const INSTAGRAM_WIDTH = 1080;
export const INSTAGRAM_HEIGHT = 1350;

const COLORS = [
  { paper: "#f4eddf", ink: "#171512", accent: "#e04b31", wash: "#f0b85a" },
  { paper: "#efe9d8", ink: "#14241f", accent: "#2a7061", wash: "#d7a541" },
  { paper: "#f2e7dc", ink: "#22151b", accent: "#9d3152", wash: "#e79056" },
  { paper: "#e9ece5", ink: "#172329", accent: "#2f6074", wash: "#d6a948" },
];

const clean = value => typeof value === "string" ? value.trim() : "";
const safeDate = value => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date : null;
};

export function eventFactLines(event = {}) {
  const date = safeDate(event.start_at);
  const dateLine = date ? new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "America/Denver",
  }).format(date).toUpperCase() : "DATE TBA";
  const timeLine = event.is_all_day ? "ALL DAY" : date ? new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/Denver",
  }).format(date).toUpperCase() : "TIME TBA";
  const venue = clean(event.venue) || "VENUE TBA";
  const locality = clean(event.locality) || clean(event.city) || "EL PASO";
  const price = event.is_free ? "FREE" : event.price_min_cents != null
    ? `FROM $${Math.round(Number(event.price_min_cents) / 100)}` : "PRICE NOT LISTED";
  const age = event.is_all_ages ? "ALL AGES" : event.age_min != null ? `${event.age_min}+` : "AGE NOT LISTED";
  return { dateLine, timeLine, venue, locality, price, age };
}

export function buildCarouselSlides(content = {}, events = []) {
  const handle = clean(content.instagram_handle) || "@heynowelpaso";
  const cover = {
    kind: "cover",
    kicker: clean(content.cover_kicker) || "HEY NOW PICKS",
    title: clean(content.title) || "El Paso picks",
    handle,
    count: events.length,
  };
  return [cover, ...events.map((event, index) => ({
    kind: "event",
    event_id: event.event_id || event.id || null,
    number: index + 1,
    title: clean(event.title) || "Untitled event",
    handle,
    ...eventFactLines(event),
  }))];
}

export function wrapCanvasText(context, value, maxWidth, maxLines) {
  const words = clean(value).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = "";
  while (words.length && lines.length < maxLines) {
    const word = words.shift();
    const candidate = line ? `${line} ${word}` : word;
    if (!line || context.measureText(candidate).width <= maxWidth) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.length && lines.length) {
    let last = `${lines.at(-1)}…`;
    while (last.length > 1 && context.measureText(last).width > maxWidth) last = `${last.slice(0, -2)}…`;
    lines[lines.length - 1] = last;
  }
  return lines;
}

function drawTextBlock(context, text, x, y, maxWidth, maxLines, lineHeight) {
  const lines = wrapCanvasText(context, text, maxWidth, maxLines);
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function drawBorder(context, palette) {
  context.strokeStyle = palette.ink;
  context.lineWidth = 12;
  context.strokeRect(42, 42, INSTAGRAM_WIDTH - 84, INSTAGRAM_HEIGHT - 84);
  context.fillStyle = palette.paper;
  context.fillRect(402, 27, 276, 36);
  context.strokeStyle = palette.ink;
  context.lineWidth = 9;
  context.beginPath();
  context.moveTo(430, 48);
  context.lineTo(500, 48);
  context.lineTo(540, 28);
  context.lineTo(580, 68);
  context.lineTo(620, 48);
  context.lineTo(650, 48);
  context.stroke();
}

export function renderCarouselSlide(canvas, slide, index, total) {
  canvas.width = INSTAGRAM_WIDTH;
  canvas.height = INSTAGRAM_HEIGHT;
  const context = canvas.getContext("2d");
  const palette = COLORS[index % COLORS.length];
  context.fillStyle = palette.paper;
  context.fillRect(0, 0, INSTAGRAM_WIDTH, INSTAGRAM_HEIGHT);
  drawBorder(context, palette);

  context.fillStyle = palette.wash;
  context.fillRect(72, 96, 936, 210);
  context.fillStyle = palette.accent;
  context.fillRect(72, 306, 936, slide.kind === "cover" ? 780 : 650);
  context.fillStyle = palette.ink;
  context.fillRect(72, slide.kind === "cover" ? 1086 : 956, 936, 222);

  context.textBaseline = "top";
  context.fillStyle = palette.ink;
  context.font = "700 34px Arial, sans-serif";
  context.letterSpacing = "3px";
  context.fillText(slide.kind === "cover" ? slide.kicker : `HEY NOW PICK ${slide.number}`, 112, 138);
  context.font = "900 52px Arial Black, Arial, sans-serif";
  context.fillText("HEY NOW", 112, 205);

  context.fillStyle = palette.paper;
  if (slide.kind === "cover") {
    context.font = "900 102px Arial Black, Arial, sans-serif";
    drawTextBlock(context, slide.title, 112, 390, 850, 5, 112);
    context.font = "700 32px Arial, sans-serif";
    context.fillText(`${slide.count} EVENTS · SAVE THIS POST`, 112, 990);
  } else {
    context.font = "900 78px Arial Black, Arial, sans-serif";
    const factsY = drawTextBlock(context, slide.title, 112, 380, 850, 5, 88) + 42;
    context.font = "700 34px Arial, sans-serif";
    context.fillText(`${slide.dateLine} · ${slide.timeLine}`, 112, Math.min(factsY, 780));
    context.font = "700 30px Arial, sans-serif";
    drawTextBlock(context, slide.venue, 112, Math.min(factsY + 58, 838), 850, 2, 38);
    context.font = "700 25px Arial, sans-serif";
    context.fillText(`${slide.locality.toUpperCase()}  ·  ${slide.price}  ·  ${slide.age}`, 112, 900);
  }

  context.fillStyle = palette.paper;
  context.font = "700 31px Arial, sans-serif";
  context.fillText(slide.handle, 112, slide.kind === "cover" ? 1148 : 1018);
  context.textAlign = "right";
  context.fillText(`${index + 1} / ${total}`, 968, slide.kind === "cover" ? 1148 : 1018);
  context.textAlign = "left";
  context.font = "600 22px Arial, sans-serif";
  context.fillText("EL PASO · CURATED, NOT CROWDSOURCED", 112, slide.kind === "cover" ? 1204 : 1080);
  return canvas;
}

export function slideFilename(index, slide) {
  const label = slide.kind === "cover" ? "cover" : clean(slide.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || `event-${index}`;
  return `heynow-${String(index + 1).padStart(2, "0")}-${label}.png`;
}
