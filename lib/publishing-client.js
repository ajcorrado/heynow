import { supabase } from "./supabase";

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export async function listPublicationDrafts(status = "") {
  let query = supabase.from("content_drafts").select("id,event_id,city_id,status,content,revision,instagram_url,posted_at,updated_at,created_at,events(title,start_at),cities(name,state_region)").order("updated_at", { ascending: false });
  if (status) query = query.eq("status", status);
  return unwrap(await query.limit(100));
}

export async function loadPublicationDraft(id) {
  return unwrap(await supabase.from("content_drafts").select("*,events(title,start_at),cities(name,state_region)").eq("id", id).maybeSingle());
}

export async function listCities() {
  return unwrap(await supabase.from("cities").select("id,name,state_region").eq("active", true).order("name"));
}

export async function createDraftFromEvent(eventId) {
  return unwrap(await supabase.rpc("create_content_draft_from_event", { target_event_id: eventId }));
}

export async function createManualDraft(cityId) {
  return unwrap(await supabase.rpc("create_manual_content_draft", { target_city_id: cityId }));
}

export async function saveDraft(id, content, expectedRevision) {
  return unwrap(await supabase.rpc("save_content_draft", { target_draft_id: id, next_content: content, expected_revision: expectedRevision }));
}

export async function transitionDraft(id, targetStatus, metadata, expectedRevision) {
  return unwrap(await supabase.rpc("transition_content_draft", { target_draft_id: id, target_status: targetStatus, transition_metadata: metadata || {}, expected_revision: expectedRevision }));
}
