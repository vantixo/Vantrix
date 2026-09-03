-- Likes for character-room chat messages. Separate table (not a column
-- on community_chat_messages) so "who liked what" is queryable and a
-- like/unlike is a cheap upsert/delete rather than a read-modify-write
-- race on a counter column under concurrent likes.
CREATE TABLE IF NOT EXISTS community_chat_message_likes (
  message_id  uuid NOT NULL REFERENCES community_chat_messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS community_chat_message_likes_message_id_idx
  ON community_chat_message_likes (message_id);
