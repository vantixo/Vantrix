-- AD-TARGETING: audience column on `ads`
--
-- The site now runs three gender-locked Discover homepages
-- (/discover/female, /discover/male, /discover/anime) instead of one mixed
-- feed, but the `ads` table and AdBoard component had no concept of
-- audience — every active ad in a given position (hero/sidebar/inline)
-- showed on all three homepages identically. This column lets an admin
-- target a creative at one specific homepage, or leave it at the default
-- 'all' to keep running everywhere unchanged.
--
-- Existing rows default to 'all' so nothing currently live changes
-- behavior after this migration — every ad already running keeps showing
-- on every homepage until an admin explicitly narrows its audience.
alter table ads
  add column if not exists audience text not null default 'all'
    check (audience in ('all', 'female', 'male', 'anime'));

comment on column ads.audience is
  'Which Discover homepage this ad targets: female | male | anime, or all (default) to run on every homepage unchanged.';

create index if not exists idx_ads_audience on ads(audience) where active = true;
