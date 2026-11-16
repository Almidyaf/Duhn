CREATE TABLE notifications (
 id text PRIMARY KEY,
 title text NOT NULL,
 body text NOT NULL,
 href text NOT NULL,
 severity text NOT NULL CHECK(severity IN ('info','warning','danger')),
 occurred_at timestamptz NOT NULL
);
CREATE INDEX notifications_page_idx ON notifications(occurred_at DESC,id DESC);
CREATE TABLE notification_reads (
 user_id text NOT NULL REFERENCES "user"(id),
 notification_id text NOT NULL REFERENCES notifications(id),
 read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,notification_id)
);
