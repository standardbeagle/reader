-- Playable media and Podcasting 2.0 extras per article.
ALTER TABLE articles ADD COLUMN media_url TEXT;
ALTER TABLE articles ADD COLUMN media_type TEXT;
ALTER TABLE articles ADD COLUMN transcript_url TEXT;
ALTER TABLE articles ADD COLUMN transcript_type TEXT;
ALTER TABLE articles ADD COLUMN chapters_url TEXT;

-- The parser used to take any enclosure as the article image, so podcast
-- episodes stored their audio as image_url. Move those to media_url.
UPDATE articles
SET media_url = image_url, image_url = NULL
WHERE lower(image_url) GLOB '*.mp3*' OR lower(image_url) GLOB '*.m4a*'
   OR lower(image_url) GLOB '*.aac*' OR lower(image_url) GLOB '*.ogg*'
   OR lower(image_url) GLOB '*.opus*' OR lower(image_url) GLOB '*.wav*'
   OR lower(image_url) GLOB '*.mp4*' OR lower(image_url) GLOB '*.m4v*';
