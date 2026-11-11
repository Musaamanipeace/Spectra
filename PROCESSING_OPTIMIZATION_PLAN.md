# Time-Domain Processing Optimization Plan

**Status:** Core latency controls implemented on the working branch; performance remains unbenchmarked.

## What we know

- The queue is bounded at five waiting jobs and now has two asynchronous consumers. Repeated identical browser POSTs are coalesced while the matching task is active.
- A live duplicate-request check returned the same task ID for both POSTs. The task completed and returned a real QR2 tensor (`[3, 6, 29, 29]`, 11 contributing exposures).
- For WISE 0855, live SIA returned 261 QR2 rows and zero QR3 rows. A QR2-only result is correct for that target; requesting QR3 cannot produce data where the archive reports no coverage.
- For a QR3 object with coverage, the S3 fallback returned the required FITS HDUs. A single 1 MiB Range request took about 15 seconds in this development environment. This is one data point, not a service-wide throughput estimate.
- IRSA uses at most two attempts within a shared 45-second deadline, then attempts S3. S3 range reads have a 60-second deadline after the initial range probe. A synchronous range-read thread cannot be forcibly stopped immediately when its awaiting coroutine is cancelled.
- An archive semaphore caps concurrent operations at four across both task workers. Reprojection runs off the event loop with at most two concurrent thread calls.
- Queue wait/depth, stage durations, SIA duration/rows, selected exposure counts, IRSA attempt status/bytes/duration, S3 range count/bytes/cache hits/duration, wavelength matches, and per-exposure outcomes are logged. Metrics are not yet persisted as a benchmark dataset, and fallback bytes are not split by HDU.
- Progress now changes as work reaches each real stage and advances per fetched exposure. The configured cache paths have not yet been measured for hit rate or cold/warm latency.

## Recommended order

### 1. Measure actual task cost

Use the emitted durations and counts for queue wait, SIA by release, SIA rows, selected exposures by release, IRSA attempts, S3 range traffic, wavelength filtering, reprojection, coaddition, and packaging. Add persistent benchmark capture and per-HDU byte accounting. Collect at least 20 cold and 20 warm runs for Barnard's Star, WISE 0855, and a no-coverage coordinate.

### 2. Remove repeated work

- Keep active-request coalescing.
- Cache SIA results for 10 minutes by normalized coordinate cone and release.
- Cache completed tensors for 15 minutes by request fingerprint, not only by random task ID.
- S3 byte ranges are cached in process (64 MiB) by object URL, ETag, and range. Cache hits preserve the source exposure's collection metadata.
- Stop retrying a release after SIA reports zero rows; represent that release as “no coverage”.

### 3. Reduce bytes for Tab 2

- Do not load PSF HDU 5 for Time-Domain Comparator requests; keep PSF retrieval for consumers that perform PSF photometry.
- Keep the current full WCS-WAVE path until a targeted detector-coordinate slice is compared against it. Accept a smaller lookup only when wavelengths and match decisions agree within the science tolerance.
- Give each exposure one total request deadline. Retry a transient IRSA failure once within that budget, then use S3 fallback. Do not spend 90 seconds by restarting the full timeout on attempt two.
- Measure fallback range count and transferred bytes. Choose range block size from observed latency/throughput instead of assuming the current 1 MiB block is efficient.

### 4. Add bounded concurrency

Two asynchronous task workers, one shared archive-I/O semaphore capped at four operations, and two bounded reprojection thread calls are implemented. This can reduce waiting between different requests; it does not make one archive response faster. Preserve the five waiting slots until telemetry shows whether queue depth should change. Threads avoid copying large arrays and WCS objects into child processes; benchmark before considering a process pool.

Do not run multiple Uvicorn processes against the current in-memory queue and task dictionaries. If two async workers are insufficient, first move task state, idempotency keys, and queue claims to a shared durable queue/store, then scale API/worker processes.

### 5. Acceptance and rollback

Use the provisional goals in `SPECIFICATION.md §3.3`: cached identical request p95 below 3 seconds, live covered-target p95 below 120 seconds for at most 18 selected cutouts, and queue-wait p95 below 5 seconds when a slot is free. These are proposed goals, not measured results. If the benchmark misses them, publish the stage breakdown and optimize the largest measured component before adding more workers.

Rollback concurrency to one active task if IRSA 429/503 rates, S3 range failures, memory use, or tensor correctness regress. Retain request coalescing and truthful per-stage progress.
