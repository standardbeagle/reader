-- Reddit ingestors sign in through a connected OAuth account now. Drop the
-- inline client secrets and passwords rather than keep dead secrets at rest;
-- affected ingestors fetch anonymously until an account is connected.
UPDATE ingestors
SET config = json_remove(config, '$.clientId', '$.clientSecret', '$.username', '$.password')
WHERE kind = 'reddit';
