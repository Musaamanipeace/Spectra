# Time-Domain Processing Optimization Plan

**Status:** Proposed. This plan does not claim the proposed concurrency or cache layers are already implemented.

## What we know

- The queue is bounded at five waiting jobs and currently has one active queue consumer. Repeated identical browser POSTs could consume multiple queue slots; request coalescing now prevents that case.
- A live duplicate-request check returned the same task ID for both POSTs. The task completed and returned a real QR2 tensor (`[3, 6, 29, 29]`, 11 contributing exposures).
- For WISE 0855, live SIA returned 261 QR2 rows and zero QR3 rows. A QR2-only result is correct for that target; requesting QR3 cannot produce data where the archive reports no coverage.
- For a QR3 object with coverage, the S3 fallback returned the required FITS HDUs. A single 1 MiB Range request took about 15 seconds in this development environment. This is one data point, not a service-wide throughput estimate.
- Each IRSA cutout attempt can wait up to 45 seconds and gets one retry. A selected exposure can therefore occupy the task for up to 90 seconds before S3 fallback. The task fetches up to four selected exposures concurrently, but the semaphore is currently per task.
- Stage timers are not recorded. Progress is advanced through all stage labels before the actual ingestion work begins, so the UI does not accurately report where the time goes.

## Recommended order

### 1. Measure actual task cost

Add structured durations and counts for queue wait, SIA by release, SIA row count, selected exposures by release, each IRSA attempt, fallback bytes/ranges per HDU, wavelength filtering, reprojection, coaddition, and packaging. Update progress only when the corresponding stage starts and finishes. Collect at least 20 cold and 20 warm runs for Barnard's Star, WISE 0855, and a no-coverage coordinate.

### 2. Remove repeated work

- Keep active-request coalescing.
- Cache SIA results for 10 minutes by normalized coordinate cone and release.
- Cache completed tensors for 15 minutes by request fingerprint, not only by random task ID.
- Add a bounded source-object cache keyed by object URL and ETag. Cache hits must preserve the exposure's release badge.
- Stop retrying a release after SIA reports zero rows; represent that release as “no coverage”.

### 3. Reduce bytes for Tab 2

- Do not load PSF HDU 5 for Time-Domain Comparator requests; keep PSF retrieval for consumers that perform PSF photometry.
- Keep the current full WCS-WAVE path until a targeted detector-coordinate slice is compared against it. Accept a smaller lookup only when wavelengths and match decisions agree within the science tolerance.
- Give each exposure one total request deadline. Retry a transient IRSA failure once within that budget, then use S3 fallback. Do not spend 90 seconds by restarting the full timeout on attempt two.
- Measure fallback range count and transferred bytes. Choose range block size from observed latency/throughput instead of assuming the current 1 MiB block is efficient.

### 4. Add bounded concurrency

After the baseline, run two asynchronous task workers in one FastAPI process, with one shared archive-I/O semaphore capped at four requests. Keep CPU-heavy reprojection in a two-worker process pool. This reduces waiting between different requests; it does not make one archive response faster. Preserve the five waiting slots until telemetry shows whether queue depth should change.

Do not run multiple Uvicorn processes against the current in-memory queue and task dictionaries. If two async workers are insufficient, first move task state, idempotency keys, and queue claims to a shared durable queue/store, then scale API/worker processes.

### 5. Acceptance and rollback

Use the provisional goals in `SPECIFICATION.md §3.3`: cached identical request p95 below 3 seconds, live covered-target p95 below 120 seconds for at most 18 selected cutouts, and queue-wait p95 below 5 seconds when a slot is free. These are proposed goals, not measured results. If the benchmark misses them, publish the stage breakdown and optimize the largest measured component before adding more workers.

Rollback concurrency to one active task if IRSA 429/503 rates, S3 range failures, memory use, or tensor correctness regress. Retain request coalescing and truthful per-stage progress.
