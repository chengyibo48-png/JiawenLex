-- Prevent URL normalization from escaping an owner directory.
alter table public.materials add constraint materials_canonical_attachment_path check (
 file_path is null or (file_path ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)+$' and file_path !~ '(^|/)\.{1,2}(/|$)')
);
alter table public.practice_attempts add constraint attempts_canonical_recording_path check (
 recording_path is null or (recording_path ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)+$' and recording_path !~ '(^|/)\.{1,2}(/|$)')
);
alter table public.practice_attempts add constraint attempts_recording_retention_choice check (
 saved_recording = (recording_path is not null)
);
alter table public.transcription_jobs add constraint jobs_canonical_audio_path check (
 audio_path = '' or (audio_path ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)+$' and audio_path !~ '(^|/)\.{1,2}(/|$)')
);
