-- Autheo Close Desk: initial schema.
-- Applied only by `npm run db:migrate`; the application never changes the schema at startup.

CREATE TABLE app_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  display_name  text,
  -- Subject identifier issued by the authentication provider. Bound on first sign-in.
  auth_subject  text UNIQUE,
  is_admin      boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  invited_by    uuid REFERENCES app_users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  activated_at  timestamptz,
  CONSTRAINT app_users_email_lowercase CHECK (email = lower(email))
);
CREATE UNIQUE INDEX app_users_email_key ON app_users (email);

CREATE TABLE offerings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  property_name  text,
  currency       char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  target_raise   numeric(20, 2) CHECK (target_raise IS NULL OR target_raise > 0),
  is_demo        boolean NOT NULL DEFAULT false,
  created_by     uuid NOT NULL REFERENCES app_users (id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE offering_members (
  offering_id  uuid NOT NULL REFERENCES offerings (id),
  user_id      uuid NOT NULL REFERENCES app_users (id),
  role         text NOT NULL CHECK (role IN ('reviewer', 'approver')),
  added_by     uuid NOT NULL REFERENCES app_users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (offering_id, user_id)
);
CREATE INDEX offering_members_user_idx ON offering_members (user_id);

CREATE TABLE import_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id      uuid NOT NULL REFERENCES offerings (id),
  kind             text NOT NULL CHECK (kind IN ('subscriptions', 'funding', 'allocations')),
  filename         text NOT NULL,
  file_sha256      text NOT NULL,
  byte_size        integer NOT NULL,
  row_count        integer NOT NULL,
  valid_count      integer NOT NULL,
  invalid_count    integer NOT NULL,
  new_count        integer NOT NULL,
  unchanged_count  integer NOT NULL,
  conflict_count   integer NOT NULL,
  duplicate_count  integer NOT NULL,
  column_mapping   jsonb NOT NULL,
  totals           jsonb NOT NULL,
  invalid_rows     jsonb NOT NULL DEFAULT '[]'::jsonb,
  imported_by      uuid NOT NULL REFERENCES app_users (id),
  imported_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_batches_offering_idx ON import_batches (offering_id, kind, imported_at DESC);

-- One row per imported version of a source record. Content is immutable; only `state` moves.
--   active      the version reconciliation uses
--   conflict    a later import supplied different content under the same key; awaiting review
--   superseded  replaced by a version a reviewer accepted
--   rejected    a conflicting version a reviewer declined
CREATE TABLE source_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id       uuid NOT NULL REFERENCES offerings (id),
  kind              text NOT NULL CHECK (kind IN ('subscriptions', 'funding', 'allocations')),
  record_key        text NOT NULL,
  state             text NOT NULL CHECK (state IN ('active', 'conflict', 'superseded', 'rejected')),
  content_hash      text NOT NULL,
  data              jsonb NOT NULL,
  raw               jsonb NOT NULL,
  batch_id          uuid NOT NULL REFERENCES import_batches (id),
  row_number        integer NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  state_changed_at  timestamptz,
  state_changed_by  uuid REFERENCES app_users (id),
  -- The same content under the same key is stored once, which makes re-imports idempotent.
  CONSTRAINT source_records_version_key UNIQUE (offering_id, kind, record_key, content_hash)
);
CREATE UNIQUE INDEX source_records_one_active ON source_records (offering_id, kind, record_key) WHERE state = 'active';
CREATE INDEX source_records_current_idx ON source_records (offering_id) WHERE state IN ('active', 'conflict');

-- Reviewer decisions are kept apart from source records and are append-only.
CREATE TABLE review_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             bigserial NOT NULL UNIQUE,
  offering_id     uuid NOT NULL REFERENCES offerings (id),
  subject_kind    text NOT NULL CHECK (subject_kind IN ('row', 'funding', 'conflict')),
  subject_key     text NOT NULL,
  exception_code  text,
  action          text NOT NULL CHECK (action IN ('acknowledge', 'link', 'exclude', 'accept_incoming', 'keep_existing', 'revoke')),
  note            text NOT NULL CHECK (length(btrim(note)) >= 10),
  fingerprint     text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by      uuid NOT NULL REFERENCES app_users (id),
  decided_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_decisions_offering_idx ON review_decisions (offering_id, seq);

-- Approved, frozen closes. The export bytes are stored so a download never recomputes them.
CREATE TABLE snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id        uuid NOT NULL REFERENCES offerings (id),
  version            integer NOT NULL CHECK (version >= 1),
  state_fingerprint  text NOT NULL,
  summary            jsonb NOT NULL,
  register_csv       text NOT NULL,
  register_sha256    text NOT NULL,
  exceptions_csv     text NOT NULL,
  exceptions_sha256  text NOT NULL,
  approval_note      text,
  approved_by        uuid NOT NULL REFERENCES app_users (id),
  approved_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offering_id, version)
);

CREATE TABLE snapshot_register_lines (
  snapshot_id      uuid NOT NULL REFERENCES snapshots (id),
  line_no          integer NOT NULL,
  investor_ref     text NOT NULL,
  share_class      text NOT NULL,
  subscription_id  text NOT NULL,
  approved_amount  numeric(20, 2) NOT NULL CHECK (approved_amount > 0),
  approved_units   numeric(28, 8) NOT NULL CHECK (approved_units > 0),
  currency         char(3) NOT NULL,
  PRIMARY KEY (snapshot_id, line_no)
);

CREATE TABLE audit_events (
  id           bigserial PRIMARY KEY,
  offering_id  uuid REFERENCES offerings (id),
  actor_id     uuid REFERENCES app_users (id),
  actor_email  text,
  action       text NOT NULL,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_offering_idx ON audit_events (offering_id, id DESC);

-- Database-level guards: history tables are append-only and source content is immutable.
CREATE FUNCTION close_desk_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: the table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE FUNCTION close_desk_source_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.offering_id IS DISTINCT FROM OLD.offering_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.record_key IS DISTINCT FROM OLD.record_key
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.data IS DISTINCT FROM OLD.data
     OR NEW.raw IS DISTINCT FROM OLD.raw
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.row_number IS DISTINCT FROM OLD.row_number
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'source record content is immutable; only its state may change'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER source_records_immutable_content BEFORE UPDATE ON source_records
  FOR EACH ROW EXECUTE FUNCTION close_desk_source_record_guard();
CREATE TRIGGER source_records_no_delete BEFORE DELETE ON source_records
  FOR EACH ROW EXECUTE FUNCTION close_desk_forbid_change();

CREATE TRIGGER import_batches_append_only BEFORE UPDATE OR DELETE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION close_desk_forbid_change();
CREATE TRIGGER review_decisions_append_only BEFORE UPDATE OR DELETE ON review_decisions
  FOR EACH ROW EXECUTE FUNCTION close_desk_forbid_change();
CREATE TRIGGER snapshots_append_only BEFORE UPDATE OR DELETE ON snapshots
  FOR EACH ROW EXECUTE FUNCTION close_desk_forbid_change();
CREATE TRIGGER snapshot_register_lines_append_only BEFORE UPDATE OR DELETE ON snapshot_register_lines
  FOR EACH ROW EXECUTE FUNCTION close_desk_forbid_change();
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION close_desk_forbid_change();
