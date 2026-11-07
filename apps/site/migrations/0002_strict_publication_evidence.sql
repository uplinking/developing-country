-- Tighten the append-only Research Article publication invariant introduced in
-- 0001. Keep drafts remediable, while requiring canonical raw identifiers,
-- real calendar values, and unambiguous evidence tuples at publication time.

DROP TRIGGER IF EXISTS dc_articles_evidence_strict_insert;
CREATE TRIGGER dc_articles_evidence_strict_insert
BEFORE INSERT ON ec_articles
WHEN NEW.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'dc_publication_evidence: invalid published Research Article')
  WHERE
  typeof(NEW.country_code) <> 'text'
  OR NEW.country_code <> 'LK'
  OR coalesce((
    (
      length(json_extract(NEW.evidence_bundle, '$.generatedAt')) = 20
      AND strftime(
        '%Y-%m-%dT%H:%M:%SZ',
        json_extract(NEW.evidence_bundle, '$.generatedAt')
      ) = json_extract(NEW.evidence_bundle, '$.generatedAt')
    )
    OR
    (
      length(json_extract(NEW.evidence_bundle, '$.generatedAt')) = 24
      AND strftime(
        '%Y-%m-%dT%H:%M:%fZ',
        json_extract(NEW.evidence_bundle, '$.generatedAt')
      ) = json_extract(NEW.evidence_bundle, '$.generatedAt')
    )
  ), 0) = 0
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version
    WHERE json_extract(version.value, '$.datasetId') <> trim(json_extract(version.value, '$.datasetId'))
       OR json_extract(version.value, '$.versionId') <> trim(json_extract(version.value, '$.versionId'))
       OR json_extract(version.value, '$.checksum') <> trim(json_extract(version.value, '$.checksum'))
       OR coalesce((
         (
           length(json_extract(version.value, '$.refreshedAt')) = 4
           AND json_extract(version.value, '$.refreshedAt') GLOB '[0-9][0-9][0-9][0-9]'
           AND json_extract(version.value, '$.refreshedAt') <> '0000'
         )
         OR
         (
           length(json_extract(version.value, '$.refreshedAt')) = 7
           AND json_extract(version.value, '$.refreshedAt') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
           AND substr(json_extract(version.value, '$.refreshedAt'), 1, 4) <> '0000'
           AND strftime(
             '%Y-%m',
             json_extract(version.value, '$.refreshedAt') || '-01T00:00:00Z'
           ) = json_extract(version.value, '$.refreshedAt')
         )
         OR
         (
           length(json_extract(version.value, '$.refreshedAt')) = 10
           AND json_extract(version.value, '$.refreshedAt') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
           AND substr(json_extract(version.value, '$.refreshedAt'), 1, 4) <> '0000'
           AND strftime(
             '%Y-%m-%d',
             json_extract(version.value, '$.refreshedAt') || 'T00:00:00Z'
           ) = json_extract(version.value, '$.refreshedAt')
         )
         OR
         (
           length(json_extract(version.value, '$.refreshedAt')) = 20
           AND strftime(
             '%Y-%m-%dT%H:%M:%SZ',
             json_extract(version.value, '$.refreshedAt')
           ) = json_extract(version.value, '$.refreshedAt')
         )
         OR
         (
           length(json_extract(version.value, '$.refreshedAt')) = 24
           AND strftime(
             '%Y-%m-%dT%H:%M:%fZ',
             json_extract(version.value, '$.refreshedAt')
           ) = json_extract(version.value, '$.refreshedAt')
         )
       ), 0) = 0
  )
  OR EXISTS (
    SELECT json_extract(version.value, '$.datasetId')
    FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version
    GROUP BY json_extract(version.value, '$.datasetId')
    HAVING count(*) > 1
  )
  OR EXISTS (
    SELECT json_extract(version.value, '$.versionId')
    FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version
    GROUP BY json_extract(version.value, '$.versionId')
    HAVING count(*) > 1
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version,
         json_each(version.value, '$.sourceIds') AS source_id
    WHERE source_id.type <> 'text'
       OR source_id.value <> trim(source_id.value)
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version
    WHERE EXISTS (
      SELECT source_id.value
      FROM json_each(version.value, '$.sourceIds') AS source_id
      GROUP BY source_id.value
      HAVING count(*) > 1
    )
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.source_manifest) AS source
    WHERE json_type(source.value, '$.sourceId') IS NOT NULL
      AND (
        json_type(source.value, '$.sourceId') <> 'text'
        OR length(json_extract(source.value, '$.sourceId')) = 0
        OR json_extract(source.value, '$.sourceId') <> trim(json_extract(source.value, '$.sourceId'))
      )
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
    WHERE json_extract(view.value, '$.viewUrl') <> trim(json_extract(view.value, '$.viewUrl'))
       OR json_extract(view.value, '$.queryId') <> trim(json_extract(view.value, '$.queryId'))
       OR json_extract(view.value, '$.resultChecksum') <> trim(json_extract(view.value, '$.resultChecksum'))
  )
  OR EXISTS (
    SELECT json_extract(view.value, '$.viewUrl')
    FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
    GROUP BY json_extract(view.value, '$.viewUrl')
    HAVING count(*) > 1
  )
  OR (
    NEW.primary_view_url IS NOT NULL
    AND (
      typeof(NEW.primary_view_url) <> 'text'
      OR NEW.primary_view_url <> trim(NEW.primary_view_url)
    )
  );
END;

DROP TRIGGER IF EXISTS dc_articles_evidence_strict_publish;
CREATE TRIGGER dc_articles_evidence_strict_publish
BEFORE UPDATE OF
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
  typeof(NEW.country_code) <> 'text'
  OR NEW.country_code <> 'LK'
  OR coalesce((
    (
      length(json_extract(NEW.evidence_bundle, '$.generatedAt')) = 20
      AND strftime(
        '%Y-%m-%dT%H:%M:%SZ',
        json_extract(NEW.evidence_bundle, '$.generatedAt')
      ) = json_extract(NEW.evidence_bundle, '$.generatedAt')
    )
    OR
    (
      length(json_extract(NEW.evidence_bundle, '$.generatedAt')) = 24
      AND strftime(
        '%Y-%m-%dT%H:%M:%fZ',
        json_extract(NEW.evidence_bundle, '$.generatedAt')
      ) = json_extract(NEW.evidence_bundle, '$.generatedAt')
    )
  ), 0) = 0
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version
    WHERE json_extract(version.value, '$.datasetId') <> trim(json_extract(version.value, '$.datasetId'))
       OR json_extract(version.value, '$.versionId') <> trim(json_extract(version.value, '$.versionId'))
       OR json_extract(version.value, '$.checksum') <> trim(json_extract(version.value, '$.checksum'))
       OR coalesce((
         (
           length(json_extract(version.value, '$.refreshedAt')) = 4
           AND json_extract(version.value, '$.refreshedAt') GLOB '[0-9][0-9][0-9][0-9]'
           AND json_extract(version.value, '$.refreshedAt') <> '0000'
         )
         OR
         (
           length(json_extract(version.value, '$.refreshedAt')) = 7
           AND json_extract(version.value, '$.refreshedAt') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
           AND substr(json_extract(version.value, '$.refreshedAt'), 1, 4) <> '0000'
           AND strftime(
             '%Y-%m',
             json_extract(version.value, '$.refreshedAt') || '-01T00:00:00Z'
           ) = json_extract(version.value, '$.refreshedAt')
         )
         OR
         (
           length(json_extract(version.value, '$.refreshedAt')) = 10
           AND json_extract(version.value, '$.refreshedAt') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
           AND substr(json_extract(version.value, '$.refreshedAt'), 1, 4) <> '0000'
           AND strftime(
             '%Y-%m-%d',
             json_extract(version.value, '$.refreshedAt') || 'T00:00:00Z'
           ) = json_extract(version.value, '$.refreshedAt')
         )
         OR
         (
           length(json_extract(version.value, '$.refreshedAt')) = 20
           AND strftime(
             '%Y-%m-%dT%H:%M:%SZ',
             json_extract(version.value, '$.refreshedAt')
           ) = json_extract(version.value, '$.refreshedAt')
         )
         OR
         (
           length(json_extract(version.value, '$.refreshedAt')) = 24
           AND strftime(
             '%Y-%m-%dT%H:%M:%fZ',
             json_extract(version.value, '$.refreshedAt')
           ) = json_extract(version.value, '$.refreshedAt')
         )
       ), 0) = 0
  )
  OR EXISTS (
    SELECT json_extract(version.value, '$.datasetId')
    FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version
    GROUP BY json_extract(version.value, '$.datasetId')
    HAVING count(*) > 1
  )
  OR EXISTS (
    SELECT json_extract(version.value, '$.versionId')
    FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version
    GROUP BY json_extract(version.value, '$.versionId')
    HAVING count(*) > 1
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version,
         json_each(version.value, '$.sourceIds') AS source_id
    WHERE source_id.type <> 'text'
       OR source_id.value <> trim(source_id.value)
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version
    WHERE EXISTS (
      SELECT source_id.value
      FROM json_each(version.value, '$.sourceIds') AS source_id
      GROUP BY source_id.value
      HAVING count(*) > 1
    )
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.source_manifest) AS source
    WHERE json_type(source.value, '$.sourceId') IS NOT NULL
      AND (
        json_type(source.value, '$.sourceId') <> 'text'
        OR length(json_extract(source.value, '$.sourceId')) = 0
        OR json_extract(source.value, '$.sourceId') <> trim(json_extract(source.value, '$.sourceId'))
      )
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
    WHERE json_extract(view.value, '$.viewUrl') <> trim(json_extract(view.value, '$.viewUrl'))
       OR json_extract(view.value, '$.queryId') <> trim(json_extract(view.value, '$.queryId'))
       OR json_extract(view.value, '$.resultChecksum') <> trim(json_extract(view.value, '$.resultChecksum'))
  )
  OR EXISTS (
    SELECT json_extract(view.value, '$.viewUrl')
    FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
    GROUP BY json_extract(view.value, '$.viewUrl')
    HAVING count(*) > 1
  )
  OR (
    NEW.primary_view_url IS NOT NULL
    AND (
      typeof(NEW.primary_view_url) <> 'text'
      OR NEW.primary_view_url <> trim(NEW.primary_view_url)
    )
  );
END;
