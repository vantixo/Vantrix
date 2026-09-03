-- Allow a 'gift' role on messages so gifts sent to a character show up
-- inline in the chat timeline (rendered as a distinct system-style card
-- by the client) instead of being invisible outside the dating tab.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;
ALTER TABLE messages ADD CONSTRAINT messages_role_check
  CHECK (role IN ('user','assistant','system','gift'));
