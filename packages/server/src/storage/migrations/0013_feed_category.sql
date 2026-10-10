-- A feed's category is the user's own grouping (a folder); OPML imports fill
-- it from the folder each feed sat in.
ALTER TABLE feeds ADD COLUMN category TEXT;

-- A feed's kind (podcast, video) is derived from whether it carries playable
-- media, on every feed listing. Without this index that check walks all of a
-- media-less feed's articles.
CREATE INDEX idx_articles_feed_media ON articles(feed_id, media_type) WHERE media_url IS NOT NULL;
