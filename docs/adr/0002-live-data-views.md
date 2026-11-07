# Persist product-owned Data Views

Maps, charts, MCP Apps, and Research Articles reference the same versioned Data View rather than storing renderer configuration or screenshots. Developing Country owns this small contract; MapLibre, Flint, and ECharts are adapters so saved evidence remains intelligible if a renderer changes.

Each Data View claim is immutable in D1. Its complete canonical Query Snapshot is stored under a content-addressed key in the dedicated `VIEWS` R2 bucket; small snapshots may also be inlined as a read optimization. The public result URL carries the SHA-256 digest and is immutable-cacheable. Revocation changes lifecycle state, never the claim. Map playback renders only saved geometry over a contextual basemap and does not re-run the explorer's mutable layer registry.

Evidence references the real Dataset Versions in `scripts/dataset-versions.json`. A query id identifies a Query Snapshot and is never substituted for a Dataset Version. Until a live/D1/remote source has an immutable export workflow, any result containing one of those unversioned entities cannot become a persistent Data View.

Revocation stops the platform from resolving or newly serving the Data View; it is not deletion or recall. A client that already fetched an immutable Query Snapshot may retain those bytes, just as it could retain any cited source artifact.
