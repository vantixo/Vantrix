-- ═══════════════════════════════════════════════════════════════════════
-- Character Voice — real, distinct ElevenLabs voice per character
-- ═══════════════════════════════════════════════════════════════════════
--
-- Before this migration, characters.voice_profile only held abstract
-- pitch/pace/warmth tuning — no column anywhere stored WHICH ElevenLabs
-- voice a character actually spoke with. /api/voice/tts fell back to one
-- of 3 hardcoded gender-bucket voices, and in practice nearly every
-- character in the app was voiced as the same "Rachel" default. See
-- src/lib/ai/voice-library.ts for the curated voice table and
-- src/lib/ai/digital-person-bootstrap.ts for how new characters get
-- assigned a real voice going forward.

alter table characters add column if not exists elevenlabs_voice_id text;

-- Backfill: give every existing character (created before this column
-- existed) a real, distinct voice now, using the exact same 5-archetype
-- keyword rules as digital-person-bootstrap.ts's selectPreset() and the
-- same id table as voice-library.ts's ARCHETYPE_VOICE_IDS/
-- DEFAULT_ELEVENLABS_VOICE_IDS — so a character created before this
-- migration and one created after it land on the same voice for the same
-- persona text. Only touches rows that don't already have one; new
-- creations set this themselves via the bootstrap path and are never
-- overwritten here.
update characters
set elevenlabs_voice_id = case
  when lower(
    coalesce(personality, '') || ' ' || coalesce(backstory, '') || ' ' ||
    coalesce(occupation, '')  || ' ' || coalesce(category, '')
  ) ~ 'poet|writer|novelist|literary'
    then case when gender = 'male' then 'ErXwobaYiN019PkySvjV' else '21m00Tcm4TlvDq8ikWAM' end -- Antoni / Rachel

  when lower(
    coalesce(personality, '') || ' ' || coalesce(backstory, '') || ' ' ||
    coalesce(occupation, '')  || ' ' || coalesce(category, '')
  ) ~ 'gam(er|ing)|streamer|esports'
    then case when gender = 'male' then 'yoZ06aMxZJJ28mfd3POQ' else 'AZnzlk1XvdvUeBnXmlld' end -- Sam / Domi

  when lower(
    coalesce(personality, '') || ' ' || coalesce(backstory, '') || ' ' ||
    coalesce(occupation, '')  || ' ' || coalesce(category, '')
  ) ~ 'professor|academic|research|scientist|teacher'
    then case when gender = 'male' then 'VR6AewLTigWG4xSOukaG' else 'ThT5KcBeYPX3keUQqHPh' end -- Arnold / Dorothy

  when lower(
    coalesce(personality, '') || ' ' || coalesce(backstory, '') || ' ' ||
    coalesce(occupation, '')  || ' ' || coalesce(category, '')
  ) ~ 'girl.?next.?door|sweet|bubbly|cheerful'
    then case when gender = 'male' then 'pNInz6obpgDQGcFmaJgB' else 'EXAVITQu4vr4xnSDxMaL' end -- Adam / Bella

  when lower(
    coalesce(personality, '') || ' ' || coalesce(backstory, '') || ' ' ||
    coalesce(occupation, '')  || ' ' || coalesce(category, '')
  ) ~ 'companion|devoted|caring|nurtur|gentle|soothing|comfort'
    then case when gender = 'male' then 'TxGEqnHWrfWFTfGW9XjX' else 'MF3mGyEYCl7XYWbV9V6O' end -- Josh / Elli

  else
    case when gender = 'male' then 'pNInz6obpgDQGcFmaJgB' else '21m00Tcm4TlvDq8ikWAM' end -- Adam / Rachel default
end
where elevenlabs_voice_id is null;
