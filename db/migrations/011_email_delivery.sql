-- The outbox was a table the console read, because this project had no way to send
-- mail. It now carries the owner credential out over SMTP, which means it has to
-- know what has already gone: a password is generated once and its hash is
-- replaced immediately, so a message that failed to send cannot be regenerated and
-- a message that was sent must not be sent again.
--
-- `sent_at` is therefore the delivery marker. NULL means the message is still the
-- only copy of that password in existence, so the delivery pass retries it; a
-- timestamp means it went out and must not be repeated. The rows are the audit
-- trail either way, so nothing is deleted when a message is sent.
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

-- A partial index over the messages that still owe a delivery attempt. It is
-- partial because the sent ones vastly outnumber the pending ones after the first
-- rotation, and only the pending ones are ever looked up.
CREATE INDEX IF NOT EXISTS email_outbox_pending_idx
  ON email_outbox (created_at)
  WHERE sent_at IS NULL;

-- The owner's own password is the one message whose body is a live credential, so
-- it gets its own index to find the pending one without scanning the inbox.
CREATE INDEX IF NOT EXISTS email_outbox_owner_credentials_idx
  ON email_outbox (created_at)
  WHERE kind = 'owner-credentials' AND sent_at IS NULL;
