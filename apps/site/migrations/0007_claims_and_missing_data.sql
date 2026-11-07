-- Claim and missing-data fields are reconciled by the migration preflight.
-- Preserve the existing evidence gate, adding a narrowly scoped source-review kind.
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
         OR coalesce(json_extract(view.value, '$.viewUrl'), '') NOT GLOB 'https://explore.developing-country.org/views/view_[a-z0-9]*'
         OR length(substr(coalesce(json_extract(view.value, '$.viewUrl'), ''), 51)) = 0
         OR substr(coalesce(json_extract(view.value, '$.viewUrl'), ''), 51) GLOB '*[^a-z0-9]*'
    )
  )
  OR
  (
    length(trim(coalesce(NEW.primary_view_url, ''))) > 0 AND (
        NEW.primary_view_url NOT LIKE 'https://explore.developing-country.org/views/view_%'
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
          coalesce(
            json_extract(block.value, '$.view_url'),
            json_extract(block.value, '$.url'),
            json_extract(block.value, '$.id'),
            ''
          ) NOT LIKE 'https://explore.developing-country.org/views/view_%'
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
    length(trim(coalesce(NEW.primary_view_url, ''))) > 0 AND EXISTS (
      SELECT 1 FROM json_each(NEW.content) AS block
      WHERE json_extract(block.value, '$._type') = 'dcLiveView'
        AND coalesce(
          json_extract(block.value, '$.view_url'),
          json_extract(block.value, '$.url'),
          json_extract(block.value, '$.id')
        ) = NEW.primary_view_url
    )
  )
  OR
  (
    EXISTS (
      SELECT 1
      FROM json_each(NEW.content) AS first_block,
           json_each(NEW.content) AS second_block
      WHERE first_block.key < second_block.key
        AND json_extract(first_block.value, '$._type') = 'dcLiveView'
        AND json_extract(second_block.value, '$._type') = 'dcLiveView'
        AND coalesce(
          json_extract(first_block.value, '$.view_url'),
          json_extract(first_block.value, '$.url'),
          json_extract(first_block.value, '$.id')
        ) = coalesce(
          json_extract(second_block.value, '$.view_url'),
          json_extract(second_block.value, '$.url'),
          json_extract(second_block.value, '$.id')
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
         OR coalesce(json_extract(view.value, '$.viewUrl'), '') NOT GLOB 'https://explore.developing-country.org/views/view_[a-z0-9]*'
         OR length(substr(coalesce(json_extract(view.value, '$.viewUrl'), ''), 51)) = 0
         OR substr(coalesce(json_extract(view.value, '$.viewUrl'), ''), 51) GLOB '*[^a-z0-9]*'
    )
  )
  OR
  (
    length(trim(coalesce(NEW.primary_view_url, ''))) > 0 AND (
        NEW.primary_view_url NOT LIKE 'https://explore.developing-country.org/views/view_%'
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
          coalesce(
            json_extract(block.value, '$.view_url'),
            json_extract(block.value, '$.url'),
            json_extract(block.value, '$.id'),
            ''
          ) NOT LIKE 'https://explore.developing-country.org/views/view_%'
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
    length(trim(coalesce(NEW.primary_view_url, ''))) > 0 AND EXISTS (
      SELECT 1 FROM json_each(NEW.content) AS block
      WHERE json_extract(block.value, '$._type') = 'dcLiveView'
        AND coalesce(
          json_extract(block.value, '$.view_url'),
          json_extract(block.value, '$.url'),
          json_extract(block.value, '$.id')
        ) = NEW.primary_view_url
    )
  )
  OR
  (
    EXISTS (
      SELECT 1
      FROM json_each(NEW.content) AS first_block,
           json_each(NEW.content) AS second_block
      WHERE first_block.key < second_block.key
        AND json_extract(first_block.value, '$._type') = 'dcLiveView'
        AND json_extract(second_block.value, '$._type') = 'dcLiveView'
        AND coalesce(
          json_extract(first_block.value, '$.view_url'),
          json_extract(first_block.value, '$.url'),
          json_extract(first_block.value, '$.id')
        ) = coalesce(
          json_extract(second_block.value, '$.view_url'),
          json_extract(second_block.value, '$.url'),
          json_extract(second_block.value, '$.id')
        )
    )
  );
END;

-- A source review establishes a report, never an independently verified statistic.

CREATE TRIGGER dc_claims_insert BEFORE INSERT ON ec_articles WHEN NEW.status = 'published' BEGIN
 SELECT RAISE(ABORT, 'dc_claims: incomplete claim or unresolved data-gap reference') WHERE 
    (NEW.analysis_kind IS NOT NULL AND NEW.analysis_kind NOT IN ('essay', 'tracked_claim'))
    OR (json_extract(NEW.evidence_bundle, '$.kind') = 'claim-review' AND (
      NEW.analysis_kind IS NOT 'tracked_claim' OR NEW.claim_status IS NOT 'awaiting_data'
    ))
    OR (NEW.analysis_kind = 'tracked_claim' AND (
      NEW.format IS NOT 'analysis'
      OR coalesce(NEW.claim_status, '') NOT IN ('awaiting_data', 'supported', 'contradicted', 'mixed')
      OR coalesce(NEW.claim_source_url, '') NOT GLOB 'https://?*'
      OR NEW.claim_source_url GLOB '*[ 
	@]*'
      OR length(trim(coalesce(NEW.claim_source_title, ''))) = 0
      OR coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', NEW.claim_reported_at), '') <> NEW.claim_reported_at
      OR NOT EXISTS (SELECT 1 FROM json_each(NEW.source_manifest) WHERE json_extract(value, '$.url') = NEW.claim_source_url)
      OR json_extract(NEW.evidence_bundle, '$.kind') NOT IN ('claim-review', 'platform-query')
      OR coalesce(json_valid(NEW.missing_data), 0) = 0
      OR coalesce(json_type(NEW.missing_data), '') <> 'array'
      OR (NEW.claim_status = 'awaiting_data' AND json_array_length(NEW.missing_data) = 0)
      OR EXISTS (SELECT 1 FROM json_each(NEW.missing_data) AS ref WHERE ref.type <> 'text' OR ref.value <> trim(ref.value)
        OR NOT EXISTS (SELECT 1 FROM ec_data_gaps AS gap WHERE gap.id = ref.value AND gap.deleted_at IS NULL AND gap.status = 'published' AND gap.country_code = NEW.country_code))
      OR EXISTS (SELECT value FROM json_each(NEW.missing_data) GROUP BY value HAVING count(*) > 1)
    ))
;
END;

CREATE TRIGGER dc_claims_update BEFORE UPDATE OF status, format, analysis_kind, claim_status, claim_source_url, claim_source_title, claim_reported_at, missing_data, evidence_bundle, source_manifest, country_code ON ec_articles WHEN NEW.status = 'published' BEGIN
 SELECT RAISE(ABORT, 'dc_claims: incomplete claim or unresolved data-gap reference') WHERE 
    (NEW.analysis_kind IS NOT NULL AND NEW.analysis_kind NOT IN ('essay', 'tracked_claim'))
    OR (json_extract(NEW.evidence_bundle, '$.kind') = 'claim-review' AND (
      NEW.analysis_kind IS NOT 'tracked_claim' OR NEW.claim_status IS NOT 'awaiting_data'
    ))
    OR (NEW.analysis_kind = 'tracked_claim' AND (
      NEW.format IS NOT 'analysis'
      OR coalesce(NEW.claim_status, '') NOT IN ('awaiting_data', 'supported', 'contradicted', 'mixed')
      OR coalesce(NEW.claim_source_url, '') NOT GLOB 'https://?*'
      OR NEW.claim_source_url GLOB '*[ 
	@]*'
      OR length(trim(coalesce(NEW.claim_source_title, ''))) = 0
      OR coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', NEW.claim_reported_at), '') <> NEW.claim_reported_at
      OR NOT EXISTS (SELECT 1 FROM json_each(NEW.source_manifest) WHERE json_extract(value, '$.url') = NEW.claim_source_url)
      OR json_extract(NEW.evidence_bundle, '$.kind') NOT IN ('claim-review', 'platform-query')
      OR coalesce(json_valid(NEW.missing_data), 0) = 0
      OR coalesce(json_type(NEW.missing_data), '') <> 'array'
      OR (NEW.claim_status = 'awaiting_data' AND json_array_length(NEW.missing_data) = 0)
      OR EXISTS (SELECT 1 FROM json_each(NEW.missing_data) AS ref WHERE ref.type <> 'text' OR ref.value <> trim(ref.value)
        OR NOT EXISTS (SELECT 1 FROM ec_data_gaps AS gap WHERE gap.id = ref.value AND gap.deleted_at IS NULL AND gap.status = 'published' AND gap.country_code = NEW.country_code))
      OR EXISTS (SELECT value FROM json_each(NEW.missing_data) GROUP BY value HAVING count(*) > 1)
    ))
;
END;

CREATE TRIGGER dc_data_gaps_insert BEFORE INSERT ON ec_data_gaps WHEN NEW.status = 'published' BEGIN
 SELECT RAISE(ABORT, 'dc_data_gaps: incomplete published data gap') WHERE length(trim(coalesce(NEW.title, ''))) = 0 OR length(trim(coalesce(NEW.summary, ''))) = 0 OR length(trim(coalesce(NEW.country_code, ''))) = 0 OR length(trim(coalesce(NEW.publisher_id, ''))) = 0 OR length(trim(coalesce(NEW.publisher_name, ''))) = 0 OR length(trim(coalesce(NEW.needed_fields, ''))) = 0 OR length(trim(coalesce(NEW.available_evidence, ''))) = 0 OR length(trim(coalesce(NEW.next_steps, ''))) = 0 OR length(trim(coalesce(NEW.checked_at, ''))) = 0
 OR NEW.country_code <> 'LK'
 OR NEW.publisher_type NOT IN ('government', 'international', 'community', 'platform', 'other') OR NEW.publisher_type IS NULL
 OR NEW.availability NOT IN ('not_public', 'partial', 'requested', 'available') OR NEW.availability IS NULL
 OR coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', NEW.checked_at), '') <> NEW.checked_at
 OR coalesce(json_valid(NEW.theme_ids), 0) = 0 OR coalesce(json_type(NEW.theme_ids), '') <> 'array' OR json_array_length(NEW.theme_ids) = 0
 OR EXISTS (SELECT 1 FROM json_each(NEW.theme_ids) WHERE type <> 'text' OR value NOT IN ('AGRI','ECON','EDUC','ENER','ENVI','GOVE','HEAL','INTR','JUST','REGI','SOCI','TECH','TRAN'))
 OR coalesce(json_valid(NEW.source_manifest), 0) = 0 OR coalesce(json_type(NEW.source_manifest), '') <> 'array' OR json_array_length(NEW.source_manifest) = 0
 OR EXISTS (SELECT 1 FROM json_each(NEW.source_manifest) WHERE length(trim(coalesce(json_extract(value, '$.title'), ''))) = 0 OR coalesce(json_extract(value, '$.url'), '') NOT GLOB 'https://?*' OR json_extract(value, '$.url') GLOB '*[ 
	@]*')
;
END;

CREATE TRIGGER dc_data_gaps_update BEFORE UPDATE OF status, title, summary, country_code, publisher_id, publisher_name, needed_fields, available_evidence, next_steps, checked_at, publisher_type, availability, theme_ids, source_manifest ON ec_data_gaps WHEN NEW.status = 'published' BEGIN
 SELECT RAISE(ABORT, 'dc_data_gaps: incomplete published data gap') WHERE length(trim(coalesce(NEW.title, ''))) = 0 OR length(trim(coalesce(NEW.summary, ''))) = 0 OR length(trim(coalesce(NEW.country_code, ''))) = 0 OR length(trim(coalesce(NEW.publisher_id, ''))) = 0 OR length(trim(coalesce(NEW.publisher_name, ''))) = 0 OR length(trim(coalesce(NEW.needed_fields, ''))) = 0 OR length(trim(coalesce(NEW.available_evidence, ''))) = 0 OR length(trim(coalesce(NEW.next_steps, ''))) = 0 OR length(trim(coalesce(NEW.checked_at, ''))) = 0
 OR NEW.country_code <> 'LK'
 OR NEW.publisher_type NOT IN ('government', 'international', 'community', 'platform', 'other') OR NEW.publisher_type IS NULL
 OR NEW.availability NOT IN ('not_public', 'partial', 'requested', 'available') OR NEW.availability IS NULL
 OR coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', NEW.checked_at), '') <> NEW.checked_at
 OR coalesce(json_valid(NEW.theme_ids), 0) = 0 OR coalesce(json_type(NEW.theme_ids), '') <> 'array' OR json_array_length(NEW.theme_ids) = 0
 OR EXISTS (SELECT 1 FROM json_each(NEW.theme_ids) WHERE type <> 'text' OR value NOT IN ('AGRI','ECON','EDUC','ENER','ENVI','GOVE','HEAL','INTR','JUST','REGI','SOCI','TECH','TRAN'))
 OR coalesce(json_valid(NEW.source_manifest), 0) = 0 OR coalesce(json_type(NEW.source_manifest), '') <> 'array' OR json_array_length(NEW.source_manifest) = 0
 OR EXISTS (SELECT 1 FROM json_each(NEW.source_manifest) WHERE length(trim(coalesce(json_extract(value, '$.title'), ''))) = 0 OR coalesce(json_extract(value, '$.url'), '') NOT GLOB 'https://?*' OR json_extract(value, '$.url') GLOB '*[ 
	@]*')
;
END;

-- Update active CMS links, preserving revision history. Legacy links also 301.
UPDATE _emdash_menu_items SET custom_url = '/analysis' || substr(custom_url, 10)
WHERE custom_url = '/research' OR custom_url LIKE '/research/%' OR custom_url LIKE '/research?%';
UPDATE ec_pages SET content = replace(content, '"/research', '"/analysis') WHERE content LIKE '%"/research%';
