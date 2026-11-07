-- Map underlays (ADR 0009). dcFigure and dcScrolly steps may carry
-- `underlay_urls`: comma-separated Data View URLs drawn beneath the main view.
-- Extends the 0063 evidence gate (left untouched) with two additive triggers:
-- every underlay URL must equal an evidence_bundle.dataViews viewUrl, whose
-- values 0001/0002/0063 already require to be canonical and unique.
--
-- SQLite triggers cannot use CTEs, so the list is checked arithmetically:
-- whitespace and empty items are removed, then the number of comma-separated
-- items must equal the number of whole-item matches against dataViews.
-- apps/site/src/figureEvidenceMigration.test.ts covers both triggers.

DROP TRIGGER IF EXISTS dc_articles_underlay_evidence_insert;
CREATE TRIGGER dc_articles_underlay_evidence_insert
BEFORE INSERT ON ec_articles
WHEN NEW.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'dc_publication_evidence: invalid published Research Article')
  WHERE
  EXISTS (
    SELECT 1 FROM json_each(NEW.content) AS block
    WHERE json_extract(block.value, '$._type') = 'dcFigure'
      AND (
          (json_type(block.value, '$.underlay_urls') IS NOT NULL AND json_type(block.value, '$.underlay_urls') NOT IN ('text', 'null'))
          OR (
            json_type(block.value, '$.underlay_urls') = 'text'
            AND trim(replace(replace(replace(replace(replace(replace(replace(json_extract(block.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ',') <> ''
            AND (length(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(block.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ',')) - length(replace(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(block.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ','), ',', '')) + 1) <> (
            SELECT coalesce(sum(
              (length((',' || replace(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(block.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ','), ',', ',,') || ',')) - length(replace((',' || replace(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(block.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ','), ',', ',,') || ','), ',' || json_extract(view.value, '$.viewUrl') || ',', '')))
              / length(',' || json_extract(view.value, '$.viewUrl') || ',')
            ), 0)
            FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
          )
          )
        )
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.content) AS block,
         json_each(block.value, '$.steps') AS step
    WHERE json_extract(block.value, '$._type') = 'dcScrolly'
      AND (
          (json_type(step.value, '$.underlay_urls') IS NOT NULL AND json_type(step.value, '$.underlay_urls') NOT IN ('text', 'null'))
          OR (
            json_type(step.value, '$.underlay_urls') = 'text'
            AND trim(replace(replace(replace(replace(replace(replace(replace(json_extract(step.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ',') <> ''
            AND (length(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(step.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ',')) - length(replace(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(step.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ','), ',', '')) + 1) <> (
            SELECT coalesce(sum(
              (length((',' || replace(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(step.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ','), ',', ',,') || ',')) - length(replace((',' || replace(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(step.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ','), ',', ',,') || ','), ',' || json_extract(view.value, '$.viewUrl') || ',', '')))
              / length(',' || json_extract(view.value, '$.viewUrl') || ',')
            ), 0)
            FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
          )
          )
        )
  );
END;

DROP TRIGGER IF EXISTS dc_articles_underlay_evidence_publish;
CREATE TRIGGER dc_articles_underlay_evidence_publish
BEFORE UPDATE OF status, evidence_bundle, content ON ec_articles
WHEN NEW.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'dc_publication_evidence: invalid published Research Article')
  WHERE
  EXISTS (
    SELECT 1 FROM json_each(NEW.content) AS block
    WHERE json_extract(block.value, '$._type') = 'dcFigure'
      AND (
          (json_type(block.value, '$.underlay_urls') IS NOT NULL AND json_type(block.value, '$.underlay_urls') NOT IN ('text', 'null'))
          OR (
            json_type(block.value, '$.underlay_urls') = 'text'
            AND trim(replace(replace(replace(replace(replace(replace(replace(json_extract(block.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ',') <> ''
            AND (length(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(block.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ',')) - length(replace(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(block.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ','), ',', '')) + 1) <> (
            SELECT coalesce(sum(
              (length((',' || replace(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(block.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ','), ',', ',,') || ',')) - length(replace((',' || replace(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(block.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ','), ',', ',,') || ','), ',' || json_extract(view.value, '$.viewUrl') || ',', '')))
              / length(',' || json_extract(view.value, '$.viewUrl') || ',')
            ), 0)
            FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
          )
          )
        )
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.content) AS block,
         json_each(block.value, '$.steps') AS step
    WHERE json_extract(block.value, '$._type') = 'dcScrolly'
      AND (
          (json_type(step.value, '$.underlay_urls') IS NOT NULL AND json_type(step.value, '$.underlay_urls') NOT IN ('text', 'null'))
          OR (
            json_type(step.value, '$.underlay_urls') = 'text'
            AND trim(replace(replace(replace(replace(replace(replace(replace(json_extract(step.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ',') <> ''
            AND (length(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(step.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ',')) - length(replace(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(step.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ','), ',', '')) + 1) <> (
            SELECT coalesce(sum(
              (length((',' || replace(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(step.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ','), ',', ',,') || ',')) - length(replace((',' || replace(trim(replace(replace(replace(replace(replace(replace(replace(json_extract(step.value, '$.underlay_urls'), ' ', ''), char(9), ''), char(10), ''), char(13), ''), ',,', ','), ',,', ','), ',,', ','), ','), ',', ',,') || ','), ',' || json_extract(view.value, '$.viewUrl') || ',', '')))
              / length(',' || json_extract(view.value, '$.viewUrl') || ',')
            ), 0)
            FROM json_each(NEW.evidence_bundle, '$.dataViews') AS view
          )
          )
        )
  );
END;
