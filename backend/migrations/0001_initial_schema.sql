-- Runtime tables currently used by the PostgreSQL-backed stores.
CREATE TABLE IF NOT EXISTS messages (
  id BIGINT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partitions (
  tag TEXT NOT NULL,
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY (tag, message_id)
);

CREATE INDEX IF NOT EXISTS partitions_tag_idx
  ON partitions(tag);

CREATE TABLE IF NOT EXISTS poll_votes (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  option_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, voter_key)
);

CREATE INDEX IF NOT EXISTS poll_votes_message_idx
  ON poll_votes(message_id);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reactor_key TEXT NOT NULL,
  reaction SMALLINT NOT NULL CHECK (reaction IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, reactor_key)
);

CREATE INDEX IF NOT EXISTS message_reactions_reactor_idx
  ON message_reactions(reactor_key, message_id);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  real_name TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  gender SMALLINT NOT NULL DEFAULT 0,
  bio TEXT NOT NULL DEFAULT '',
  avatar_file TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  muted_until TIMESTAMPTZ,
  mute_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  session_version INTEGER NOT NULL DEFAULT 0
);

-- These ALTER statements also let an existing pre-runner database adopt v1.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS users_username_idx
  ON users(username);

CREATE INDEX IF NOT EXISTS users_status_idx
  ON users(status);

CREATE INDEX IF NOT EXISTS users_muted_until_idx
  ON users(muted_until);

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS user_favorites_user_created_idx
  ON user_favorites(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
  ON user_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_notifications_user_unread_idx
  ON user_notifications(user_id, is_read)
  WHERE is_read = false;

CREATE TABLE IF NOT EXISTS apps (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  partition TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  icon_file TEXT,
  icon_url TEXT NOT NULL DEFAULT '',
  icon_background TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apps_status_sort_idx
  ON apps(status, sort_order, created_at);

CREATE INDEX IF NOT EXISTS apps_slug_idx
  ON apps(slug);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_events_created_idx
  ON admin_audit_events(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS admin_audit_events_actor_idx
  ON admin_audit_events(actor, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_events_target_idx
  ON admin_audit_events(target_type, target_id, created_at DESC);

-- Reserved relational models. Existing JSON stores remain the runtime source
-- until their own data migrations and service cutovers are implemented.
CREATE TABLE IF NOT EXISTS managers (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  session_version INTEGER NOT NULL DEFAULT 0
    CHECK (session_version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  CONSTRAINT managers_username_format
    CHECK (username ~ '^[A-Za-z0-9_.-]{3,40}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS managers_username_lower_idx
  ON managers(lower(username));

CREATE INDEX IF NOT EXISTS managers_status_idx
  ON managers(status);

CREATE TABLE IF NOT EXISTS manager_permissions (
  manager_username TEXT NOT NULL
    REFERENCES managers(username) ON UPDATE CASCADE ON DELETE CASCADE,
  permission TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (manager_username, permission),
  CONSTRAINT manager_permissions_name_not_empty
    CHECK (length(btrim(permission)) > 0)
);

CREATE INDEX IF NOT EXISTS manager_permissions_permission_idx
  ON manager_permissions(permission, manager_username);

-- message_id intentionally remains a durable historical identifier instead
-- of cascading when a soft-deleted message is eventually purged.
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  message_id BIGINT NOT NULL,
  target_type TEXT NOT NULL
    CHECK (target_type IN ('message', 'comment')),
  comment_id TEXT,
  category TEXT NOT NULL,
  reason TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  target_excerpt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed')),
  resolution TEXT
    CHECK (resolution IN ('dismiss', 'delete_comment', 'delete_message')),
  public_reply TEXT NOT NULL DEFAULT '',
  processed_by TEXT NOT NULL DEFAULT '',
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reports_id_format
    CHECK (id ~ '^[0-9a-f]{32}$'),
  CONSTRAINT reports_comment_target
    CHECK (
      (target_type = 'message' AND comment_id IS NULL)
      OR (
        target_type = 'comment'
        AND comment_id IS NOT NULL
        AND length(btrim(comment_id)) > 0
      )
    ),
  CONSTRAINT reports_processing_state
    CHECK (
      (status = 'pending' AND resolution IS NULL AND processed_at IS NULL)
      OR (status = 'processed' AND resolution IS NOT NULL AND processed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS reports_status_created_idx
  ON reports(status, created_at DESC, id);

CREATE INDEX IF NOT EXISTS reports_target_idx
  ON reports(message_id, target_type, comment_id);

CREATE INDEX IF NOT EXISTS reports_processed_idx
  ON reports(processed_at DESC, id)
  WHERE status = 'processed';

CREATE TABLE IF NOT EXISTS feedback_tickets (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL
    CHECK (category IN ('bug', 'feature', 'account', 'content', 'other')),
  title TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'resolved', 'closed')),
  public_reply TEXT NOT NULL DEFAULT '',
  internal_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  updated_by TEXT NOT NULL DEFAULT '',
  CONSTRAINT feedback_tickets_id_format
    CHECK (id ~ '^[0-9a-f]{32}$')
);

CREATE INDEX IF NOT EXISTS feedback_tickets_status_updated_idx
  ON feedback_tickets(status, updated_at DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS feedback_tickets_category_created_idx
  ON feedback_tickets(category, created_at DESC);

CREATE TABLE IF NOT EXISTS feedback_history (
  id BIGSERIAL PRIMARY KEY,
  ticket_id TEXT NOT NULL
    REFERENCES feedback_tickets(id) ON DELETE CASCADE,
  previous_status TEXT NOT NULL
    CHECK (previous_status IN ('pending', 'in_progress', 'resolved', 'closed')),
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'in_progress', 'resolved', 'closed')),
  reply_updated BOOLEAN NOT NULL DEFAULT false,
  note_updated BOOLEAN NOT NULL DEFAULT false,
  actor TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_history_ticket_created_idx
  ON feedback_history(ticket_id, created_at, id);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  sort_order BIGSERIAL NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  updated_by TEXT NOT NULL DEFAULT '',
  CONSTRAINT notices_id_format
    CHECK (id ~ '^[0-9a-f]{32}$'),
  CONSTRAINT notices_content_not_empty
    CHECK (length(btrim(content)) > 0)
);

CREATE INDEX IF NOT EXISTS notices_created_idx
  ON notices(created_at, sort_order);
