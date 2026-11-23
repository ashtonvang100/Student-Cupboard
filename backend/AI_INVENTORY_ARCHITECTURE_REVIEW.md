# Student Cupboard: AI-Managed Inventory Architecture Review

Date: 2026-11-18

Status: architecture proposal, not an implementation. Only this document is created for this task. No application code, configuration, schema, migrations, or database records are changed. This review inspected repository code and tests; it did not contact a database, EC2, RDS, or OpenAI for inventory analysis, or establish production behavior.

## 1. Current architecture

### Implemented behavior

The backend is TypeScript and Hono, with PostgreSQL queried through Drizzle and image analysis through the OpenAI Responses API. It is a staff-reviewed scanning system, not an autonomous inventory manager.

```text
Staff uploads 1–5 images and one area name
  -> Sharp validates, rotates, resizes, and converts images in memory
  -> OpenAI analyzes all uploaded images in one request
  -> backend matches detected identities against the product catalog
  -> original AI analysis and editable review items are saved
  -> staff confirms quantities, matches, and first-area baselines
  -> approval transaction changes inventory, area counts, history, and status
```

| Existing table           | Implemented responsibility                                                      | Limitation for the target workflow                                                |
| ------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `categories`             | Product classifications                                                         | AI category text is not automatically mapped to category IDs                      |
| `products`               | Name, brand, size, variation, barcode, manual nutrition                         | Only barcode is a unique product identifier; no alias/evidence history            |
| `inventory`              | One total integer quantity and unit per product                                 | No freshness, uncertainty, reconciliation version, or coverage semantics          |
| `inventory_transactions` | Signed quantity changes with reasons, actor, before/after totals, optional scan | Does not represent observation-only changes or transfers explicitly               |
| `inventory_scans`        | One area, status, original analysis JSON, reviewed-item JSON, fingerprint       | No multi-area session, capture window, coverage record, or image references       |
| `inventory_area_counts`  | Latest approved quantity/date per product and area                              | Overwrites current baseline; insufficient as historical observation storage       |
| `product_nutrition`      | One AI candidate per product, source scan, `verified` flag                      | No supported verification/correction workflow; later candidates cannot replace it |

Sources: [schema](src/db/schema.ts#L17), [initial migration](drizzle/0000_initial_schema.sql), [scanning migration](drizzle/0001_ai_inventory_scanning.sql), [expiration migration](drizzle/0002_area_expiration.sql).

The original scan JSON already retains historical detections; history is not entirely absent. However, it lacks explicit coverage, per-image evidence, physical-instance associations, and queryable observation lifecycle records. The latest area row cannot explain why a product was unseen or which observations were jointly accepted.

### AI context and matching today

`VisionAnalyzer.analyze(images)` receives image data and extraction instructions. It does not receive area identity, product candidates, previous counts, prior observations, or prior images. All current images are sent together, so overlap reasoning within that request is possible, but there are no image IDs or object-evidence links in the returned schema. The model defaults to the configured `OPENAI_VISION_MODEL`, or `gpt-5-mini`.

The backend loads all products after analysis and requires one unique normalized name/brand/package-size/variation match, with compatible barcodes. Barcode alone is not a lookup key in this matcher. Unmatched items remain unresolved until staff select a product or explicitly create one. Source: [OpenAI service](src/services/openai.service.ts#L6), [matching and review initialization](src/services/scans.service.ts#L26), [scan validation](src/validators/scans.ts#L32).

Identity and quantity confidence below 0.9, warnings, unknown fields, estimated nutrition, and non-visible count types set `needsReview`. Every included item still needs `confirmed: true`. Confidence is a model-produced value, not measured accuracy. Global warnings and low nutrition confidence alone are not included in the per-item backend review rule. Sources: [review flags](src/services/scans.service.ts#L41), [approval checks](src/services/scans.service.ts#L248).

### Reconciliation today

```text
delta = reviewed area count − previous approved area count
new inventory total = current total + delta
```

For an existing product's first area scan, staff must enter `initialAreaQuantity`: how much of that area is already included in the total. Missing/excluded products are not zeroed. Approval uses a database transaction, row locks, a global advisory lock, stale-write checks, unit checks, and repeat-approval protection. These are useful foundations to preserve. Source: [approval](src/services/scans.service.ts#L233).

Manual stock changes update the total and transaction history but do not update area baselines. Example: shelf baseline 10, total 100; manual removal of 3 gives 97; a later scan of 7 subtracts another 3, giving 94. The stale-scan check does not prevent this if scanning starts after the removal. Source: [inventory writes](src/services/inventory.service.ts#L53).

Images are not stored. Only a combined fingerprint survives. Exact normalized duplicates are collapsed; new viewpoints of the same objects are not deterministically deduplicated. Global fingerprint uniqueness prevents reanalysis of identical images even after failure/rejection. Uploads are synchronous, and a crash can leave `processing` records. Sources: [images](src/services/images.service.ts#L4), [scan creation](src/services/scans.service.ts#L95), [scan routes](src/routes/scans.ts#L8).

All resource access currently requires staff credentials, including reads. There is no student question endpoint, read-only student role, or database tool-calling loop. Sources: [app](src/app.ts#L25), [auth](src/middleware/auth.ts#L27), [product retrieval](src/services/products.service.ts#L18).

## 2. Gaps relative to fully AI-managed inventory

The target normal workflow must ask staff for photographs and exception oversight, never numeric counts, first-area quantities, or area reconciliation calculations. Removing the confirmation requirement alone would automate the existing errors.

| Requirement                       | Current status                                    | Required evolution                                                         |
| --------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| Automatic identification/counting | Partial: image extraction exists                  | Contextual identity resolution, evidence, measured acceptance rules        |
| Automatic inventory application   | Missing: confirmation and baseline entry required | Policy-controlled reconciliation and transactional application             |
| Full multi-area session           | Missing                                           | Session manifest, per-area coverage, joint analysis and one reconciliation |
| Individual scans over days        | Partial: named area scans exist                   | Historical observations, freshness, unresolved movement handling           |
| Movement/removal distinction      | Missing                                           | Separate observed changes, movement hypotheses, and confirmed events       |
| Historical visual comparison      | Missing                                           | Selected private image evidence and explicit current/prior labels          |
| Reliable current total            | Partial                                           | One versioned projection with certainty, scope, and timestamps             |
| Student assistant                 | Missing                                           | Authorized read-only tools over that projection                            |

### A necessary accuracy boundary

Photographs are samples of physical reality. A hidden box, a stockroom not photographed today, and identical packages moved between days are not fully observable. Better prompts cannot recover evidence that was never captured. OpenAI documents approximate object counts and spatial/localization limitations in its [vision guide](https://developers.openai.com/api/docs/guides/images-vision). Structured response schemas do not establish factual correctness; see [Structured Outputs limitations](https://developers.openai.com/api/docs/guides/structured-outputs).

An exact, continuously current total cannot be guaranteed from arbitrary intermittent photographs alone. The practical goal is automatic evidence collection, automatic updates where justified, and explicit uncertainty otherwise. An unresolved result should trigger a targeted recapture or remain unknown; it should not require staff to invent a number. If continuously exact stock later becomes mandatory, more complete observation at receipt/distribution boundaries would be needed, potentially using photographs at those points within the same stack.

## 3. Recommended architecture and data flow

Everything below is proposed, not present in the current backend.

Separate three concepts:

1. **Observation:** what the model found in particular images at particular times.
2. **Reconciliation:** an evidence-linked proposal connecting observations to catalog identities, previous state, and possible movements.
3. **Accepted inventory projection:** the latest system-accepted stock state, with its age, scope, uncertainty, and revision. PostgreSQL is authoritative for this state, not a guarantee of unseen physical reality.

```text
Staff starts full session or single-area session
  -> capture manifest: area IDs, image IDs, capture windows, expected views
  -> bounded upload and quality checks
  -> current-image extraction with catalog candidates
  -> joint comparison with selected historical observations/images
  -> immutable observation rows + evidence links
  -> AI proposes identities, counts, change hypotheses, and recapture needs
  -> TypeScript validates identity, coverage, units, time, overlap, and state version
       -> sufficient evidence: atomic accepted reconciliation
       -> insufficient evidence: unresolved state + targeted photograph request
  -> inventory projection + history + freshness exposed to student query tools
```

The AI performs visual interpretation and proposes explanations. TypeScript performs arithmetic, enforces acceptance policy and access control, and executes database writes. Do not give the model arbitrary SQL or direct inventory mutation credentials.

Use one reconciliation service for both workflows and all future stock writers. Preserve Hono, Drizzle, PostgreSQL, and OpenAI. Initially use bounded requests and resumable database job statuses. When multi-step processing outgrows HTTP timeouts, run a small worker from the same TypeScript codebase using PostgreSQL job claims/leases; do not require Redis, Kafka, an agent framework, or a vector database. External model calls occur outside database transactions; version validation and application occur in a short transaction.

### Workflow A: full inventory session

- Create a session with an explicit list of intended areas. Distinguish "all cupboard areas" from "all areas selected for this session."
- Associate each image with an area/view and capture time. A printed area marker or existing location selector may identify place without asking staff to count.
- Assess missing views, occlusion, blur, overlap, and possible motion. A staff declaration that capture is complete is useful metadata, not proof of visual completeness.
- Analyze current photographs together with explicit image/area IDs so shared views and cross-area appearances can be related. Produce both per-area observations and a session-wide unique-instance proposal.
- For large sessions, extract by area in bounded batches, then perform a joint reconciliation pass over evidence and selected images. Do not sum independent batch outputs. Request recaptures for unresolved overlap.
- Commit a coherent accepted revision once for the reconciled product/scope, not one independent global delta per area.
- Call the result complete only for successfully covered areas. A failed/missing area cannot be silently treated as empty. If movement during capture could cause the same package to appear twice, do not treat the session as one simultaneous snapshot.

Only a sufficiently complete, temporally coherent session covering the entire relevant inventory can replace a whole-product total from its unique observed count. A subset session cannot erase stock outside its scope. If independent product groups are accepted separately, record per-product decisions and leave coupled/ambiguous groups pending; do not mark the whole session fully reconciled.

### Workflow B: individual area scans

- Use the same session model with one selected area. Save capture time separately from upload and processing times.
- Retrieve that area's observation history plus the product's recent observations in other areas, especially possible transfer sources/destinations.
- Save a new local observation even when no global total can safely change.
- Update latest observed location/freshness independently of the accepted quantity allocation. Never add a new destination sighting to an old source count automatically.
- Do not zero absent products elsewhere. Even local absence requires sufficient coverage to become a reliable zero observation.
- If a new sighting could be a move from stale stock elsewhere, retain the global total as last accepted, mark it unresolved/stale, and request photographs of likely counterpart areas. Do not publish the retained number as a freshly verified total.
- A later scan or full session can resolve the pending evidence without staff entering a count. Days-old evidence remains historical, even if it arrived last.

Both modes write to the same versioned projection. Sessions are evidence containers, not separate competing inventory totals. Full sessions do not always take precedence: a late full-session result must not overwrite a newer accepted state without revalidation.

## 4. Recommended database changes

These are conceptual schema changes for future reviewed migrations. No SQL migrations are included or executed here.

### Add the minimum evidence and reconciliation model

| Proposed record             | Key structured fields                                                                                                                                                                                      | Purpose                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `inventory_areas`           | Stable ID, name, parent/location, active state, non-overlapping counting scope, expected views                                                                                                             | Resolve spelling aliases; prevent counting parent room plus its child shelves twice      |
| `inventory_scan_sessions`   | UUID, mode, actor, intended scope, started/closed times, lifecycle, idempotency key, capture-window policy                                                                                                 | Group full or individual scans; distinguish intended scope from actual coverage          |
| `inventory_session_areas`   | Session ID + area ID, capture window, coverage/quality status, expected/received views, missing reasons                                                                                                    | Represent missing/failed/empty areas even when there are no item detections              |
| `inventory_observations`    | UUID, session/scan/area/product references, nullable unresolved identity, capture time, quantity estimate, optional lower/upper limits, unit, count kind, separate confidence fields, superseded reference | Preserve time-series observations rather than overwriting a baseline                     |
| `inventory_reconciliations` | UUID, status, input observation IDs, expected product versions, policy/model versions, decision time, accepted version, decision/evidence JSON                                                             | Persist proposals, deferrals, movement hypotheses, acceptance, retries, and explanations |

Use existing `inventory_scans` as a processing attempt linked to a session and area; retain raw analysis JSON for audit. Add model, prompt, output-schema version, processing timestamps, retry/lease fields, and context observation IDs. Separate a photograph's identity from a processing attempt so deliberate reanalysis can reuse evidence. Do not copy its old observation into a new capture time.

For observations, keep image IDs, bounding regions, candidate products, visible labels, overlap groups, per-item expiration candidates, and quality warnings in validated JSON initially. The product foreign key may be null until resolved. Corrections produce a new observation/decision and a supersession link; do not rewrite original evidence. Empty coverage is represented in `inventory_session_areas`, not by inventing an item.

Count ranges are optional uncertainty estimates, not automatically guaranteed bounds. Use `upper = null` when the view cannot bound hidden stock. Enforce nonnegative values and `lower <= estimate <= upper` only when those values are present and meaningful. Do not pretend a count confidence is a calibrated probability. Explicit absence may be recorded only with adequate coverage of that product's possible placement.

### Evolve existing projections and history

- **`inventory`:** retain the fast product total but define it as last accepted quantity; add reconciliation ID/version, accepted-as-of/capture window, projection update time, freshness/certainty status, unresolved-evidence flag, and scope coverage. Before initialization, represent unknown separately from zero. A numeric legacy value must not be exposed without its semantics.
- **`inventory_area_counts`:** retain as a rebuildable accepted-location projection, replacing free-text identity with area ID and adding source observation/reconciliation/version. It is insufficient as the source of history. Latest observed counts may disagree with accepted allocations while unresolved; expose them separately, derived from observation queries or explicit separate pointers. Never overwrite an accepted allocation with an unresolved detection and then sum it.
- **`inventory_transactions`:** link changes to accepted reconciliations and input observations; retain before/after totals, unit snapshot, machine actor, and reason kind. Existing transaction-type checks require nonzero deltas. Store zero-net moves and no-change decisions in the reconciliation record rather than forcing a fake stock transaction. Add an event table only if movement querying later warrants it.
- **`products`:** preserve brand/size/variation identity, introduce canonical size/unit normalization and validated aliases with provenance. Keep candidate identities outside the permanent catalog until acceptance; serialize/deduplicate automatic creation. Different sizes/variations must not merge because names are similar.
- **`product_nutrition`:** retain candidate history in observations; add accepted source/version/identity provenance and a correction path. Distinguish visually corroborated extraction, explicit human verification, and estimated nutrition. Automated acceptance must not set a human-verification flag. Unreadable allergens mean unknown, not allergen-free.

One product/area expiration date cannot represent multiple batches. First retain each visible date and any quantity association as observation evidence. Add lot records when reliable lot-to-quantity associations can be extracted; do not assign one visible date to all packages of that product. Expiry does not itself prove disposal or decrement physical quantity.

### Image metadata, constraints, and indexing

If photographic evidence is retained, add `inventory_scan_images` with image ID, session/area association, capture-time provenance, normalized hash, private object reference, dimensions, preprocessing version, retention deadline, and deletion state. Use a join table for observation/image associations when queries require it; JSON evidence IDs are acceptable in an initial bounded implementation with application validation.

Add foreign keys and database checks for modes/statuses, quantities, units, and uniqueness. Use a unique apply key per accepted reconciliation/product version. Exact image hashes should prevent duplicate submission/application, not permanently forbid versioned reanalysis. Validate session ownership and authorization on uploads and evidence access.

Index observations by `(area_id, captured_at)` and `(product_id, captured_at)`, sessions by lifecycle/time, and reconciliation inputs/accepted versions for replay checks. Keep query-critical facts in columns; preserve flexible extraction detail in JSONB. Add expiration or nutrition expression indexes only after real retrieval requirements justify them. Maintain all projections and history through the same transactional service; raw SQL is not an alternate writer.

### Initialize without manual baselines

Import existing scans as legacy historical evidence without inventing coverage, capture times, or calibrated confidence. Mark existing area strings for canonical mapping and overlapping-scope review. Keep the existing total as `legacy_unreconciled`, including stock not assigned to any known area. Do not silently set that residual to zero or distribute it proportionally.

Ask for an AI-led full photographic session over the relevant inventory to initialize coherent allocations. If only individual scans are available, accept observations progressively but keep the total uninitialized/unresolved until evidence is sufficient. Do not translate the old `initialAreaQuantity` form into a hidden manual-count requirement.

## 5. How AI should use historical context and images

### Context retrieval for a scan

Send a bounded, explicitly dated context packet:

- Current area IDs, view labels, session manifest, capture windows, and known gaps.
- Candidate products: canonical IDs, names, brand, size, variation, barcode and validated aliases. Use PostgreSQL exact/normalized search first; use a second pass after tentative label extraction when needed.
- Recent accepted and unresolved observations for the scanned area/product, including count kind, confidence, quality, age, evidence IDs, and previous acceptance decisions.
- Relevant counterpart-area observations for possible movement, including stale/unknown status and unlocated legacy stock.
- Current accepted projection, its version/as-of time, and intervening accepted events.
- Selected prior images only when they can help resolve identity, overlap, placement, or disagreement.

Keep historical expectations labeled as expectations, not current evidence. Prefer an initial current-image extraction pass followed by contextual comparison, reducing the risk that an old count simply anchors the new answer. A second pass over the same evidence is not independent corroboration. Do not send the entire catalog/history or rely on conversational memory between requests.

For package identity, prefer a readable unique barcode, then brand + canonical product + size + variation. The AI may suggest candidate IDs but the backend validates them against current catalog records and rejects conflicting identity evidence. Normalize equivalent package-size expressions in code without conflating package count, serving count, and counting unit. New products/categories may be created automatically only from sufficient evidence and valid canonical mappings; otherwise ask for a label close-up, not manual entry.

### Retain structured history; keep selected photographs

Structured history is the primary retrieval/reconciliation record: it is smaller, queryable, and can survive image deletion. Keep model/prompt/schema versions, input hashes, source images/crops, exact visible label text, observed time, uncertainty, coverage, accepted/held decision reasons, and original extraction. Save concise evidence explanations, not hidden chain-of-thought.

Retaining selected photographs makes visual comparison and debugging possible; structured numbers cannot reveal a previously misread label. Recommend normalized overview images and relevant label crops for a bounded retention window, with longer retention only for documented exceptions. Do not retain every original indefinitely.

Use one private image store only when this feature is built. Given EC2/RDS, private S3 storage is a reasonable minimal durable option for multi-instance/restart resilience; it is not already implemented. A single-instance pilot could use protected EC2 disk with explicit durability/backup limitations. PostgreSQL should store references, not base64 photographs. Use encryption, least-privilege access, short-lived authorized access, face/personal-information avoidance, and expiry/deletion jobs. Keep evidence hashes and deletion metadata after image deletion. Image retention is separate from indefinite stock-history retention. Existing `store: false` is not a promise of zero provider retention; verify [provider data controls](https://developers.openai.com/api/docs/guides/your-data) and account configuration before deployment.

Current and previous images can be provided together, but label them clearly by area, time, and role. Historical packages must never be counted into the current observation. Identical packaging is not a persistent physical identifier; visual similarity supports a hypothesis, not proof of a transfer. Evaluate resized overview readability and preserve focused crops where needed.

## 6. Movement between areas and reconciliation semantics

### Separate what was seen from why it changed

| Evidence                                                                   | Permitted conclusion                                                | Unsupported conclusion                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| A new area photo shows fewer packages                                      | Local observed decrease, if coverage supports it                    | Confirmed distribution/removal from cupboard                |
| Another area shows more of the same SKU                                    | Possible transfer or receipt                                        | Proof these are the source area's missing packages          |
| A complete coherent full session shows fewer unique packages overall       | Accepted snapshot correction, if quality gates pass                 | Proof of theft, distribution, or a particular removal event |
| A package is absent from an obstructed photograph                          | No reliable absence measurement                                     | Zero stock                                                  |
| A dated receiving/distribution capture traces packages across the boundary | Candidate confirmed receipt/removal, subject to identity/time gates | Any unrelated historical discrepancy is resolved            |

Store movement hypotheses with source/destination, quantity/range, supporting observations, time window, confidence, and status. Compatible opposite deltas can suggest a move; they do not establish it. A sufficiently coherent joint snapshot can establish current distribution even when the causal history remains unknown. Record that as an observed redistribution, not a confirmed physical transfer event.

Confirmed internal movement preserves total quantity. Confirmed external receipt/removal changes it once. Accepting a new snapshot may correct the total without knowing why; the history reason is `snapshot_correction`, not an invented removal. No stock decrement should be triggered solely because a product was unseen in one area.

### One global projection, not a sum of unrelated latest photographs

For product `p`, let `Q(p, v)` be the accepted total at revision `v`. For a complete accepted coherent snapshot `S` of the entire relevant scope:

```text
Q(p, v+1) = unique supported count of p in S
delta = Q(p, v+1) − Q(p, v)
```

For a partial replacement of an accepted group of areas `G`, the formula is valid only when the old allocation, new count, and boundary evidence make that replacement independent of unresolved stock outside `G`:

```text
Q(p, v+1) = Q(p, v) − accepted allocation(p, G, v) + supported count(p, G, S)
```

Do not apply this formula merely because areas have different names or were recently scanned. Stock can move between them. If possible cross-boundary movement cannot be excluded, keep the proposal pending or enlarge the reconciliation scope and request targeted photographs. A confirmed boundary event and a later snapshot must share event/version provenance so the same change is not applied twice.

Only sum accepted non-overlapping allocations from one coherent revision, plus any explicitly unlocated accepted balance. Never sum independent "latest observations" as though they were simultaneous. If numeric certainty cannot be justified, retain last accepted quantity with `stale/unresolved` semantics; the student API must be allowed to return `quantity: null` for a current exact answer alongside `lastAcceptedQuantity` and its timestamp. Do not represent uncertainty as zero.

Fresh visible counts can support statements about what was seen at capture time. They are not guaranteed current lower bounds after people can remove stock. Do not fabricate a finite upper bound from an obstructed photo. Age and completeness must be surfaced rather than hidden in a single confidence number. Aging an observation changes its freshness, never its historical quantity, and never creates a removal transaction by itself.

### Example: asynchronous movement without double-counting

| Step                    | Evidence                                                       | System behavior                                                                                                             |
| ----------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Monday                  | Coherent accepted snapshot: A=10, B=0                          | Total 10 at revision 1                                                                                                      |
| Tuesday                 | Five packages may have moved; B photograph shows 5; A is stale | Save B=5 observation; do not compute 10+5; total stays last accepted 10, now unresolved                                     |
| Tuesday follow-up       | A and B recaptured in a short coherent window: A=5, B=5        | Accept distribution 5+5=10 at revision 2; net total delta zero; causal move remains inferred unless independently evidenced |
| Alternative follow-up   | Coherent coverage shows A=10, B=5                              | Accept total 15 via snapshot correction; receipt cause remains unknown                                                      |
| Alternative obstruction | A cannot be seen reliably                                      | Keep unresolved; request better view, no manual quantity entry                                                              |

A single A=5 observation with stale B must likewise not automatically reduce total 10 to 5. If Tuesday's photographs span too long or show active movement, they do not establish a coherent snapshot; request an appropriate recapture. A closed session is not automatically a valid snapshot.

## 7. Preventing double-counting and inaccurate updates

### Automatic acceptance gates

Use configurable policies measured on representative images, not an untested universal confidence cutoff:

1. Valid, unambiguous catalog identity and compatible counting unit.
2. Evidence for visible count versus estimate; justified optional ranges.
3. Required view coverage and acceptable blur/obstruction.
4. Current-image overlap resolved, with source image/object associations.
5. No unresolved temporal duplication, counterpart movement, or legacy allocation conflict affecting the proposed total.
6. Capture age/window acceptable for the decision; old uploads cannot masquerade as current.
7. Plausibility checks on abrupt changes, package/serving relationships, and unit conversion. These trigger corroboration, not replacement with an expected number.
8. Current database version matches the proposal's inputs; idempotent application key unused.

Deduplicate at several levels: exact processed-image hashes for retries; image/view IDs and overlap regions for repeated views; session-local physical-instance/group IDs for objects; canonical product IDs for SKU aggregation; reconciliation IDs for applying changes. A barcode usually identifies a SKU, not an individual box. Perceptual hashes or model object associations are hints requiring validation, not guaranteed identity. Unknown overlap must block exact acceptance rather than be solved by blindly adding counts or taking the maximum image count.

Uncertain estimates are saved and may be displayed explicitly as estimates; they do not silently overwrite an accepted exact total. If an estimate is accepted operationally after evaluation, its projection must remain labeled estimated with documented policy and evidence. Zero observations and large decreases require especially strong coverage evidence. Missing photos, failed analysis, model refusal, or an empty extraction are not zero inventory.

### Application transaction and retries

- Persist original observations and the proposal before application.
- Claim work with an idempotency key and expiring lease; permit bounded retries for transient upstream failures.
- Lock affected product/projection rows in stable order, check revisions and input supersession, then compute all totals in TypeScript.
- Write accepted allocations, inventory, history, and reconciliation status in one transaction. Reject/recompute stale proposals rather than adding stale deltas.
- Keep a zero-net reconciliation record even when no stock transaction is created. Failure cannot leave half of a multi-area move applied.
- Corrections append superseding evidence and compensating accepted revisions; they do not erase prior history. Rebuild projections deterministically from accepted decisions, not by asking the model to reinterpret history on every read.

Routine manual quantity endpoints should be deprecated for normal staff operation in the AI-managed mode. If retained for exceptional administrator recovery, route them through the same provenance/version service and mark affected projections unresolved; they must not silently bypass area consistency. They are not the normal exception-resolution interface.

Staff exception actions should be "retake this view," "photograph this label," "scan the adjacent area," "retry," or "dismiss an invalid image." Staff may oversee unresolved cases, but no step assumes they supply a count or calculate reconciliation. If the evidence remains insufficient, the correct result is unresolved, not a mandatory manual fallback.

## 8. Student AI questions must retrieve database facts

Proposed read path:

```text
Question -> AI selects a read-only tool -> Zod validates arguments
  -> Drizzle queries a consistent PostgreSQL projection
  -> tool returns facts, provenance, timestamps, uncertainty, coverage
  -> assistant explains the returned facts with product references
```

Implement small tools such as product search, availability by product/category, latest observed locations, expiration candidates/lots, and accepted nutrition. These are proposed tools, not existing endpoints. OpenAI's [function-calling workflow](https://developers.openai.com/api/docs/guides/function-calling) supports executing application-side code and returning its results; the model does not need arbitrary database access.

| Question                              | Retrieval behavior                                                                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How many cereal boxes are available?  | Server joins products/categories to the projection, groups compatible units, and returns accepted quantity status/as-of time; unresolved current quantity is unknown |
| Where is rice?                        | Return latest reliable sightings with area, capture time, and stale/uncertain labels; do not claim old accepted placement is current                                 |
| What expires soon?                    | Query associated dates and lot quantities where known; distinguish one observed date from the entire product stock                                                   |
| What is high in protein?              | Query accepted nutrition, serving basis, source and verification status; missing nutrition is unknown, not zero                                                      |
| What ingredients are in this product? | Return exact-product label evidence/accepted profile; absence of allergen text does not establish safety                                                             |
| What can I make for a meal?           | Retrieve available/possibly available items first; meal ideas are suggestions, while availability and nutritional numbers require database evidence                  |

Return product IDs, unit, accepted revision, observation/acceptance timestamps, certainty/coverage, source and verification metadata. Compute totals, date filters and nutrient comparisons in code/SQL. Use a consistent read transaction or version token across related tools so one answer does not mix revisions. Recheck before any future stock-dependent action. Cache only with short expiry/version invalidation.

For quantitative answers, prefer a server-rendered fact card or validate generated structured claims against tool results before display. Unsupported numbers/dates/product claims should be rejected or replaced with an explicit unknown. The assistant must not fill missing inventory facts from model knowledge, a previous conversation, stale embeddings, or the public web. General meal suggestions can use general knowledge but must not invent product-specific facts.

Introduce a student-safe read authorization path that exposes only public inventory/location information, never staff tokens, actor details, raw images, or internal audit notes. Keep scan-writing tools unavailable to the student assistant. Keep image text, product labels, and question text untrusted. PostgreSQL search/joins and selective indexes are sufficient initially; no vector database or separate retrieval service is required.

## 9. Implementation phases, risks, and testing

### Incremental delivery

| Phase                                     | Deliverable                                                                                                                    | Exit criteria                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 1: Evidence foundation                    | Canonical areas, sessions/coverage, append-only observations, versions/provenance; preserve existing history                   | Both capture modes save complete evidence; no automatic stock writes; no manual baseline dependency in new workflow          |
| 2: Context and shadow reconciliation      | Catalog retrieval, joint multi-area analysis, counterpart history, recapture requests; compare proposals without applying them | Representative evaluation demonstrates identity/count/coverage and double-count controls; unresolved cases remain explicit   |
| 3: Unified automatic application          | Versioned projection, idempotent atomic acceptance, stale/retry handling; AI-led initialization                                | High-evidence cases apply without staff quantities; all writers share consistency rules; failures leave stock unchanged      |
| 4: Selective visual history and nutrition | Private retained evidence where needed, deletion controls, exact-product nutrition/date provenance                             | Authorized evidence retrieval works; image expiry does not destroy accepted history; uncertain label facts remain candidates |
| 5: Student retrieval and rollout          | Student-safe tools, freshness-aware UI/assistant, monitoring                                                                   | Fact grounding and authorization tests pass; gradual automation with rollback/freeze controls                                |

Selected image retention may move into phase 1 if cross-session visual evidence is needed for the pilot. Do not add it merely to store every upload. Session/image upload endpoints and policy decisions require future implementation; no route described here exists automatically because it appears in this document.

Begin with visible packaged goods in known non-overlapping views and a narrow set of canonical units. Dense shelves, hidden stock, unpackaged foods, and mixed expiration batches may remain estimated or unresolved. Choose freshness thresholds, capture windows, count tolerances, and evidence retention with actual operating conditions and measured errors; no defensible universal numeric values can be derived from this repository.

### Existing tests and proposed extensions

Existing tests cover image decoding, product matching, structured SDK requests, authentication, baseline/delta approval, rollback, stale scans, new products, exclusions, and nutrition preservation. They test the current manual-review contract, not the proposed architecture. OpenAI is mocked. Sources: [scan unit tests](tests/scans.test.ts), [scan integration tests](tests/scans.integration.test.ts), [API integration tests](tests/api.integration.test.ts), [validation tests](tests/validation.test.ts).

| Required test scenario                                     | Expected future behavior                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Repeated identical upload/application; crash between steps | One accepted change; resumable attempt; same captured evidence not new stock |
| Reanalysis after model/prompt upgrade                      | New processing/observation version; no duplicate application                 |
| Full session A=5/B=5 after A=10/B=0                        | Total 10; joint accepted revision; no independent +5/-5 race                 |
| Tuesday B=5 with Monday A=10                               | Unresolved, not total 15; request counterpart evidence                       |
| A disappears but B unscanned                               | No automatic removal/zeroing elsewhere                                       |
| Complete whole-scope decline with unknown cause            | Snapshot correction, not a fabricated confirmed removal                      |
| Partial/blurred/obstructed/empty extraction                | Missing evidence, not empty inventory                                        |
| Same boxes in overlapping or cross-area images             | Shared instance hypotheses; no exact sum until overlap resolved              |
| Package moves while a full session is captured             | Temporal ambiguity blocks simultaneous-snapshot assumption                   |
| Parent room plus child shelf photographed                  | Non-overlapping scope rules prevent double allocation                        |
| New destination sighting after confirmed transfer          | No second total increase; event/observation provenance deduplicates          |
| Manual legacy change before new scan                       | No baseline subtraction drift; new initialization/provenance policy enforced |
| New/ambiguous SKU, conflicting barcode, different size     | Candidate or separate product; no unsafe merge/nutrition transfer            |
| Concurrent sessions, late uploads, stale versions          | No lost update or regression; recompute/hold against current revision        |
| Mid-transaction failure and projection rebuild             | Atomic rollback; replay accepted decisions reconstructs same totals          |
| No global stock delta                                      | Reconciliation/location history still retained                               |
| Old/partial photo and no upper bound                       | No fake exact count or finite guaranteed range                               |
| Different dates on packages                                | Preserve distinct date evidence; no blanket expiration assignment            |
| Student asks for missing quantity/nutrition                | Explicit unknown, no invented values; consistent revision                    |
| Prompt injection, unauthorized image/tool access           | No instruction override, inventory mutation, or private evidence leakage     |
| Evidence deletion and expired links                        | Image unavailable; structured history/provenance remains auditable           |

Use labeled evaluation photographs with independently established reference counts for testing only. This does not introduce manual counting into normal staff workflow. Measure identity precision by size/variation, count error, false automatic changes, duplicate rate, abstention/recapture rate, stale-answer rate, and cost/latency. Stratify results by occlusion, lighting, package density and area. Repeated model agreement is not ground truth. Track harmful false acceptance separately from unresolved scans; do not improve automation rate by suppressing uncertainty.

Run database-writing integration tests only against disposable local/test databases. Existing tests apply migrations and insert/delete fixtures, so they must never target production or an RDS tunnel. This document-only task did not run them. Future CI should test both workflows, replay/idempotency, authorization, and migration preservation before rollout. The existing [CI workflow](../.github/workflows/backend-ci.yml) runs tests/builds with disposable PostgreSQL; it does not establish EC2/RDS deployment behavior.

### Principal risks and operational responses

- **Unobservable movement/hidden stock:** request targeted photographs, retain dated accepted state, expose unknown current quantity; do not manufacture certainty.
- **Model errors and changing model behavior:** version extraction/policies, evaluate before upgrades, use shadow mode, permit automatic application to be paused while evidence collection continues.
- **Repeated systematic errors:** request different views or label close-ups rather than repeatedly running the same prompt; keep the case unresolved when evidence remains inadequate.
- **Freshness without continuous capture:** show as-of times and schedule/request recaptures; do not promise real-time quantities from yesterday's photograph.
- **Privacy/cost:** bounded uploads, private access, short evidence retention, selective historical context, request limits and operational monitoring.
- **Projection drift:** one writer service, versioned accepted decisions, invariant checks, and deterministic replay. Roll back automation through a feature flag and compensating revisions, not destructive history edits or restoring stale totals blindly.
- **Rollout compatibility:** keep old API consumers functional during transition but stop exposing a bare quantity as current truth once uncertainty exists. Explicitly version/document response semantics and retire routine manual-count screens.

The recommended acceptance criterion is not that every photograph produces an inventory update. It is that supported updates happen automatically, unsupported changes are withheld with useful recapture guidance, and both scan workflows share one auditable state without requiring staff-entered quantities.
