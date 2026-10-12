-- Poster/cover image from the ticketing source (District / allevents JSON-LD), shown on the radar.
alter table events add column if not exists image_url text;
