-- Cloudflare D1 rejects LIKE and GLOB patterns longer than 50 bytes ("LIKE or
-- GLOB pattern too complex"), so the canonical-view checks in 0063 failed every
-- publish that cited a Data View in production while passing in local SQLite.
-- Supersedes the dc_articles_evidence_* triggers last defined in 0063, verbatim
-- except that each 'https://explore.developing-country.org/views/view_…' LIKE or
-- GLOB becomes a substr(…, 1, 50) comparison with the 50-byte prefix. The id after
-- the prefix is still checked by the existing substr(…, 51) clauses.
-- apps/site/src/figureEvidenceMigration.test.ts verifies the derivation.

DROP TRIGGER IF EXISTS dc_articles_evidence_insert;
CREATE TRIGGER dc_articles_evidence_insert
BEFORE INSERT ON ec_articles
WHEN NEW.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'dc_publication_evidence: invalid published Research Article')
  WHERE
  (
    typeof(NEW.country_code) <> 'text' OR trim(coalesce(NEW.country_code, '')) <> 'LK'
  )
  OR
  (
    typeof(NEW.research_question) <> 'text' OR length(trim(coalesce(NEW.research_question, ''))) < 12
  )
  OR
  (
    typeof(NEW.methodology) <> 'text' OR length(trim(coalesce(NEW.methodology, ''))) < 20
  )
  OR
  (
    coalesce(json_valid(NEW.evidence_bundle), 0) = 0
  )
  OR
  (
    coalesce(json_valid(NEW.source_manifest), 0) = 0
  )
  OR
  (
    coalesce(json_valid(NEW.content), 0) = 0
  )
  OR
  (
    coalesce(json_type(NEW.evidence_bundle, '$'), '') <> 'object'
        OR coalesce(json_type(NEW.source_manifest, '$'), '') <> 'array'
        OR coalesce(json_type(NEW.content, '$'), '') <> 'array'
        OR json_array_length(NEW.content) < 1
  )
  OR
  (
    coalesce(json_extract(NEW.evidence_bundle, '$.version'), -1) <> 1
        OR coalesce(json_extract(NEW.evidence_bundle, '$.country'), '') <> NEW.country_code
        OR coalesce(json_extract(NEW.evidence_bundle, '$.kind'), '') NOT IN ('platform-query', 'design-note', 'claim-review')
        OR coalesce(json_type(NEW.evidence_bundle, '$.generatedAt'), '') <> 'text'
        OR length(json_extract(NEW.evidence_bundle, '$.generatedAt')) NOT IN (20, 24)
        OR json_extract(NEW.evidence_bundle, '$.generatedAt') NOT GLOB '????-??-??T??:??:??*Z'
        OR coalesce(json_type(NEW.evidence_bundle, '$.datasetVersions'), '') <> 'array'
        OR coalesce(json_type(NEW.evidence_bundle, '$.dataViews'), '') <> 'array'
  )
  OR
  (
    json_array_length(NEW.source_manifest) < 1
  )
  OR
  (
    json_extract(NEW.evidence_bundle, '$.kind') = 'platform-query'
        AND json_array_length(NEW.evidence_bundle, '$.datasetVersions') < 1
  )
  OR
  (
    EXISTS (
      SELECT 1 FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version
      WHERE coalesce(json_type(version.value, '$.datasetId'), '') <> 'text'
         OR length(trim(coalesce(json_extract(version.value, '$.datasetId'), ''))) = 0
         OR coalesce(json_type(version.value, '$.versionId'), '') <> 'text'
         OR length(coalesce(json_extract(version.value, '$.versionId'), '')) <> 36
         OR substr(coalesce(json_extract(version.value, '$.versionId'), ''), 1, 4) <> 'dsv_'
         OR substr(coalesce(json_extract(version.value, '$.versionId'), ''), 5) GLOB '*[^0-9a-f]*'
         OR coalesce(json_type(version.value, '$.country'), '') <> 'text'
         OR coalesce(json_extract(version.value, '$.country'), '') <> NEW.country_code
         OR coalesce(json_type(version.value, '$.checksum'), '') <> 'text'
         OR length(coalesce(json_extract(version.value, '$.checksum'), '')) <> 71
         OR substr(coalesce(json_extract(version.value, '$.checksum'), ''), 1, 7) <> 'sha256:'
         OR substr(coalesce(json_extract(version.value, '$.checksum'), ''), 8) GLOB '*[^0-9a-f]*'
         OR coalesce(json_type(version.value, '$.vintage'), '') <> 'text'
         OR length(trim(coalesce(json_extract(version.value, '$.vintage'), ''))) = 0
         OR coalesce(json_type(version.value, '$.refreshedAt'), '') <> 'text'
         OR length(trim(coalesce(json_extract(version.value, '$.refreshedAt'), ''))) = 0
         OR coalesce(json_type(version.value, '$.sourceIds'), '') <> 'array'
         OR json_array_length(version.value, '$.sourceIds') < 1
    )
  )
  OR
  (
    EXISTS (
      SELECT 1
      FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version,
           json_each(version.value, '$.sourceIds') AS source_id
      WHERE source_id.type <> 'text' OR length(trim(source_id.value)) = 0
    )
  )
  OR
  (
    EXISTS (
      SELECT 1 FROM json_each(NEW.source_manifest) AS source
      WHERE coalesce(json_type(source.value, '$.title'), '') <> 'text'
         OR length(trim(coalesce(json_extract(source.value, '$.title'), ''))) = 0
         OR (
           json_type(source.value, '$.sourceId') IS NOT NULL
           AND json_type(source.value, '$.sourceId') <> 'text'
         )
         OR (
           coalesce(json_extract(source.value, '$.type'), '') <> 'platform-design'
           AND length(trim(coalesce(json_extract(source.value, '$.url'), ''))) = 0
         )
         OR (
           length(trim(coalesce(json_extract(source.value, '$.url'), ''))) > 0
           AND (
             coalesce(json_type(source.value, '$.url'), '') <> 'text'
             OR coalesce(json_extract(source.value, '$.url'), '') NOT LIKE 'https://_%'
             OR json_extract(source.value, '$.url') <> trim(json_extract(source.value, '$.url'))
             OR instr(json_extract(source.value, '$.url'), ' ') > 0
             OR instr(json_extract(source.value, '$.url'), char(9)) > 0
             OR instr(json_extract(source.value, '$.url'), char(10)) > 0
             OR instr(json_extract(source.value, '$.url'), char(13)) > 0
             OR instr(json_extract(source.value, '$.url'), '@') > 0
             OR (
               substr(coalesce(json_extract(source.value, '$.url'), ''), 9, 1) NOT GLOB '[A-Za-z0-9]'
               AND substr(coalesce(json_extract(source.value, '$.url'), ''), 9, 1) <> '['
             )
           )
         )
    )
  )
  OR
  (
    EXISTS (
      SELECT json_extract(source.value, '$.sourceId')
      FROM json_each(NEW.source_manifest) AS source
      WHERE length(trim(coalesce(json_extract(source.value, '$.sourceId'), ''))) > 0
      GROUP BY json_extract(source.value, '$.sourceId')
      HAVING count(*) > 1
    )
  )
  OR
  (
    EXISTS (
      SELECT 1
      FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version,
           json_each(version.value, '$.sourceIds') AS source_id
      WHERE NOT EXISTS (
        SELECT 1 FROM json_each(NEW.source_manifest) AS source
        WHERE json_extract(source.value, '$.sourceId') = source_id.value
          AND coalesce(json_extract(source.value, '$.url'), '') LIKE 'https://%'
      )
    )
  )
  OR
  (
    EXISTS (
      SELECT 1 FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
      WHERE coalesce(json_type(view.value, '$.queryId'), '') <> 'text'
         OR length(trim(coalesce(json_extract(view.value, '$.queryId'), ''))) = 0
         OR coalesce(json_type(view.value, '$.resultChecksum'), '') <> 'text'
         OR length(coalesce(json_extract(view.value, '$.resultChecksum'), '')) <> 71
         OR substr(coalesce(json_extract(view.value, '$.resultChecksum'), ''), 1, 7) <> 'sha256:'
         OR substr(coalesce(json_extract(view.value, '$.resultChecksum'), ''), 8) GLOB '*[^0-9a-f]*'
         OR coalesce(json_type(view.value, '$.viewUrl'), '') <> 'text'
         OR substr(coalesce(json_extract(view.value, '$.viewUrl'), ''), 1, 50) <> 'https://explore.developing-country.org/views/view_'
         OR length(substr(coalesce(json_extract(view.value, '$.viewUrl'), ''), 51)) = 0
         OR substr(coalesce(json_extract(view.value, '$.viewUrl'), ''), 51) GLOB '*[^a-z0-9]*'
    )
  )
  OR
  (
    length(trim(coalesce(NEW.primary_view_url, ''))) > 0 AND (
        substr(NEW.primary_view_url, 1, 50) <> 'https://explore.developing-country.org/views/view_'
        OR instr(NEW.primary_view_url, '?') > 0
        OR instr(NEW.primary_view_url, '#') > 0
        OR NOT EXISTS (
          SELECT 1 FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
          WHERE json_extract(view.value, '$.viewUrl') = NEW.primary_view_url
        )
      )
  )
  OR
  (
    EXISTS (
      SELECT 1 FROM json_each(NEW.content) AS block
      WHERE json_extract(block.value, '$._type') = 'dcLiveView'
        AND (
          substr(coalesce(
            json_extract(block.value, '$.view_url'),
            json_extract(block.value, '$.url'),
            json_extract(block.value, '$.id'),
            ''
          ), 1, 50) <> 'https://explore.developing-country.org/views/view_'
          OR NOT EXISTS (
            SELECT 1 FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
            WHERE json_extract(view.value, '$.viewUrl') = coalesce(
              json_extract(block.value, '$.view_url'),
              json_extract(block.value, '$.url'),
              json_extract(block.value, '$.id')
            )
          )
        )
    )
  )
  OR
  (
    EXISTS (
      SELECT 1 FROM json_each(NEW.content) AS block
      WHERE json_extract(block.value, '$._type') IN ('dcFigure', 'dcStat', 'dcGuess', 'dcExplorer')
        AND NOT EXISTS (
          SELECT 1 FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
          WHERE json_extract(view.value, '$.viewUrl') = json_extract(block.value, '$.view_url')
        )
    )
  )
  OR
  (
    EXISTS (
      SELECT 1 FROM json_each(NEW.content) AS block
      WHERE json_extract(block.value, '$._type') = 'dcScrolly'
        AND (
          coalesce(json_type(block.value, '$.steps'), '') <> 'array'
          OR json_array_length(block.value, '$.steps') < 1
        )
    )
  )
  OR
  (
    EXISTS (
      SELECT 1
      FROM json_each(NEW.content) AS block,
           json_each(block.value, '$.steps') AS step
      WHERE json_extract(block.value, '$._type') = 'dcScrolly'
        AND NOT EXISTS (
          SELECT 1 FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
          WHERE json_extract(view.value, '$.viewUrl') = json_extract(step.value, '$.view_url')
        )
    )
  );
END;

DROP TRIGGER IF EXISTS dc_articles_evidence_publish;
CREATE TRIGGER dc_articles_evidence_publish
BEFORE UPDATE OF
  format, analysis_kind, claim_status, claim_source_url, claim_source_title, claim_reported_at, missing_data,
  status,
  country_code,
  research_question,
  methodology,
  evidence_bundle,
  source_manifest,
  primary_view_url,
  content
ON ec_articles
WHEN NEW.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'dc_publication_evidence: invalid published Research Article')
  WHERE
  (
    typeof(NEW.country_code) <> 'text' OR trim(coalesce(NEW.country_code, '')) <> 'LK'
  )
  OR
  (
    typeof(NEW.research_question) <> 'text' OR length(trim(coalesce(NEW.research_question, ''))) < 12
  )
  OR
  (
    typeof(NEW.methodology) <> 'text' OR length(trim(coalesce(NEW.methodology, ''))) < 20
  )
  OR
  (
    coalesce(json_valid(NEW.evidence_bundle), 0) = 0
  )
  OR
  (
    coalesce(json_valid(NEW.source_manifest), 0) = 0
  )
  OR
  (
    coalesce(json_valid(NEW.content), 0) = 0
  )
  OR
  (
    coalesce(json_type(NEW.evidence_bundle, '$'), '') <> 'object'
        OR coalesce(json_type(NEW.source_manifest, '$'), '') <> 'array'
        OR coalesce(json_type(NEW.content, '$'), '') <> 'array'
        OR json_array_length(NEW.content) < 1
  )
  OR
  (
    coalesce(json_extract(NEW.evidence_bundle, '$.version'), -1) <> 1
        OR coalesce(json_extract(NEW.evidence_bundle, '$.country'), '') <> NEW.country_code
        OR coalesce(json_extract(NEW.evidence_bundle, '$.kind'), '') NOT IN ('platform-query', 'design-note', 'claim-review')
        OR coalesce(json_type(NEW.evidence_bundle, '$.generatedAt'), '') <> 'text'
        OR length(json_extract(NEW.evidence_bundle, '$.generatedAt')) NOT IN (20, 24)
        OR json_extract(NEW.evidence_bundle, '$.generatedAt') NOT GLOB '????-??-??T??:??:??*Z'
        OR coalesce(json_type(NEW.evidence_bundle, '$.datasetVersions'), '') <> 'array'
        OR coalesce(json_type(NEW.evidence_bundle, '$.dataViews'), '') <> 'array'
  )
  OR
  (
    json_array_length(NEW.source_manifest) < 1
  )
  OR
  (
    json_extract(NEW.evidence_bundle, '$.kind') = 'platform-query'
        AND json_array_length(NEW.evidence_bundle, '$.datasetVersions') < 1
  )
  OR
  (
    EXISTS (
      SELECT 1 FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version
      WHERE coalesce(json_type(version.value, '$.datasetId'), '') <> 'text'
         OR length(trim(coalesce(json_extract(version.value, '$.datasetId'), ''))) = 0
         OR coalesce(json_type(version.value, '$.versionId'), '') <> 'text'
         OR length(coalesce(json_extract(version.value, '$.versionId'), '')) <> 36
         OR substr(coalesce(json_extract(version.value, '$.versionId'), ''), 1, 4) <> 'dsv_'
         OR substr(coalesce(json_extract(version.value, '$.versionId'), ''), 5) GLOB '*[^0-9a-f]*'
         OR coalesce(json_type(version.value, '$.country'), '') <> 'text'
         OR coalesce(json_extract(version.value, '$.country'), '') <> NEW.country_code
         OR coalesce(json_type(version.value, '$.checksum'), '') <> 'text'
         OR length(coalesce(json_extract(version.value, '$.checksum'), '')) <> 71
         OR substr(coalesce(json_extract(version.value, '$.checksum'), ''), 1, 7) <> 'sha256:'
         OR substr(coalesce(json_extract(version.value, '$.checksum'), ''), 8) GLOB '*[^0-9a-f]*'
         OR coalesce(json_type(version.value, '$.vintage'), '') <> 'text'
         OR length(trim(coalesce(json_extract(version.value, '$.vintage'), ''))) = 0
         OR coalesce(json_type(version.value, '$.refreshedAt'), '') <> 'text'
         OR length(trim(coalesce(json_extract(version.value, '$.refreshedAt'), ''))) = 0
         OR coalesce(json_type(version.value, '$.sourceIds'), '') <> 'array'
         OR json_array_length(version.value, '$.sourceIds') < 1
    )
  )
  OR
  (
    EXISTS (
      SELECT 1
      FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version,
           json_each(version.value, '$.sourceIds') AS source_id
      WHERE source_id.type <> 'text' OR length(trim(source_id.value)) = 0
    )
  )
  OR
  (
    EXISTS (
      SELECT 1 FROM json_each(NEW.source_manifest) AS source
      WHERE coalesce(json_type(source.value, '$.title'), '') <> 'text'
         OR length(trim(coalesce(json_extract(source.value, '$.title'), ''))) = 0
         OR (
           json_type(source.value, '$.sourceId') IS NOT NULL
           AND json_type(source.value, '$.sourceId') <> 'text'
         )
         OR (
           coalesce(json_extract(source.value, '$.type'), '') <> 'platform-design'
           AND length(trim(coalesce(json_extract(source.value, '$.url'), ''))) = 0
         )
         OR (
           length(trim(coalesce(json_extract(source.value, '$.url'), ''))) > 0
           AND (
             coalesce(json_type(source.value, '$.url'), '') <> 'text'
             OR coalesce(json_extract(source.value, '$.url'), '') NOT LIKE 'https://_%'
             OR json_extract(source.value, '$.url') <> trim(json_extract(source.value, '$.url'))
             OR instr(json_extract(source.value, '$.url'), ' ') > 0
             OR instr(json_extract(source.value, '$.url'), char(9)) > 0
             OR instr(json_extract(source.value, '$.url'), char(10)) > 0
             OR instr(json_extract(source.value, '$.url'), char(13)) > 0
             OR instr(json_extract(source.value, '$.url'), '@') > 0
             OR (
               substr(coalesce(json_extract(source.value, '$.url'), ''), 9, 1) NOT GLOB '[A-Za-z0-9]'
               AND substr(coalesce(json_extract(source.value, '$.url'), ''), 9, 1) <> '['
             )
           )
         )
    )
  )
  OR
  (
    EXISTS (
      SELECT json_extract(source.value, '$.sourceId')
      FROM json_each(NEW.source_manifest) AS source
      WHERE length(trim(coalesce(json_extract(source.value, '$.sourceId'), ''))) > 0
      GROUP BY json_extract(source.value, '$.sourceId')
      HAVING count(*) > 1
    )
  )
  OR
  (
    EXISTS (
      SELECT 1
      FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version,
           json_each(version.value, '$.sourceIds') AS source_id
      WHERE NOT EXISTS (
        SELECT 1 FROM json_each(NEW.source_manifest) AS source
        WHERE json_extract(source.value, '$.sourceId') = source_id.value
          AND coalesce(json_extract(source.value, '$.url'), '') LIKE 'https://%'
      )
    )
  )
  OR
  (
    EXISTS (
      SELECT 1 FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
      WHERE coalesce(json_type(view.value, '$.queryId'), '') <> 'text'
         OR length(trim(coalesce(json_extract(view.value, '$.queryId'), ''))) = 0
         OR coalesce(json_type(view.value, '$.resultChecksum'), '') <> 'text'
         OR length(coalesce(json_extract(view.value, '$.resultChecksum'), '')) <> 71
         OR substr(coalesce(json_extract(view.value, '$.resultChecksum'), ''), 1, 7) <> 'sha256:'
         OR substr(coalesce(json_extract(view.value, '$.resultChecksum'), ''), 8) GLOB '*[^0-9a-f]*'
         OR coalesce(json_type(view.value, '$.viewUrl'), '') <> 'text'
         OR substr(coalesce(json_extract(view.value, '$.viewUrl'), ''), 1, 50) <> 'https://explore.developing-country.org/views/view_'
         OR length(substr(coalesce(json_extract(view.value, '$.viewUrl'), ''), 51)) = 0
         OR substr(coalesce(json_extract(view.value, '$.viewUrl'), ''), 51) GLOB '*[^a-z0-9]*'
    )
  )
  OR
  (
    length(trim(coalesce(NEW.primary_view_url, ''))) > 0 AND (
        substr(NEW.primary_view_url, 1, 50) <> 'https://explore.developing-country.org/views/view_'
        OR instr(NEW.primary_view_url, '?') > 0
        OR instr(NEW.primary_view_url, '#') > 0
        OR NOT EXISTS (
          SELECT 1 FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
          WHERE json_extract(view.value, '$.viewUrl') = NEW.primary_view_url
        )
      )
  )
  OR
  (
    EXISTS (
      SELECT 1 FROM json_each(NEW.content) AS block
      WHERE json_extract(block.value, '$._type') = 'dcLiveView'
        AND (
          substr(coalesce(
            json_extract(block.value, '$.view_url'),
            json_extract(block.value, '$.url'),
            json_extract(block.value, '$.id'),
            ''
          ), 1, 50) <> 'https://explore.developing-country.org/views/view_'
          OR NOT EXISTS (
            SELECT 1 FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
            WHERE json_extract(view.value, '$.viewUrl') = coalesce(
              json_extract(block.value, '$.view_url'),
              json_extract(block.value, '$.url'),
              json_extract(block.value, '$.id')
            )
          )
        )
    )
  )
  OR
  (
    EXISTS (
      SELECT 1 FROM json_each(NEW.content) AS block
      WHERE json_extract(block.value, '$._type') IN ('dcFigure', 'dcStat', 'dcGuess', 'dcExplorer')
        AND NOT EXISTS (
          SELECT 1 FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
          WHERE json_extract(view.value, '$.viewUrl') = json_extract(block.value, '$.view_url')
        )
    )
  )
  OR
  (
    EXISTS (
      SELECT 1 FROM json_each(NEW.content) AS block
      WHERE json_extract(block.value, '$._type') = 'dcScrolly'
        AND (
          coalesce(json_type(block.value, '$.steps'), '') <> 'array'
          OR json_array_length(block.value, '$.steps') < 1
        )
    )
  )
  OR
  (
    EXISTS (
      SELECT 1
      FROM json_each(NEW.content) AS block,
           json_each(block.value, '$.steps') AS step
      WHERE json_extract(block.value, '$._type') = 'dcScrolly'
        AND NOT EXISTS (
          SELECT 1 FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
          WHERE json_extract(view.value, '$.viewUrl') = json_extract(step.value, '$.view_url')
        )
    )
  );
END;
