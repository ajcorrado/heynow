export const DRAFT_STATUSES = ["draft", "ready", "posted", "skipped"];

export const CAROUSEL_MIN_EVENTS = 3;
export const CAROUSEL_MAX_EVENTS = 8;

export const EMPTY_CAROUSEL_CONTENT = Object.freeze({
  schema_version: 2,
  title: "",
  cover_kicker: "",
  caption: "",
  instagram_handle: "@heynowelpaso",
});

export const EMPTY_CONTENT = Object.freeze({
  schema_version: 1,
  headline: "",
  editorial_take: "",
  caption: "",
  display_facts: {
    date: "",
    time: "Time TBA",
    venue: "",
    locality: "",
    price: "Price not listed",
    age: "Age restriction not listed",
  },
});

const clean = value => typeof value === "string" ? value.trim() : "";

export function normalizeContent(value = {}) {
  const facts = value?.display_facts || {};
  return {
    schema_version: 1,
    headline: clean(value?.headline),
    editorial_take: clean(value?.editorial_take),
    caption: clean(value?.caption),
    display_facts: {
      date: clean(facts.date),
      time: clean(facts.time) || "Time TBA",
      venue: clean(facts.venue),
      locality: clean(facts.locality),
      price: clean(facts.price) || "Price not listed",
      age: clean(facts.age) || "Age restriction not listed",
    },
  };
}

export function normalizeCarouselContent(value = {}) {
  return {
    schema_version: 2,
    title: clean(value?.title),
    cover_kicker: clean(value?.cover_kicker),
    caption: clean(value?.caption),
    instagram_handle: clean(value?.instagram_handle) || "@heynowelpaso",
  };
}

export function carouselReadinessErrors(value, eventCount = 0, unapprovedCount = 0) {
  const content = normalizeCarouselContent(value);
  const errors = {};
  if (!content.title) errors.title = "Carousel title is required.";
  if (content.title.length > 90) errors.title = "Carousel title must be 90 characters or fewer.";
  if (!content.caption) errors.caption = "Instagram caption is required.";
  if (content.caption.length > 2200) errors.caption = "Caption must be 2,200 characters or fewer.";
  if (eventCount < CAROUSEL_MIN_EVENTS) errors.events = `Choose at least ${CAROUSEL_MIN_EVENTS} events.`;
  if (eventCount > CAROUSEL_MAX_EVENTS) errors.events = `Choose no more than ${CAROUSEL_MAX_EVENTS} events.`;
  if (unapprovedCount > 0) errors.approval = `${unapprovedCount} selected event${unapprovedCount === 1 ? "" : "s"} still need${unapprovedCount === 1 ? "s" : ""} data review.`;
  return errors;
}

export function readinessErrors(value) {
  const content = normalizeContent(value);
  const errors = {};
  if (!content.headline) errors.headline = "Headline is required.";
  if (content.headline.length > 90) errors.headline = "Headline must be 90 characters or fewer.";
  if (!content.editorial_take) errors.editorial_take = "Editorial take is required.";
  if (content.editorial_take.length > 500) errors.editorial_take = "Editorial take must be 500 characters or fewer.";
  if (!content.caption) errors.caption = "Caption is required.";
  if (content.caption.length > 2200) errors.caption = "Caption must be 2,200 characters or fewer.";
  for (const key of ["date", "venue", "locality"]) {
    if (!content.display_facts[key]) errors[`display_facts.${key}`] = `${key[0].toUpperCase()}${key.slice(1)} is required.`;
  }
  return errors;
}

export function canTransition(from, to) {
  return ({ draft: ["ready", "skipped"], ready: ["draft", "posted", "skipped"], skipped: ["draft"], posted: [] }[from] || []).includes(to);
}

export function isInstagramUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["instagram.com", "www.instagram.com"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function transitionErrors(status, target, content, metadata = {}) {
  const errors = {};
  if (!canTransition(status, target)) errors.status = `Cannot move ${status} to ${target}.`;
  if (target === "ready") Object.assign(errors, readinessErrors(content));
  if (target === "posted" && !isInstagramUrl(metadata.instagram_url)) errors.instagram_url = "Enter a valid HTTPS instagram.com URL.";
  return errors;
}

