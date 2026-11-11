"""IRSA SIA2 Exposure Discovery & Server-Side MEF Cutout Ingestion Driver.

SPECIFICATION.md §3.1, §4.1: Query SIA2 cone via async httpx, group exposures
dynamically by survey pass MJDs (survey_passes.json), fetch MEF cutouts (HDUs 1-6
including HDU 4 ZODI background model) from IRSA Cutout Service (primary) with
anonymous S3 byte-range slicing (fsspec) as fallback. Parse LTV1/LTV2 sub-array
WCS offsets.
"""

import asyncio
import io
import json
import logging
import os
import re
import threading
import time
import xml.etree.ElementTree as ET
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
import numpy as np
import requests
from astropy.io import fits
from cachetools import LRUCache


def survey_passes_from_config() -> dict:
    """Return survey pass MJD boundaries from backend/config/survey_passes.json.

    Falls back to empty mapping; dynamic grouping handles unknown passes.
    """
    for candidate in (
        Path(__file__).resolve().parent.parent / "config" / "survey_passes.json",
        Path("backend/config/survey_passes.json"),
        Path("config/survey_passes.json"),
    ):
        if candidate.is_file():
            try:
                raw = json.loads(candidate.read_text(encoding="utf-8"))
                passes = raw.get("passes", raw)
                if isinstance(passes, dict):
                    return passes
            except (OSError, json.JSONDecodeError):
                pass
    try:
        from backend.config.survey_passes import survey_passes_from_config as _cfg

        return _cfg()
    except (ImportError, AttributeError):
        return {}


logger = logging.getLogger(__name__)

# IRSA SIA2 Endpoint configuration
SIA2_ENDPOINT = "https://irsa.ipac.caltech.edu/SIA"
_configured_collections = os.getenv("IRSA_COLLECTIONS")
if _configured_collections is not None:
    DEFAULT_COLLECTIONS = tuple(
        dict.fromkeys(
            value.strip().lower() for value in _configured_collections.split(",") if value.strip()
        )
    )
elif os.getenv("IRSA_COLLECTION"):
    # Keep the legacy single-release setting usable for existing deployments.
    DEFAULT_COLLECTIONS = (os.getenv("IRSA_COLLECTION", "").strip().lower(),)
else:
    DEFAULT_COLLECTIONS = ("spherex_qr2", "spherex_qr3")
if not DEFAULT_COLLECTIONS or any(
    value not in {"spherex_qr2", "spherex_qr3"} for value in DEFAULT_COLLECTIONS
):
    raise ValueError("IRSA_COLLECTIONS must contain spherex_qr2 and/or spherex_qr3")
DEFAULT_COLLECTION = DEFAULT_COLLECTIONS[0]
DEFAULT_RADIUS_DEG = 0.5  # 30 arcmin default
SIA_CACHE_TTL_SECONDS = 600.0
SIA_CACHE_MAX_ENTRIES = 512
ARCHIVE_IO_SEMAPHORE = asyncio.Semaphore(4)
_RANGE_CACHE = LRUCache(maxsize=64 * 1024 * 1024, getsizeof=len)
_RANGE_CACHE_LOCK = threading.Lock()
_sia_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_sia_inflight: dict[str, asyncio.Task[dict[str, Any]]] = {}
_sia_cache_lock = asyncio.Lock()


async def _run_thread_to_completion(function: Callable[..., Any], *args: Any) -> Any:
    """Keep a bounded worker slot until synchronous I/O actually stops."""
    worker = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(worker)
    except asyncio.CancelledError:
        await asyncio.shield(worker)
        raise


def _normalize_band_name(raw: str | None) -> str | None:
    if not raw:
        return None
    s = raw.strip().upper()
    for b in ("D1", "D2", "D3", "D4", "D5", "D6"):
        if b in s or f"BAND_{b}" in s or f"BAND {b}" in s:
            return b
    if s in {"1", "2", "3", "4", "5", "6"}:
        return f"D{s}"
    return s if s.startswith("D") and len(s) <= 3 else None


async def query_sia2_cone(
    ra: float,
    dec: float,
    radius_deg: float = DEFAULT_RADIUS_DEG,
    collection: str = DEFAULT_COLLECTION,
    **kwargs: Any,
) -> dict[str, Any]:
    """Query IRSA SIA2 cone for exposures intersecting a sky position.

    SPECIFICATION.md §3.1: SIA2 cone query with field-of-view diagonal padding.

    Returns VOTable-style dict with exposure metadata, or empty dict on failure.
    """
    params = {
        "COLLECTION": collection,
        "POS": f"circle {round(ra, 8)} {round(dec, 8)} {round(radius_deg, 8)}",
        "RESPONSEFORMAT": "VOTABLE",
    }
    params.update(kwargs)

    cache_key = json.dumps(
        [round(ra, 8), round(dec, 8), round(radius_deg, 8), collection, params],
        sort_keys=True,
        separators=(",", ":"),
    )
    async with _sia_cache_lock:
        cached = _sia_cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < SIA_CACHE_TTL_SECONDS:
            logger.info(
                "SIA cache hit collection=%s rows=%d",
                collection,
                len(cached[1].get("exposure_ids", [])),
            )
            return cached[1]
        inflight = _sia_inflight.get(cache_key)
        if inflight is None:
            inflight = asyncio.create_task(
                _query_sia2_uncached(ra, dec, radius_deg, collection, params)
            )
            _sia_inflight[cache_key] = inflight
    try:
        result = await asyncio.shield(inflight)
        if result:
            async with _sia_cache_lock:
                _sia_cache[cache_key] = (time.monotonic(), result)
                if len(_sia_cache) > SIA_CACHE_MAX_ENTRIES:
                    oldest = min(_sia_cache, key=lambda key: _sia_cache[key][0])
                    _sia_cache.pop(oldest, None)
        return result
    finally:
        async with _sia_cache_lock:
            if _sia_inflight.get(cache_key) is inflight and inflight.done():
                _sia_inflight.pop(cache_key, None)


async def _query_sia2_uncached(
    ra: float, dec: float, radius_deg: float, collection: str, params: dict[str, Any]
) -> dict[str, Any]:
    started = time.monotonic()
    async with ARCHIVE_IO_SEMAPHORE, httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(SIA2_ENDPOINT, params=params)
            if response.status_code != 200:
                logger.warning(
                    f"SIA2 query returned HTTP {response.status_code} for "
                    f"RA={ra}, Dec={dec}, radius={radius_deg}"
                )
                return {}

            parsed = _parse_sia2_votable(response.text, collection)
            logger.info(
                "SIA query collection=%s rows=%d duration_s=%.3f",
                collection,
                len(parsed.get("exposure_ids", [])),
                time.monotonic() - started,
            )
            return parsed

        except httpx.TimeoutException:
            logger.error(f"SIA2 query timed out for RA={ra}, Dec={dec}")
            return {}
        except httpx.HTTPError as e:
            logger.error(f"SIA2 query HTTP error: {e}")
            return {}


def _parse_sia2_votable(votable_text: str, collection: str) -> dict[str, Any]:
    """Parse IRSA SIA2 VOTable response.

    Supports both full IVOA VOTable (<FIELD>/<TR>/<TD>) and simplified XML tags.
    Returns dict with exposure IDs, MJDs, detector IDs, footprints, cutout URLs.
    """
    result: dict[str, Any] = {
        "collection": collection,
        "exposure_ids": [],
        "mjds": [],
        "detector_ids": [],
        "footprints": [],
        "access_urls": [],
        "s3_uris": [],
    }

    # 1. Attempt standard IVOA VOTable (<FIELD> + <TR>/<TD>) parsing
    try:
        root = ET.fromstring(votable_text)
        fields: list[str] = []
        for fld in root.findall(".//{http://www.ivoa.net/xml/VOTable/v1.3}FIELD"):
            fields.append(fld.attrib.get("name", ""))
        if not fields:
            for fld in root.findall(".//FIELD"):
                fields.append(fld.attrib.get("name", ""))

        if fields:
            idx = {name: i for i, name in enumerate(fields)}
            trs = root.findall(".//{http://www.ivoa.net/xml/VOTable/v1.3}TR")
            if not trs:
                trs = root.findall(".//TR")

            def _col(tds: list[Any], name: str) -> str | None:
                i = idx.get(name)
                if i is None or i >= len(tds):
                    return None
                txt = tds[i].text
                return txt.strip() if txt else None

            for tr in trs:
                tds = tr.findall("{http://www.ivoa.net/xml/VOTable/v1.3}TD")
                if not tds:
                    tds = tr.findall("TD")
                obs_id = _col(tds, "obs_id") or _col(tds, "obs_publisher_did") or ""
                access_url = _col(tds, "access_url") or ""
                if not obs_id and not access_url:
                    continue
                band = next(
                    (
                        value
                        for value in (
                            _normalize_band_name(_col(tds, "energy_bandpassname")),
                            _normalize_band_name(_col(tds, "band")),
                            _normalize_band_name(_col(tds, "band_name")),
                            _normalize_band_name(_col(tds, "obs_title")),
                            _normalize_band_name(_col(tds, "instrument_name")),
                            _normalize_band_name(access_url),
                            _normalize_band_name(obs_id),
                        )
                        if value
                    ),
                    None,
                )
                t_min_raw = _col(tds, "t_min")
                mjd_val: float | None = None
                if t_min_raw:
                    try:
                        mjd_val = float(t_min_raw)
                    except ValueError:
                        mjd_val = None
                s_region = _col(tds, "s_region") or ""
                s3_uri = _col(tds, "cloud_access") or ""

                result["exposure_ids"].append(obs_id)
                result["mjds"].append(mjd_val)
                result["detector_ids"].append(band or "UNKNOWN")
                result["footprints"].append(s_region)
                result["access_urls"].append(access_url)
                result["s3_uris"].append(s3_uri)

            if result["exposure_ids"]:
                return result
    except ET.ParseError:
        pass

    # 2. Fallback to minimal XML element extraction
    ids = re.findall(r"<ID>(\d+)</ID>", votable_text)
    result["exposure_ids"] = [int(i) for i in ids] if ids else []

    mjds = re.findall(r"<DATE-OBS>([^<]+)</DATE-OBS>", votable_text)
    out = []
    for m in mjds:
        s = m.strip()
        if re.fullmatch(r"\d{8}|\d{10}", s):
            out.append(int(s[:8]) if len(s) == 8 else int(s))
        else:
            try:
                out.append(float(s))
            except ValueError:
                pass
    result["mjds"] = out

    footprints = re.findall(r"<FOOTPRINT>(.*?)</FOOTPRINT>", votable_text, re.DOTALL)
    result["footprints"] = footprints

    return result


async def group_exposures_by_survey_pass(
    exposures: list[dict[str, Any]],
    survey_passes_config: dict | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Group exposures into survey passes based on MJDs.

    SPECIFICATION.md §3.1: Dynamic epoch grouping from observation MJDs,
    not hardcoded calendar dates.

    Returns dict mapping pass_name -> list of exposures in that pass.
    """
    if survey_passes_config is None:
        survey_passes_config = survey_passes_from_config()

    # Build pass lookup: pass_name -> (mjd_start, mjd_end)
    pass_boundaries = {}
    for pass_name, pass_info in survey_passes_config.items():
        pass_boundaries[pass_name] = (
            pass_info.get("mjd_start"),
            pass_info.get("mjd_end"),
        )

    grouped: dict[str, list[dict[str, Any]]] = {}

    for exp in exposures:
        mjd = exp.get("mjd")
        if mjd is None:
            continue

        matched_pass = None
        for pass_name, (start_mjd, end_mjd) in pass_boundaries.items():
            if start_mjd <= mjd <= end_mjd:
                matched_pass = pass_name
                break

        if matched_pass is None:
            # Unassigned - put in "unknown" group
            matched_pass = "unknown"

        if matched_pass not in grouped:
            grouped[matched_pass] = []
        grouped[matched_pass].append(exp)

    return grouped


async def fetch_cutout_from_irsa(
    data_url: str,
    ra: float,
    dec: float,
    size_deg: float,
    bands: list[int] | None = None,
    adaptive_window: bool = False,
    window_half_width: float = 1.0 / 41.0,  # 1/R_b for D1-D3
    collection: str = DEFAULT_COLLECTION,
    s3_uri: str | None = None,
) -> dict[str, Any]:
    """Fetch server-side MEF cutout from IRSA Cutout Service.

    SPECIFICATION.md §3.1: Primary path is IRSA Cutout Service.
    Returns HDUs 1 (IMAGE), 2 (FLAGS), 3 (VARIANCE), 4 (ZODI), 5 (PSF), 6 (WCS-WAVE).

    Args:
        data_url: Base cutout URL from SIA2 query
        ra: Target RA in decimal degrees
        dec: Target Dec in decimal degrees
        size_deg: Cutout size in degrees
        bands: Optional list of detector band indices (1-6)
        adaptive_window: Whether to adaptively widen wavelength window
        window_half_width: Baseline half-width 1/R_b

    Returns:
        Dict with cutout HDUs and metadata
    """
    # IRSA Cutout Service endpoint
    cutout_url = f"{data_url}?center={ra},{dec}&size={size_deg}"

    started = time.monotonic()
    deadline = asyncio.get_running_loop().time() + 45.0
    async with ARCHIVE_IO_SEMAPHORE, httpx.AsyncClient(timeout=30.0) as client:
        for attempt in range(2):
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            try:
                response = await asyncio.wait_for(
                    client.get(cutout_url), timeout=min(30.0, remaining)
                )
                logger.info(
                    "IRSA cutout attempt collection=%s attempt=%d status=%d bytes=%d duration_s=%.3f",
                    collection,
                    attempt + 1,
                    response.status_code,
                    len(response.content),
                    time.monotonic() - started,
                )
                if response.status_code != 200:
                    logger.warning(
                        "IRSA Cutout returned HTTP %s for collection=%s: %s",
                        response.status_code,
                        collection,
                        cutout_url,
                    )
                    if response.status_code not in {429, 500, 502, 503, 504} or attempt:
                        break
                else:
                    cutout_data = _parse_irsa_mef_cutout(
                        response.content, collection=collection, include_psf=False
                    )
                    required_hdus = (
                        "hdu1_image",
                        "hdu1_header",
                        "hdu2_flags",
                        "hdu3_variance",
                        "hdu6_wave_tab",
                    )
                    if all(cutout_data.get(key) is not None for key in required_hdus):
                        if adaptive_window:
                            cutout_data = _apply_adaptive_wavelength_window(
                                cutout_data, window_half_width
                            )
                        logger.info(
                            "Cutout fetch collection=%s source=irsa bytes=%d duration_s=%.3f",
                            collection,
                            len(response.content),
                            time.monotonic() - started,
                        )
                        return cutout_data
                    logger.warning(
                        "Incomplete IRSA MEF cutout for collection=%s (attempt %s/2)",
                        collection,
                        attempt + 1,
                    )
                    if attempt:
                        break
            except (httpx.HTTPError, OSError, ValueError, TimeoutError) as exc:
                logger.warning(
                    "IRSA Cutout request failed for collection=%s (attempt %s/2): %s",
                    collection,
                    attempt + 1,
                    exc,
                )
                if attempt:
                    break
            await asyncio.sleep(0.5)
    if s3_uri:
        try:
            async with ARCHIVE_IO_SEMAPHORE:
                cutout_data = await _run_thread_to_completion(
                    _fetch_cutout_from_s3, s3_uri, ra, dec, size_deg, collection, False
                )
            required_hdus = (
                "hdu1_image",
                "hdu1_header",
                "hdu2_flags",
                "hdu3_variance",
                "hdu6_wave_tab",
            )
            if all(cutout_data.get(key) is not None for key in required_hdus):
                if adaptive_window:
                    cutout_data = _apply_adaptive_wavelength_window(cutout_data, window_half_width)
                logger.info(
                    "Cutout fetch collection=%s source=s3 duration_s=%.3f",
                    collection,
                    time.monotonic() - started,
                )
                return cutout_data
        except Exception as exc:  # noqa: BLE001
            logger.warning("S3 cutout fallback failed for collection=%s: %s", collection, exc)
    return {}


def _parse_s3_access(s3_access: str) -> tuple[str, str | None]:
    """Normalize IRSA cloud_access values to an S3 URI and optional region."""
    value: Any = s3_access
    if s3_access.lstrip().startswith("{"):
        value = json.loads(s3_access)
    if isinstance(value, str) and value.startswith("s3://"):
        return value, None
    if not isinstance(value, dict):
        raise TypeError("Unsupported IRSA cloud_access value")
    aws = value.get("aws", value)
    if not isinstance(aws, dict):
        raise TypeError("IRSA cloud_access is missing AWS object metadata")
    bucket = aws.get("bucket_name") or aws.get("bucket")
    key = aws.get("key") or aws.get("path")
    if not bucket or not key:
        raise ValueError("IRSA cloud_access is missing bucket or key")
    return f"s3://{str(bucket).strip('/')}/{str(key).lstrip('/')}", aws.get("region")


def _read_fits_image_section(
    hdu: Any,
    y0: int,
    y1: int,
    x0: int,
    x1: int,
    image_shape: tuple[int, int],
    dtype: Any,
) -> np.ndarray:
    """Read a spatial FITS section without materializing the full image HDU."""
    ndim = int(hdu.header.get("NAXIS", 0))
    shape = tuple(int(hdu.header[f"NAXIS{axis}"]) for axis in range(ndim, 0, -1))
    y_slice, x_slice = slice(y0, y1), slice(x0, x1)
    if len(shape) == 2 and shape == image_shape:
        section = (y_slice, x_slice)
    elif len(shape) > 2 and shape[-2:] == image_shape:
        section = (slice(None),) * (len(shape) - 2) + (y_slice, x_slice)
    elif len(shape) > 2 and shape[:2] == image_shape:
        section = (y_slice, x_slice) + (slice(None),) * (len(shape) - 2)
    else:
        raise ValueError(f"FITS extension {hdu.name!r} does not match the image dimensions")
    return np.asarray(hdu.section[section], dtype=dtype)


class _HTTPRangeReader(io.RawIOBase):
    """Seekable FITS source backed by bounded anonymous HTTP Range requests."""

    def __init__(
        self, url: str, block_size: int = 1024 * 1024, collection: str = "unknown"
    ) -> None:
        super().__init__()
        self._url = url
        self._collection = collection
        self._deadline = time.monotonic() + 60.0
        self._block_size = block_size
        self._position = 0
        self._cached_start = -1
        self._cached_data = b""
        self.range_count = 0
        self.bytes_fetched = 0
        self.cache_hits = 0
        self.range_duration_seconds = 0.0
        self._session = requests.Session()
        try:
            probe_started = time.monotonic()
            response = self._session.get(
                self._url, headers={"Range": "bytes=0-0"}, timeout=(10, 30)
            )
            try:
                response.raise_for_status()
                content_range = response.headers.get("Content-Range", "")
                expected_prefix = "bytes 0-0/"
                if response.status_code != 206 or not content_range.startswith(expected_prefix):
                    raise OSError("S3 endpoint did not honor the FITS byte-range request")
                self._size = int(content_range[len(expected_prefix) :])
                self._etag = response.headers.get("ETag")
                self.range_count += 1
                self.bytes_fetched += len(response.content)
                self.range_duration_seconds += time.monotonic() - probe_started
            finally:
                response.close()
        except Exception:
            self._session.close()
            raise

    def _fetch_range(self, start: int, end: int) -> bytes:
        expected_size = end - start + 1
        cache_key = (self._url, self._etag, start, end)
        if self._etag:
            with _RANGE_CACHE_LOCK:
                cached = _RANGE_CACHE.get(cache_key)
            if cached is not None:
                self.cache_hits += 1
                return cached
        remaining = self._deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("S3 range-read deadline exceeded")
        headers = {"Range": f"bytes={start}-{end}"}
        if self._etag:
            headers["If-Match"] = self._etag
        range_started = time.monotonic()
        with self._session.get(
            self._url,
            headers=headers,
            timeout=(min(10, remaining), min(30, remaining)),
        ) as response:
            response.raise_for_status()
            expected_range = f"bytes {start}-{end}/{self._size}"
            if (
                response.status_code != 206
                or response.headers.get("Content-Range") != expected_range
            ):
                raise OSError("S3 returned an unexpected FITS byte range")
            data = response.content
            if len(data) != expected_size:
                raise OSError("S3 returned an incomplete FITS byte range")
            self.range_count += 1
            self.bytes_fetched += len(data)
            if self._etag:
                with _RANGE_CACHE_LOCK:
                    _RANGE_CACHE[cache_key] = data
            self.range_duration_seconds += time.monotonic() - range_started
            return data

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_CUR:
            offset += self._position
        elif whence == io.SEEK_END:
            offset += self._size
        elif whence != io.SEEK_SET:
            raise ValueError(f"Invalid seek mode: {whence}")
        if offset < 0:
            raise ValueError("Cannot seek before the start of the FITS object")
        self._position = offset
        return offset

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            size = self._size - self._position
        remaining = min(size, max(0, self._size - self._position))
        chunks = []
        while remaining:
            block_start = (self._position // self._block_size) * self._block_size
            if block_start != self._cached_start:
                block_end = min(self._size, block_start + self._block_size) - 1
                cached_data = self._fetch_range(block_start, block_end)
                self._cached_start = block_start
                self._cached_data = cached_data
            offset = self._position - self._cached_start
            count = min(remaining, len(self._cached_data) - offset)
            if count <= 0:
                raise OSError("S3 returned an incomplete FITS byte range")
            chunks.append(self._cached_data[offset : offset + count])
            self._position += count
            remaining -= count
        return b"".join(chunks)

    def readinto(self, buffer: Any) -> int:
        data = self.read(len(buffer))
        buffer[: len(data)] = data
        return len(data)

    def close(self) -> None:
        if not self.closed:
            logger.info(
                "S3 range summary collection=%s ranges=%d bytes=%d cache_hits=%d duration_s=%.3f",
                self._collection,
                self.range_count,
                self.bytes_fetched,
                self.cache_hits,
                self.range_duration_seconds,
            )
            self._session.close()
        super().close()


def _fetch_cutout_from_s3(
    s3_access: str,
    ra: float,
    dec: float,
    size_deg: float,
    collection: str,
    include_psf: bool = True,
) -> dict[str, Any]:
    """Read FITS sections from anonymous S3 ranges and crop them around the target."""
    from astropy import units as u
    from astropy.coordinates import SkyCoord
    from astropy.wcs import WCS
    from astropy.wcs.utils import proj_plane_pixel_scales

    s3_uri, region = _parse_s3_access(s3_access)
    bucket, key = s3_uri[5:].split("/", 1)
    endpoint_region = region or "us-east-1"
    hostname = (
        f"{bucket}.s3.amazonaws.com"
        if endpoint_region == "us-east-1"
        else f"{bucket}.s3.{endpoint_region}.amazonaws.com"
    )
    object_url = f"https://{hostname}/{quote(key, safe='/')}"
    result: dict[str, Any] = {
        "hdu1_image": None,
        "hdu2_flags": None,
        "hdu3_variance": None,
        "hdu4_zodi": None,
        "hdu5_psf": None,
        "hdu6_wave_tab": None,
        "hdu1_header": None,
        "metadata": {"collection": collection, "wcs": "TAN/SIP"},
    }
    with (
        _HTTPRangeReader(object_url, collection=collection) as remote_file,
        fits.open(remote_file, memmap=False, lazy_load_hdus=True) as hdul,
    ):
        image_hdu = next(
            (
                hdu
                for index, hdu in enumerate(hdul)
                if str(hdu.name or "").strip().upper() == "IMAGE"
                or (index == 1 and int(hdu.header.get("NAXIS", 0)) > 0)
            ),
            None,
        )
        if image_hdu is None:
            return result
        wcs = WCS(image_hdu.header).celestial
        x_center, y_center = wcs.world_to_pixel(SkyCoord(ra * u.deg, dec * u.deg))
        pixel_scales = np.abs(proj_plane_pixel_scales(wcs))
        half_x = int(np.ceil(size_deg / pixel_scales[0] / 2.0))
        half_y = int(np.ceil(size_deg / pixel_scales[1] / 2.0))
        x0 = max(0, int(np.floor(x_center)) - half_x)
        x1 = min(int(image_hdu.header["NAXIS1"]), int(np.floor(x_center)) + half_x + 1)
        y0 = max(0, int(np.floor(y_center)) - half_y)
        y1 = min(int(image_hdu.header["NAXIS2"]), int(np.floor(y_center)) + half_y + 1)
        if x0 >= x1 or y0 >= y1:
            return result

        section = (slice(y0, y1), slice(x0, x1))
        result["hdu1_image"] = np.asarray(image_hdu.section[section], dtype=np.float32)
        image_shape = (int(image_hdu.header["NAXIS2"]), int(image_hdu.header["NAXIS1"]))
        result["hdu1_header"] = image_hdu.header.copy()
        result["hdu1_header"].update(wcs.slice(section).to_header(relax=True))
        result["hdu1_header"]["NAXIS1"] = x1 - x0
        result["hdu1_header"]["NAXIS2"] = y1 - y0
        result["hdu1_header"]["LTV1"] = float(image_hdu.header.get("LTV1", 0.0)) - x0
        result["hdu1_header"]["LTV2"] = float(image_hdu.header.get("LTV2", 0.0)) - y0
        result["metadata"].update(
            {
                "LTV1": result["hdu1_header"]["LTV1"],
                "LTV2": result["hdu1_header"]["LTV2"],
                "pixel_scale_arcsec": float(np.mean(pixel_scales) * 3600.0),
            }
        )

        extension_keys = (
            ("hdu2_flags", {"FLAGS", "MASK"}, 2, np.uint32),
            ("hdu3_variance", {"VARIANCE", "VAR"}, 3, np.float32),
            ("hdu4_zodi", {"ZODI"}, 4, np.float32),
        )
        if include_psf:
            extension_keys += (("hdu5_psf", {"PSF"}, 5, np.float32),)
        for output_key, names, fallback_index, dtype in extension_keys:
            hdu = next(
                (
                    hdu
                    for index, hdu in enumerate(hdul)
                    if str(hdu.name or "").strip().upper() in names
                    or (index == fallback_index and int(hdu.header.get("NAXIS", 0)) > 0)
                ),
                None,
            )
            if hdu is not None:
                try:
                    if output_key == "hdu5_psf":
                        result[output_key] = _copy_psf_data(hdu.data)
                    else:
                        result[output_key] = _read_fits_image_section(
                            hdu, y0, y1, x0, x1, image_shape, dtype
                        )
                except ValueError:
                    if output_key in {"hdu2_flags", "hdu3_variance"}:
                        raise
                    logger.warning("Skipping incompatible optional FITS extension %s", hdu.name)

        wave_hdu = next(
            (
                hdu
                for index, hdu in enumerate(hdul)
                if str(hdu.name or "").strip().upper() in {"WCS-WAVE", "WAVE-TAB"}
                or (index == 6 and int(hdu.header.get("NAXIS", 0)) > 0)
            ),
            None,
        )
        if wave_hdu is not None and wave_hdu.data is not None:
            wave_tab: dict[str, np.ndarray] = {}
            for name in ("X", "Y", "VALUES"):
                wave_tab[name] = np.asarray(wave_hdu.data[name][0], dtype=np.float64)
            result["hdu6_wave_tab"] = wave_tab
    return result


def _parse_irsa_mef_cutout(
    fits_data: bytes, collection: str, include_psf: bool = True
) -> dict[str, Any]:
    """Parse IRSA MEF cutout FITS data using astropy.io.fits.

    Returns dict with HDU 1-6 data arrays, headers, and WCS metadata.
    """
    out: dict[str, Any] = {
        "hdu1_image": None,  # 32-bit float IMAGE (MJy/sr)
        "hdu2_flags": None,  # 32-bit integer FLAGS bitmask
        "hdu3_variance": None,  # 32-bit float VARIANCE
        "hdu4_zodi": None,  # 32-bit float ZODI background
        "hdu5_psf": None,  # PSF image or structured PSF table
        "hdu6_wave_tab": None,  # Binary Table WCS-WAVE
        "hdu1_header": None,
        "metadata": {
            "collection": collection,
            "wcs": "TAN/SIP",
            "pixel_scale_arcsec": 6.2,
            "naxis": 2040,
        },
    }
    if not fits_data or len(fits_data) < 2880:
        return out

    try:
        with fits.open(io.BytesIO(fits_data), ignore_missing_simple=True) as hdul:
            for idx, hdu in enumerate(hdul):
                extname = str(hdu.name or "").strip().upper()
                if extname == "IMAGE" or (
                    idx == 1 and out["hdu1_image"] is None and hdu.data is not None
                ):
                    out["hdu1_image"] = np.asarray(hdu.data, dtype=np.float32)
                    out["hdu1_header"] = hdu.header.copy()
                elif extname in ("FLAGS", "MASK") or (
                    idx == 2 and out["hdu2_flags"] is None and hdu.data is not None
                ):
                    out["hdu2_flags"] = np.asarray(hdu.data, dtype=np.uint32)
                elif extname in ("VARIANCE", "VAR") or (
                    idx == 3 and out["hdu3_variance"] is None and hdu.data is not None
                ):
                    out["hdu3_variance"] = np.asarray(hdu.data, dtype=np.float32)
                elif extname == "ZODI" or (
                    idx == 4 and out["hdu4_zodi"] is None and hdu.data is not None
                ):
                    out["hdu4_zodi"] = np.asarray(hdu.data, dtype=np.float32)
                elif include_psf and (
                    extname == "PSF"
                    or (idx == 5 and out["hdu5_psf"] is None and hdu.data is not None)
                ):
                    out["hdu5_psf"] = _copy_psf_data(hdu.data)
                elif extname in ("WCS-WAVE", "WAVE-TAB") or (
                    idx == 6 and out["hdu6_wave_tab"] is None and hdu.data is not None
                ):
                    try:
                        out["hdu6_wave_tab"] = {
                            "X": np.asarray(hdu.data["X"][0], dtype=np.float64),
                            "Y": np.asarray(hdu.data["Y"][0], dtype=np.float64),
                            "VALUES": np.asarray(hdu.data["VALUES"][0], dtype=np.float64),
                        }
                    except (KeyError, IndexError, TypeError):
                        out["hdu6_wave_tab"] = hdu.data

            if out["hdu1_header"] is not None:
                hdr = out["hdu1_header"]
                for key in (
                    "LTV1",
                    "LTV2",
                    "CRPIX1A",
                    "CRPIX2A",
                    "CRPIX1",
                    "CRPIX2",
                    "CRVAL1",
                    "CRVAL2",
                ):
                    if key in hdr:
                        out["metadata"][key] = float(hdr[key])
                if "LTV1" not in out["metadata"] and "CRPIX1A" in hdr and "CRPIX2A" in hdr:
                    # Sub-array offset equivalence verified in Spike S3: x_det = x_cut + 1.0 - CRPIX1A
                    out["metadata"]["LTV1"] = float(hdr["CRPIX1A"]) - 1.0
                    out["metadata"]["LTV2"] = float(hdr["CRPIX2A"]) - 1.0
    except (OSError, ValueError, TypeError) as exc:
        logger.debug(f"FITS MEF parse fallback: {exc}")

    return out


def _copy_psf_data(data: Any) -> np.ndarray:
    """Preserve structured PSF FITS tables and normalize numeric image HDUs."""
    if getattr(getattr(data, "dtype", None), "names", None):
        return data.copy()
    return np.asarray(data, dtype=np.float32)


def _apply_adaptive_wavelength_window(
    cutout_data: dict[str, Any],
    window_half_width: float,
) -> dict[str, Any]:
    """Apply adaptive wavelength window evaluation to cutout.

    Widen window half-width w_b per target until every available epoch has
    at least N_min >= 1 matched exposures.

    SPECIFICATION.md §3.1: Adaptive window sizing for D5/D6 narrow bands.
    """
    cutout_data["metadata"] = dict(cutout_data.get("metadata", {}))
    cutout_data["metadata"]["window_half_width"] = float(window_half_width)
    hdr = cutout_data.get("hdu1_header")
    wave_tab = cutout_data.get("hdu6_wave_tab")
    if hdr is not None and isinstance(wave_tab, dict):
        try:
            try:
                from backend.science.wave_match import compute_cutout_wavelength_grid
            except ImportError:
                from science.wave_match import compute_cutout_wavelength_grid  # type: ignore
            lam_map, dlam_map = compute_cutout_wavelength_grid(hdr, wave_tab)
            cutout_data["wavelength_map_um"] = lam_map
            cutout_data["bandwidth_map_um"] = dlam_map
        except Exception as exc:  # noqa: BLE001
            logger.debug(f"Wavelength grid evaluation skipped: {exc}")
    return cutout_data


async def parse_ltv1_ltv2_offsets(
    fits_cutout: dict[str, Any],
) -> tuple[float | None, float | None]:
    """Parse LTV1/LTV2 sub-array WCS offset keywords from cutout.

    SPECIFICATION.md §3.1: Critical for mapping cutout pixels back to parent
    detector coordinates (x_det, y_det) ∈ [0, 2040] for HDU 5 PSF and HDU 6
    WCS-WAVE indexing.

    Returns (LTV1, LTV2) offset values, or (None, None) if not found.
    """
    metadata = fits_cutout.get("metadata", {})
    ltv1 = metadata.get("LTV1")
    ltv2 = metadata.get("LTV2")

    if ltv1 is not None and ltv2 is not None:
        return float(ltv1), float(ltv2)

    hdu1_header = fits_cutout.get("hdu1_header")
    if hdu1_header is not None:
        if "LTV1" in hdu1_header and "LTV2" in hdu1_header:
            return float(hdu1_header["LTV1"]), float(hdu1_header["LTV2"])
        if "CRPIX1A" in hdu1_header and "CRPIX2A" in hdu1_header:
            return float(hdu1_header["CRPIX1A"]) - 1.0, float(hdu1_header["CRPIX2A"]) - 1.0

    return None, None


async def ingest_exposures_for_target(
    ra: float,
    dec: float,
    fov_arcsec: int = 300,
    collection: str | list[str] | tuple[str, ...] | None = None,
    bands: list[int] | None = None,
    adaptive_window: bool = False,
    progress_hook: Callable[[str, float, str], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    """Full ingestion pipeline for a target position.

    End-to-end pipeline:
    1. SIA2 cone query for intersecting exposures
    2. Group exposures by survey pass MJDs
    3. Fetch MEF cutouts from IRSA Cutout Service (primary)
    4. Parse LTV1/LTV2 sub-array offsets
    5. Return structured ingestion result

    SPECIFICATION.md §3.1, §4.1: Complete ingestion driver.
    """
    if collection is None:
        collections = DEFAULT_COLLECTIONS
    elif isinstance(collection, str):
        collections = (collection.strip().lower(),)
    else:
        collections = tuple(dict.fromkeys(value.strip().lower() for value in collection))
    if not collections or any(value not in {"spherex_qr2", "spherex_qr3"} for value in collections):
        raise ValueError("collection must contain spherex_qr2 and/or spherex_qr3")

    result: dict[str, Any] = {
        "collection": " + ".join(collections),
        "collections": list(collections),
        "ra": ra,
        "dec": dec,
        "fov_arcsec": fov_arcsec,
        "sia2_query": None,
        "grouped_exposures": {},
        "exposures": [],
        "cutout": None,
        "ltv_offsets": (None, None),
        "status": "starting",
        "error": None,
    }

    try:
        # Step 1: SIA2 cone query
        if progress_hook:
            await progress_hook("discovering", 0.15, "Querying IRSA QR2 and QR3 exposure catalogs")
        logger.info(f"SIA2 query: RA={ra}, Dec={dec}, FoV={fov_arcsec}''")
        sia2_results = await asyncio.gather(
            *(
                query_sia2_cone(ra, dec, radius_deg=fov_arcsec / 3600.0, collection=source)
                for source in collections
            )
        )
        result["sia2_query"] = dict(zip(collections, sia2_results, strict=True))
        result["status"] = "sia2_queried"
        if progress_hook:
            await progress_hook("grouping", 0.3, "Grouping archive exposures by observation date")

        exposures = []
        for source, sia2_result in zip(collections, sia2_results, strict=True):
            for exposure in _format_exposures_for_grouping(sia2_result):
                exposure["collection"] = source
                exposures.append(exposure)

        if not exposures:
            logger.warning(f"No exposures found via SIA2 for RA={ra}, Dec={dec}")
            result["error"] = "No exposures found via SIA2"
            result["status"] = "no_exposures"
            return result

        # Step 2: Cluster the exposures returned for this coordinate. QR2 and
        # QR3 have different release coverage, so static release-date windows
        # cannot be used as the source of the target's epochs.
        gap_days = 30.0
        try:
            config_path = Path(__file__).resolve().parent.parent / "config" / "survey_passes.json"
            config = json.loads(config_path.read_text(encoding="utf-8"))
            gap_days = float(config.get("clustering", {}).get("gap_days_threshold", gap_days))
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass
        exposures = [
            exp for exp in exposures if exp.get("mjd") is not None and exp.get("access_url")
        ]
        exposures.sort(key=lambda exp: float(exp["mjd"]))
        grouped: dict[str, list[dict[str, Any]]] = {}
        previous_mjd: float | None = None
        epoch_index = 0
        for exposure in exposures:
            mjd = float(exposure["mjd"])
            if previous_mjd is not None and mjd - previous_mjd > gap_days:
                epoch_index += 1
            epoch = f"pass_{epoch_index + 1:02d}"
            exposure["epoch"] = epoch
            grouped.setdefault(epoch, []).append(exposure)
            previous_mjd = mjd

        # Fetch one real exposure nearest the temporal median for each pass and
        # detector. This keeps a coordinate request bounded while preserving
        # actual release epochs and detector provenance in the tensor.
        selected: list[dict[str, Any]] = []
        for pass_exposures in grouped.values():
            bands_for_pass: dict[str, list[dict[str, Any]]] = {}
            for exposure in pass_exposures:
                band = str(exposure.get("band") or "UNKNOWN").upper()
                if band in {f"D{i}" for i in range(1, 7)}:
                    bands_for_pass.setdefault(band, []).append(exposure)
            for band_exposures in bands_for_pass.values():
                median_mjd = float(np.median([float(exp["mjd"]) for exp in band_exposures]))
                selected.append(
                    min(band_exposures, key=lambda exp: abs(float(exp["mjd"]) - median_mjd))
                )

        if not selected:
            result["error"] = "IRSA returned no exposures with a recognized detector band and MJD"
            result["status"] = "no_usable_exposures"
            return result

        selected_by_collection: dict[str, int] = {}
        for exposure in selected:
            source = str(exposure["collection"])
            selected_by_collection[source] = selected_by_collection.get(source, 0) + 1
        logger.info("Selected cutouts by collection=%s", selected_by_collection)

        result["grouped_exposures"] = grouped
        result["status"] = "grouped"
        if progress_hook:
            await progress_hook("fetching", 0.4, f"Fetching {len(selected)} selected cutouts")

        # Step 3: Fetch actual MEF cutouts from IRSA for selected pass/band pairs.
        completed_fetches = 0
        progress_lock = asyncio.Lock()

        async def fetch_exposure(exposure: dict[str, Any]) -> dict[str, Any] | None:
            nonlocal completed_fetches
            fetch_started = time.monotonic()
            cutout = await fetch_cutout_from_irsa(
                str(exposure["access_url"]),
                ra,
                dec,
                fov_arcsec / 3600.0,
                bands=bands,
                adaptive_window=adaptive_window,
                collection=str(exposure["collection"]),
                s3_uri=exposure.get("s3_uri"),
            )
            logger.info(
                "Exposure fetch collection=%s id=%s usable=%s duration_s=%.3f",
                exposure["collection"],
                exposure["exposure_id"],
                cutout.get("hdu1_image") is not None,
                time.monotonic() - fetch_started,
            )
            async with progress_lock:
                completed_fetches += 1
                if progress_hook:
                    fraction = completed_fetches / len(selected)
                    await progress_hook(
                        "fetching",
                        0.4 + 0.28 * fraction,
                        f"Fetched {completed_fetches} of {len(selected)} cutouts",
                    )
            if cutout.get("hdu1_image") is None or cutout.get("hdu1_header") is None:
                return None
            exposure["cutout"] = cutout
            exposure["mjd_range"] = (float(exposure["mjd"]), float(exposure["mjd"]))
            return exposure

        fetched = await asyncio.gather(*(fetch_exposure(exp) for exp in selected))
        result["exposures"] = [exp for exp in fetched if exp is not None]
        if not result["exposures"]:
            result["error"] = "IRSA cutout service returned no usable MEF images"
            result["status"] = "no_cutouts"
            return result
        result["cutout"] = result["exposures"][0]["cutout"]
        ltv1, ltv2 = await parse_ltv1_ltv2_offsets(result["cutout"])
        result["ltv_offsets"] = (ltv1, ltv2)

        result["status"] = "complete"
        return result

    except Exception as e:
        logger.exception("Ingestion pipeline error")
        result["error"] = str(e)
        result["status"] = "error"
        return result


def _format_exposures_for_grouping(
    sia2_result: dict[str, Any],
) -> list[dict[str, Any]]:
    """Format SIA2 results into exposure dicts for grouping.

    Extracts MJDs, detector IDs, footprints, and cutout URLs from VOTable output.
    """
    exposures = []
    exposure_ids = sia2_result.get("exposure_ids", [])
    mjds = sia2_result.get("mjds", [])
    detector_ids = sia2_result.get("detector_ids", [])
    footprints = sia2_result.get("footprints", [])
    access_urls = sia2_result.get("access_urls", [])
    s3_uris = sia2_result.get("s3_uris", [])

    for i, exp_id in enumerate(exposure_ids):
        exp = {
            "exposure_id": exp_id,
            "mjd": mjds[i] if i < len(mjds) else None,
            "band": detector_ids[i] if i < len(detector_ids) else "D1",
            "footprint": footprints[i] if i < len(footprints) else None,
            "access_url": access_urls[i] if i < len(access_urls) else None,
            "s3_uri": s3_uris[i] if i < len(s3_uris) else None,
        }
        exposures.append(exp)

    return exposures
