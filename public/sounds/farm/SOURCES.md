# Farm game recordings

Short animal calls for Kids' Corner's Farm game (spec §7.5). All eight are from [Mixkit](https://mixkit.co) under the
[Mixkit Sound Effects Free License](https://mixkit.co/license/#sfxFree), which allows use in commercial and
non-commercial projects for free, without attribution. Check the license text before redistributing the files on their
own (the license is for use in a project, not for re-publishing a sound library).

Each file was processed with ffmpeg on 2026-10-07: mixed to mono, leading silence below -50 dB (all of it, so playback starts on the sound) and trailing silence
below -60 dB trimmed (gently, so decaying tails are kept), 0.2 s of silence padded on the end, loudness normalised to
-16 LUFS (true peak -1.5 dBTP), re-encoded as 96 kbps MP3.

| File | Mixkit item | Title | Length |
|---|---|---|---|
| `cow.mp3` | 1747 | Cow single moo | 1.8 s |
| `pig.mp3` | 315 | Farm pig short grunt | 0.5 s |
| `sheep.mp3` | 1741 | Sheep sounds | 0.8 s |
| `goat.mp3` | 1760 | Goat single baa | 1.0 s |
| `horse.mp3` | 1762 | Stallion horse neigh | 2.8 s |
| `rooster.mp3` | 2462 | Rooster crowing in the morning | 2.8 s |
| `dog.mp3` | 1 | Dog barking twice | 1.3 s |
| `cat.mp3` | 93 | Sweet kitty meow | 0.9 s |

Source URL pattern: `https://assets.mixkit.co/active_storage/sfx/<item>/<item>-preview.mp3`.

## Names (`names/*.mp3`)

The spoken animal names were generated on 2026-10-07 with [ElevenLabs](https://elevenlabs.io) text-to-speech
(model `eleven_multilingual_v2`, premade voice "Sarah", id `EXAVITQu4vr4xnSDxMaL`, speed 0.9, style 0.2), one word
per file ("Cow.", "Pig.", …), under the account's ElevenLabs licence (commercial use is included on paid plans; check
the plan's terms before launch). Processed like the calls, with a 0.15 s end pad.

## Colour names (`public/sounds/colors/*.mp3`)

Red, Blue, Yellow, Green, Orange and Purple for the Colors game, generated and processed exactly like the animal
names above (ElevenLabs, voice "Sarah", 2026-10-07).
