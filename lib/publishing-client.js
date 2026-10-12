import { supabase } from "./supabase";

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export async function listPublicationDrafts(status = "") {
  let query = supabase.from("content_drafts").select("id,city_id,status,content,revision,instagram_url,posted_at,updated_at,created_at,cities(name,state_region),content_draft_events(count)").eq("channel", "instagram").eq("format", "carousel").order("updated_at", { ascending: false });
  if (status) query = query.eq("status", status);
  return unwrap(await query.limit(100));
}

export async function loadPublicationDraft(id) {
  return unwrap(await supabase.from("content_drafts").select("*,cities(name,state_region),content_draft_events(id,event_id,position,content,fact_snapshot,events(title,start_at))").eq("id", id).eq("channel", "instagram").eq("format", "carousel").order("position", { referencedTable: "content_draft_events", ascending: true }).maybeSingle());
}

export async function listCities() {
  return unwrap(await supabase.from("cities").select("id,name,state_region").eq("active", true).order("name"));
}

export async function createCarousel(cityId, requestId) {
  return unwrap(await supabase.rpc("create_instagram_carousel", { target_city_id: cityId, request_id: requestId }));
}

export async function listCarouselCandidates(cityId) {
  return unwrap(await supabase.rpc("list_instagram_carousel_candidates", { target_city_id: cityId }));
}

export async function saveCarousel(id, content, eventIds, expectedRevision) {
  return unwrap(await supabase.rpc("save_instagram_carousel", { target_draft_id: id, next_content: content, event_ids: eventIds, expected_revision: expectedRevision }));
}

export async function transitionCarousel(id, targetStatus, metadata, expectedRevision, content = null, eventIds = null) {
  return unwrap(await supabase.rpc("transition_instagram_carousel", { target_draft_id: id, target_status: targetStatus, transition_metadata: metadata || {}, expected_revision: expectedRevision, next_content: content, event_ids: eventIds }));
}

