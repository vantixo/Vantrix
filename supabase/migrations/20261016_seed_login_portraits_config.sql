-- Seeds app_config with the login page's portrait collage, so it becomes
-- admin-editable (/admin/login-portraits) instead of hardcoded in
-- src/app/auth/login/page.tsx. Value is a JSON array of {src, alt} objects;
-- src may be a /public asset path or an http(s) URL (see
-- isSafeLocalImagePath/isSafeExternalUrl in src/lib/security.edge.ts, which
-- gate writes from the admin API).
--
-- First entry doubles as the mobile blurred backdrop portrait — see
-- PORTRAITS[0] usage in the login page.
insert into app_config (key, value, description)
values (
  'login_portraits',
  '[{"src":"/images/characters/countess-vesper-night.jpg","alt":""},{"src":"/images/characters/seraphine-sultry.jpg","alt":""},{"src":"/images/characters/lord-adrian-gunslinger.jpg","alt":""},{"src":"/images/characters/hispania-valeria.jpg","alt":""}]',
  'JSON array of {src, alt} portraits shown on the /auth/login page background collage. First entry is also used as the mobile blurred backdrop. Edit via /admin/login-portraits.'
)
on conflict (key) do nothing;
