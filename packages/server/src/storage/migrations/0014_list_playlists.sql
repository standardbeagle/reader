-- Lists double as playlists. A manual list keeps its articles in a set order;
-- a dynamic list stores a rule instead of members and is resolved on read.
ALTER TABLE lists ADD COLUMN rule TEXT;

ALTER TABLE list_items ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

-- Existing lists play in the order their articles were saved.
UPDATE list_items SET position = (
  SELECT COUNT(*) FROM list_items o
  WHERE o.list_id = list_items.list_id
    AND (o.added_at < list_items.added_at
         OR (o.added_at = list_items.added_at AND o.rowid < list_items.rowid))
);

CREATE INDEX idx_list_items_position ON list_items(list_id, position);
