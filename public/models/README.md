# 3D placeholder asset

`placeholder-companion.glb` is a **stand-in**, not production character art.
It's the "Fox" sample model from Khronos's official glTF-Sample-Models
repository — used here only to build and demo the 3D rendering pipeline
(loading, idle animation, click/focus interaction) end to end before any
real per-character 3D asset exists.

**License:** base model CC0 (Low poly fox, by PixelMannen /
opengameart.org), rigging & animation CC-BY 4.0 (by @tomkranis on
Sketchfab), glTF conversion by @AsoboStudio / @scurest. See
https://github.com/KhronosGroup/glTF-Sample-Models/tree/main/2.0/Fox for
the source and full license text.

**Replacing it:** each character needs its own `.glb`/`.gltf` with at
minimum an `Idle`-named (or first) animation clip — see
`src/components/immersive/character-3d.tsx` for how the clip is picked.
Once characters have real per-character models (uploaded to R2/Supabase
storage like `image_url` already is), point `model_url` at that asset
instead of this placeholder — see the `20260931_add_character_model_url.sql`
migration and `character-portrait.tsx`'s fallback logic.
