-- Seeds app_config with the footer's support/contact email, so it becomes
-- backend-editable instead of hardcoded as a mailto: link in
-- src/components/home/footer.tsx. Mirrors the login_portraits pattern
-- (20261016_seed_login_portraits_config.sql): plain value, fallback lives
-- in code (src/lib/config/contact.ts) if this row is ever missing/invalid.
insert into app_config (key, value, description)
values (
  'contact_email',
  'vantrix@vantrix.ink',
  'Support/contact email shown in the site footer (mailto: link). Edit this value to change it without a redeploy.'
)
on conflict (key) do nothing;
