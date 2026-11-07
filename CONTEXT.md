# Developing Country Data Commons

Developing Country makes public socioeconomic evidence understandable, queryable, and reusable across countries, beginning with Sri Lanka.

## Evidence

**Country Pack**:
The registered country profile that binds one country code to its ontology, dataset registry, map framing, and query implementation. Missing country input may select the product default; an unsupported supplied code never does.
_Avoid_: Tenant, separate app, country fork

**Dataset**:
A named, refreshable collection of related observations, entities, geometries, documents, or events published under one provenance record.
_Avoid_: Layer, feed

**Dataset Version**:
An immutable source-artifact set for a Dataset, identified by its checksum and source vintage. A query id is never a Dataset Version.
_Avoid_: Latest data, current file, query result

**Source**:
A provenance record for the primary evidence from which a Dataset Version was obtained. It identifies, but is not interchangeable with, the Publisher.
_Avoid_: Publisher, Provider

**Publisher**:
The person or organisation responsible for issuing a Dataset. A Dataset Publisher may differ from the publishers of its upstream Sources; for example, DevelopingCountry.org publishes a computed walking-access Dataset whose Sources include community transit stops and OpenStreetMap streets.
_Avoid_: Source, Host

**Publisher Type**:
A controlled, high-level classification of a Publisher as `government`, `international`, `community`, `platform`, or `other`. It supports broad discovery without replacing the Publisher's exact identity.
_Avoid_: Public Data Theme, free-form tag, Source type

**Public Data Theme**:
A controlled DCAT category describing a Dataset’s subject using the EU Data Theme concept scheme. A Dataset may have more than one Public Data Theme.
_Avoid_: Free-form tag, Dataset type, Layer group

**Freshness State**:
Computed review urgency for a Source: `fresh`, `due`, `overdue`, `live`, or `invalid`. It never asserts that evidence is true, complete, or fit for a claim.
_Avoid_: Valid, accurate, trustworthy

**Observation**:
A measured or reported value for a Measure, Place or Entity at a stated time and Dataset Version.
_Avoid_: Data point, metric row

**Indicator Table**:
A versioned tabular Dataset artifact whose declared dimensions and measures define bounded Observation queries. It contains evidence and units, never chart styling or map camera state.
_Avoid_: Spreadsheet dump, chart data, renderer config

**Entity**:
A stable real-world subject such as a project, facility, organisation, route, or development.
_Avoid_: Feature, item

**Place**:
A stable geographic area or named location to which evidence can be attached.
_Avoid_: Region, polygon

**Event**:
A dated change in an Entity's lifecycle, status, cost, scope, or evidence.
_Avoid_: Timeline item, update

**Relationship**:
A typed, evidence-backed connection between two Entities or Places.
_Avoid_: Related item, link

## Presentation and research

**Layer**:
A map presentation of one or more Datasets; it is not itself the evidence.
_Avoid_: Dataset

**Data View**:
A saved, provenance-bearing instruction for presenting one immutable Query Snapshot as a map or chart.
_Avoid_: Embed, chart config, map state

**Query Snapshot**:
The immutable, content-addressed result of one bounded platform query. It cites Dataset Versions but does not masquerade as one.
_Avoid_: Dataset Version, live result

**Evidence Bundle**:
An immutable set of Dataset Versions, Query Snapshots, citations, and Data Views supporting a research claim or article.
_Avoid_: Research output, context dump

**Research Article**:
A human-reviewed publication whose claims cite Sources and whose interactive figures reference saved Data Views. Its versioned Evidence Bundle must pass the database publication gate before the CMS can make it live.
_Avoid_: Blog post, generated content
