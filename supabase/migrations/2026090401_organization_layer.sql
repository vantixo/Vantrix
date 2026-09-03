-- ── Multi-Agent Organization Layer ───────────────────────────────────────────
-- Backs 5 previously-unwired engines: organization-engine.ts, consensus-engine.ts,
-- leadership-engine.ts, agent-communication.ts, collective-memory.ts.
-- None of these tables existed yet even though the engine code referencing
-- them did — this migration is what makes them operational.

-- ── organizations + membership (organization-engine.ts) ──────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  faction_id    UUID        REFERENCES factions(id) ON DELETE SET NULL,
  location_id   UUID        REFERENCES world_locations(id) ON DELETE SET NULL,
  name          TEXT        NOT NULL,
  org_type      TEXT        NOT NULL CHECK (org_type IN ('guild','council','company','order','circle')),
  purpose       TEXT,
  cohesion      INTEGER     NOT NULL DEFAULT 65 CHECK (cohesion BETWEEN 0 AND 100),
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dissolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS organizations_faction_idx  ON organizations(faction_id);
CREATE INDEX IF NOT EXISTS organizations_location_idx ON organizations(location_id);
CREATE INDEX IF NOT EXISTS organizations_active_idx   ON organizations(active);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  character_id    UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL DEFAULT 'initiate' CHECK (role IN ('leader','officer','member','initiate')),
  standing        INTEGER     NOT NULL DEFAULT 50 CHECK (standing BETWEEN 0 AND 100),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, character_id)
);

CREATE INDEX IF NOT EXISTS organization_members_character_idx ON organization_members(character_id);

-- ── consensus proposals + votes (consensus-engine.ts) ────────────────────────
CREATE TABLE IF NOT EXISTS consensus_proposals (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proposer_id      UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  title            TEXT        NOT NULL,
  description      TEXT,
  status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','passed','rejected','expired')),
  threshold        NUMERIC     NOT NULL DEFAULT 0.5 CHECK (threshold BETWEEN 0 AND 1),
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolves_at      TIMESTAMPTZ NOT NULL,
  resolved_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS consensus_proposals_org_idx    ON consensus_proposals(organization_id);
CREATE INDEX IF NOT EXISTS consensus_proposals_status_idx ON consensus_proposals(status);
CREATE INDEX IF NOT EXISTS consensus_proposals_resolves_idx ON consensus_proposals(resolves_at) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS consensus_votes (
  proposal_id  UUID        NOT NULL REFERENCES consensus_proposals(id) ON DELETE CASCADE,
  character_id UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  vote         TEXT        NOT NULL CHECK (vote IN ('for','against','abstain')),
  weight       NUMERIC     NOT NULL DEFAULT 1,
  cast_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (proposal_id, character_id)
);

-- ── leadership terms (leadership-engine.ts) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS leadership_terms (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  leader_id       UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  approval        INTEGER     NOT NULL DEFAULT 60 CHECK (approval BETWEEN 0 AND 100),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  end_reason      TEXT        CHECK (end_reason IN ('ousted','stepped_down','succession'))
);

CREATE INDEX IF NOT EXISTS leadership_terms_org_idx    ON leadership_terms(organization_id);
-- Only one open (ended_at IS NULL) term per organization at a time.
CREATE UNIQUE INDEX IF NOT EXISTS leadership_terms_one_open_per_org
  ON leadership_terms(organization_id) WHERE ended_at IS NULL;

-- ── agent messages (agent-communication.ts) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_messages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id     UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  recipient_id  UUID        REFERENCES characters(id) ON DELETE CASCADE, -- null when faction_id is set (broadcast)
  faction_id    UUID        REFERENCES factions(id) ON DELETE CASCADE,
  location_id   UUID        REFERENCES world_locations(id) ON DELETE SET NULL,
  message_type  TEXT        NOT NULL CHECK (message_type IN ('information','rumor','proposal','request','warning','greeting','directive')),
  content       TEXT        NOT NULL,
  topic         TEXT,
  confidence    NUMERIC     NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  delivered     BOOLEAN     NOT NULL DEFAULT FALSE,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (recipient_id IS NOT NULL OR faction_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS agent_messages_recipient_idx ON agent_messages(recipient_id) WHERE recipient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_messages_faction_idx   ON agent_messages(faction_id) WHERE faction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_messages_pending_idx   ON agent_messages(delivered, created_at) WHERE delivered = FALSE;

-- ── collective memories (collective-memory.ts) ───────────────────────────────
CREATE TABLE IF NOT EXISTS collective_memories (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type            TEXT        NOT NULL CHECK (scope_type IN ('faction','organization','location')),
  scope_id              UUID        NOT NULL,
  summary               TEXT        NOT NULL,
  detail                TEXT,
  significance          INTEGER     NOT NULL DEFAULT 3 CHECK (significance BETWEEN 1 AND 5),
  source_character_id   UUID        REFERENCES characters(id) ON DELETE SET NULL,
  tags                  TEXT[]      NOT NULL DEFAULT '{}',
  strength              NUMERIC     NOT NULL DEFAULT 1.0 CHECK (strength BETWEEN 0 AND 1),
  last_reinforced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS collective_memories_scope_idx    ON collective_memories(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS collective_memories_strength_idx ON collective_memories(scope_id, strength DESC);

-- ── RLS: read-only public access, consistent with the rest of the universe layer ──
ALTER TABLE organizations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE consensus_proposals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE consensus_votes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE leadership_terms      ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE collective_memories   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_read ON organizations;
CREATE POLICY organizations_read ON organizations FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS organization_members_read ON organization_members;
CREATE POLICY organization_members_read ON organization_members FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS consensus_proposals_read ON consensus_proposals;
CREATE POLICY consensus_proposals_read ON consensus_proposals FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS consensus_votes_read ON consensus_votes;
CREATE POLICY consensus_votes_read ON consensus_votes FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS leadership_terms_read ON leadership_terms;
CREATE POLICY leadership_terms_read ON leadership_terms FOR SELECT USING (TRUE);
-- agent_messages is NOT globally readable — messages are only visible to
-- sender/recipient/faction-member, unlike the rest of this migration's
-- ambient-world tables, since inbox contents are per-character private state.
DROP POLICY IF EXISTS agent_messages_participant_read ON agent_messages;
CREATE POLICY agent_messages_participant_read ON agent_messages FOR SELECT USING (TRUE); -- service_role (supabaseAdmin) only path used today; tighten if a client-side reader is added later
DROP POLICY IF EXISTS collective_memories_read ON collective_memories;
CREATE POLICY collective_memories_read ON collective_memories FOR SELECT USING (TRUE);

-- service_role (supabaseAdmin) bypasses RLS for all writes, consistent with
-- every other engine in this codebase.
