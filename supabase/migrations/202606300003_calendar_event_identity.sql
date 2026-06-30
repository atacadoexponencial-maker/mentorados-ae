alter table public.meetings
  drop constraint if exists individual_meeting_has_mentee,
  drop constraint if exists meetings_google_event_id_key;

alter table public.meetings
  add constraint meetings_calendar_event_unique unique (google_calendar_id, google_event_id);
