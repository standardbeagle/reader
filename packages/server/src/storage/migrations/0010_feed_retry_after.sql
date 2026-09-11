-- A 429/503 Retry-After from the publisher: the poller leaves the feed alone
-- until this time. Manual refreshes still go through.
ALTER TABLE feeds ADD COLUMN retry_after TEXT;
