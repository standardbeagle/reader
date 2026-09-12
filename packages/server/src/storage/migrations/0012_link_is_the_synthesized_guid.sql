-- Articles from feeds that publish no <guid> got an identity hashed from the
-- item's url, title and publish date. Publishers rewrite the last two:
-- science.org re-stamps pubDate by 10-60 seconds and copy-edits titles between
-- polls, so the same article hashed differently on the next read and landed as
-- a second row, dated seconds after the first.
--
-- The parser now uses the link itself. This collapses the copies already
-- stored and re-stamps the survivors with that identity, so the next poll
-- updates them instead of inserting a third copy.
--
-- Items with no link at all keep the old hash; the parser still produces it
-- unchanged for them.

-- Survivor per (feed, url): the copy that arrived first. fetched_at is
-- ISO-8601, so it sorts lexicographically; id breaks a same-millisecond tie.
CREATE TEMP TABLE guid_merge AS
SELECT dup.id AS loser_id, keep.id AS keep_id
FROM articles dup
JOIN (
  SELECT feed_id, url, MIN(fetched_at || '|' || id) AS first_seen
  FROM articles
  WHERE guid LIKE 'sha1:%' AND url IS NOT NULL
  GROUP BY feed_id, url
) grp ON grp.feed_id = dup.feed_id AND grp.url = dup.url
JOIN articles keep
  ON keep.feed_id = grp.feed_id
 AND keep.url = grp.url
 AND (keep.fetched_at || '|' || keep.id) = grp.first_seen
WHERE dup.guid LIKE 'sha1:%' AND dup.url IS NOT NULL AND dup.id <> keep.id;

-- Read, star and snooze state folds onto the survivor. Earliest read or star
-- wins, since that is when the article was actually read; the furthest-out
-- snooze wins, so a merge never resurfaces something the user pushed away.
INSERT INTO user_articles (user_id, article_id, read_at, starred_at, snoozed_until)
SELECT loser.user_id, m.keep_id,
       MIN(loser.read_at), MIN(loser.starred_at), MAX(loser.snoozed_until)
FROM user_articles loser
JOIN guid_merge m ON m.loser_id = loser.article_id
GROUP BY m.keep_id, loser.user_id
ON CONFLICT (user_id, article_id) DO UPDATE SET
  read_at = COALESCE(user_articles.read_at, excluded.read_at),
  starred_at = COALESCE(user_articles.starred_at, excluded.starred_at),
  snoozed_until = COALESCE(
    MAX(user_articles.snoozed_until, excluded.snoozed_until),
    user_articles.snoozed_until, excluded.snoozed_until);

INSERT OR IGNORE INTO list_items (list_id, article_id, added_at)
SELECT loser.list_id, m.keep_id, loser.added_at
FROM list_items loser
JOIN guid_merge m ON m.loser_id = loser.article_id;

-- Migrations run with foreign_keys OFF, so ON DELETE CASCADE will not fire.
DELETE FROM user_articles WHERE article_id IN (SELECT loser_id FROM guid_merge);
DELETE FROM list_items    WHERE article_id IN (SELECT loser_id FROM guid_merge);
DELETE FROM articles      WHERE id         IN (SELECT loser_id FROM guid_merge);

-- Re-stamp the survivors with the identity the parser now produces. The guard
-- covers a feed that carries both a guid-less and an explicitly identified
-- item at one link.
UPDATE articles SET guid = url
WHERE guid LIKE 'sha1:%' AND url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM articles other
    WHERE other.feed_id = articles.feed_id
      AND other.id <> articles.id
      AND other.guid = articles.url);

DROP TABLE guid_merge;
