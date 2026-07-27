#!/usr/bin/env python3
"""Validate Lenia review and refinement documents before publication.

This command intentionally uses only the Python standard library so it can run
on a cluster login node without installing the website's Node dependencies.
Its structural and semantic checks mirror src/data/validators.ts and
src/data/semantics.ts.  It can also verify the size and SHA-256 of auxiliary
media files before they are uploaded.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import ipaddress
import json
import math
import re
import struct
import sys
import zlib
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import urlsplit


SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
POINT_ID_RE = re.compile(r"^triple_[0-9]{5}$")
ASSET_PREFIX_RE = re.compile(r"^(?:media|repro)/v1/")
CONTROL_CHARACTER_RE = re.compile(r"[\x00-\x1f\x7f]")
MANUAL_STATUSES = {"self_replicator", "nonreplicator"}
INITIAL_FIELD_FORMATS = {"json", "npy", "png", "webp"}
INITIAL_FIELD_SIDE = 256
INITIAL_FIELD_VALUE_COUNT = INITIAL_FIELD_SIDE * INITIAL_FIELD_SIDE
MAX_INITIAL_FIELD_BYTES = 64 * 1024 * 1024
MAX_NPY_HEADER_BYTES = 64 * 1024
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
NPY_MAGIC = b"\x93NUMPY"
LOAD_FAILED = object()
NOT_PROVIDED = object()

FORBIDDEN_PUBLIC_TEXT = (
    re.compile(r"/n/(?:home|holylabs|netscratch)", re.IGNORECASE),
    re.compile(r"[a-z]:\\", re.IGNORECASE),
    re.compile(r"secret[_-]?access[_-]?key", re.IGNORECASE),
    re.compile(r"access[_-]?key[_-]?id", re.IGNORECASE),
    re.compile(r"api[_-]?token", re.IGNORECASE),
    re.compile(r"hf_[a-z0-9]+", re.IGNORECASE),
)


@dataclass(frozen=True)
class AssetReference:
    label: str
    key: str
    sha256: str
    bytes: int
    asset_kind: str | None = None
    initial_field_format: str | None = None


@dataclass
class ValidationResult:
    issues: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    assets: list[AssetReference] = field(default_factory=list)
    review_count: int = 0
    neighborhood_count: int = 0
    sample_count: int = 0

    def issue(self, path: str, message: str) -> None:
        self.issues.append(f"{path}: {message}")

    def warning(self, path: str, message: str) -> None:
        self.warnings.append(f"{path}: {message}")


def _reject_non_json_constant(value: str) -> None:
    raise ValueError(f"{value} is not a valid finite JSON number")


def load_json(path: Path, label: str, result: ValidationResult) -> Any:
    try:
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle, parse_constant=_reject_non_json_constant)
    except FileNotFoundError:
        result.issue(label, f"file does not exist: {path}")
    except (
        OSError,
        UnicodeError,
        json.JSONDecodeError,
        ValueError,
        RecursionError,
    ) as error:
        result.issue(label, f"could not read valid UTF-8 JSON: {error}")
    return LOAD_FAILED


def _is_integer(value: Any) -> bool:
    if not isinstance(value, int) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(float(value))
    except OverflowError:
        return False


def _is_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return _is_integer(value)
    return isinstance(value, float) and math.isfinite(value)


def _expect_object(
    value: Any,
    path: str,
    result: ValidationResult,
    *,
    required: Iterable[str],
    allowed: Iterable[str],
) -> Mapping[str, Any] | None:
    if not isinstance(value, dict):
        result.issue(path, "must be an object")
        return None
    required_set = set(required)
    allowed_set = set(allowed)
    for name in sorted(required_set - value.keys()):
        result.issue(path, f"missing required field {name!r}")
    for name in sorted(value.keys() - allowed_set):
        result.issue(path, f"unexpected field {name!r}")
    return value


def _expect_array(
    value: Any,
    path: str,
    result: ValidationResult,
    *,
    minimum: int | None = None,
    exact: int | None = None,
) -> Sequence[Any] | None:
    if not isinstance(value, list):
        result.issue(path, "must be an array")
        return None
    if minimum is not None and len(value) < minimum:
        result.issue(path, f"must contain at least {minimum} item(s)")
    if exact is not None and len(value) != exact:
        result.issue(path, f"must contain exactly {exact} items")
    return value


def _expect_string(
    value: Any,
    path: str,
    result: ValidationResult,
    *,
    minimum_length: int = 0,
    pattern: re.Pattern[str] | None = None,
) -> bool:
    if not isinstance(value, str):
        result.issue(path, "must be a string")
        return False
    if len(value) < minimum_length:
        result.issue(path, f"must contain at least {minimum_length} character(s)")
        return False
    if pattern is not None and pattern.fullmatch(value) is None:
        result.issue(path, f"has invalid format; expected {pattern.pattern}")
        return False
    return True


def _expect_integer(
    value: Any,
    path: str,
    result: ValidationResult,
    *,
    minimum: int | None = None,
) -> bool:
    if not _is_integer(value):
        result.issue(path, "must be an integer")
        return False
    if minimum is not None and value < minimum:
        result.issue(path, f"must be at least {minimum}")
        return False
    return True


def _expect_number(
    value: Any,
    path: str,
    result: ValidationResult,
    *,
    exclusive_minimum: float | None = None,
) -> bool:
    if not _is_number(value):
        result.issue(path, "must be a finite number")
        return False
    if exclusive_minimum is not None and value <= exclusive_minimum:
        result.issue(path, f"must be greater than {exclusive_minimum}")
        return False
    return True


def is_safe_asset_key(key: str) -> bool:
    """Match the browser's src/data/urls.ts asset-key policy."""

    if ASSET_PREFIX_RE.match(key) is None:
        return False
    if (
        key.startswith("/")
        or "\\" in key
        or "?" in key
        or "#" in key
        or "%" in key
        or CONTROL_CHARACTER_RE.search(key) is not None
    ):
        return False
    return all(segment not in {"", ".", ".."} for segment in key.split("/"))


def _contains_forbidden_public_text(value: Any) -> bool:
    pending = [value]
    while pending:
        current = pending.pop()
        if isinstance(current, str):
            if any(pattern.search(current) for pattern in FORBIDDEN_PUBLIC_TEXT):
                return True
        elif isinstance(current, list):
            pending.extend(current)
        elif isinstance(current, dict):
            pending.extend(current.keys())
            pending.extend(current.values())
    return False


def _validate_asset(
    value: Any,
    kind: str,
    path: str,
    field_size: int,
    result: ValidationResult,
) -> None:
    required_by_kind = {
        "poster": {"key", "sha256", "bytes", "width", "height"},
        "video": {
            "key",
            "sha256",
            "bytes",
            "width",
            "height",
            "frames",
            "fps",
            "scored_updates",
            "replay_updates",
        },
        "parameters": {"key", "sha256", "bytes"},
        "initial_field": {
            "key",
            "sha256",
            "bytes",
            "format",
            "width",
            "height",
        },
    }
    allowed_by_kind = {
        "poster": required_by_kind["poster"] | {"source"},
        "video": required_by_kind["video"] | {"source"},
        "parameters": required_by_kind["parameters"] | {"source", "format"},
        "initial_field": required_by_kind["initial_field"]
        | {"source", "value_min", "value_max"},
    }
    asset = _expect_object(
        value,
        path,
        result,
        required=required_by_kind[kind],
        allowed=allowed_by_kind[kind],
    )
    if asset is None:
        return

    key_ok = False
    sha_ok = False
    bytes_ok = False
    if "key" in asset:
        key_ok = _expect_string(asset["key"], f"{path}.key", result)
        if key_ok:
            # The schema checks the prefix; semantics enforce the full policy.
            if ASSET_PREFIX_RE.match(asset["key"]) is None:
                result.issue(
                    f"{path}.key", "must begin with media/v1/ or repro/v1/"
                )
            elif not is_safe_asset_key(asset["key"]):
                result.issue(f"{path}.key", "is not a safe relative object key")
            else:
                key_ok = True
    if "sha256" in asset:
        sha_ok = _expect_string(
            asset["sha256"], f"{path}.sha256", result, pattern=SHA256_RE
        )
    if "bytes" in asset:
        bytes_ok = _expect_integer(
            asset["bytes"], f"{path}.bytes", result, minimum=1
        )
    if "source" in asset:
        _expect_string(
            asset["source"], f"{path}.source", result, minimum_length=1
        )

    if kind in {"poster", "video", "initial_field"}:
        for dimension in ("width", "height"):
            if dimension in asset:
                _expect_integer(
                    asset[dimension],
                    f"{path}.{dimension}",
                    result,
                    minimum=1,
                )
    if kind == "video":
        if "frames" in asset:
            _expect_integer(asset["frames"], f"{path}.frames", result, minimum=1)
        if "fps" in asset:
            _expect_number(
                asset["fps"], f"{path}.fps", result, exclusive_minimum=0
            )
        if "scored_updates" in asset and asset["scored_updates"] != 800:
            result.issue(f"{path}.scored_updates", "must equal 800")
        if "replay_updates" in asset and asset["replay_updates"] != 1000:
            result.issue(f"{path}.replay_updates", "must equal 1000")
    elif kind == "parameters" and "format" in asset:
        _expect_string(
            asset["format"], f"{path}.format", result, minimum_length=1
        )
    elif kind == "initial_field":
        if "format" in asset:
            if not isinstance(asset["format"], str):
                result.issue(f"{path}.format", "must be a string")
            elif asset["format"] not in INITIAL_FIELD_FORMATS:
                result.issue(
                    f"{path}.format",
                    "must be one of json, npy, png, or webp",
                )
        for bound in ("value_min", "value_max"):
            if bound in asset:
                _expect_number(asset[bound], f"{path}.{bound}", result)
        if (
            _is_integer(asset.get("width"))
            and _is_integer(asset.get("height"))
            and (
                asset["width"] != field_size
                or asset["height"] != field_size
            )
        ):
            result.issue(
                path,
                f"initial field must be {field_size}x{field_size}",
            )

    if (
        key_ok
        and isinstance(asset.get("key"), str)
        and is_safe_asset_key(asset["key"])
        and sha_ok
        and bytes_ok
    ):
        if PurePosixPath(asset["key"]).stem != asset["sha256"]:
            result.issue(
                f"{path}.key",
                "filename stem must equal the descriptor SHA-256",
            )
        result.assets.append(
            AssetReference(
                label=path,
                key=asset["key"],
                sha256=asset["sha256"],
                bytes=asset["bytes"],
                asset_kind=kind,
                initial_field_format=(
                    asset.get("format")
                    if kind == "initial_field"
                    and isinstance(asset.get("format"), str)
                    else None
                ),
            )
        )


def _validate_overlay_media(
    value: Any,
    path: str,
    field_size: int,
    result: ValidationResult,
) -> None:
    media = _expect_object(
        value,
        path,
        result,
        required=(),
        allowed=("poster", "video", "parameters", "initial_field"),
    )
    if media is None:
        return
    for kind in ("poster", "video", "parameters", "initial_field"):
        if kind not in media or media[kind] is None:
            continue
        _validate_asset(media[kind], kind, f"{path}.{kind}", field_size, result)


def _validate_optional_asset_base_url(
    document: Mapping[str, Any], path: str, result: ValidationResult
) -> None:
    if "asset_base_url" not in document:
        return
    value = document["asset_base_url"]
    if _expect_string(value, f"{path}.asset_base_url", result):
        if value == "":
            return
        url_path = f"{path}.asset_base_url"
        if (
            value != value.strip()
            or CONTROL_CHARACTER_RE.search(value) is not None
            or "\\" in value
            or "?" in value
            or "#" in value
        ):
            result.issue(
                url_path,
                "must be a clean absolute HTTPS URL without whitespace, "
                "controls, backslashes, query, or fragment",
            )
            return
        try:
            parsed = urlsplit(value)
            port = parsed.port
        except ValueError:
            result.issue(
                url_path,
                "must be empty or a valid absolute HTTPS URL",
            )
            return
        hostname = parsed.hostname
        if (
            not value.startswith("https://")
            or parsed.scheme != "https"
            or not parsed.netloc
            or not hostname
            or parsed.username is not None
            or parsed.password is not None
        ):
            result.issue(
                url_path,
                "must be empty or a credential-free absolute HTTPS URL",
            )
            return
        authority = value.split("/", 3)[2]
        if (
            "%" in authority
            or any(character.isspace() for character in authority)
        ):
            result.issue(
                url_path,
                "authority contains invalid characters",
            )
            return
        try:
            ascii_hostname = hostname.encode("idna").decode("ascii")
            if ":" in hostname:
                ipaddress.IPv6Address(hostname)
            elif re.fullmatch(r"[0-9.]+", hostname):
                ipaddress.IPv4Address(hostname)
            else:
                labels = ascii_hostname.rstrip(".").split(".")
                if (
                    len(ascii_hostname) > 253
                    or any(
                        re.fullmatch(
                            r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?",
                            label,
                        )
                        is None
                        for label in labels
                    )
                ):
                    raise ValueError("invalid DNS hostname")
        except (UnicodeError, ValueError):
            result.issue(url_path, "contains an invalid hostname")
            return
        if port is not None and not 0 <= port <= 65535:
            result.issue(url_path, "contains an invalid port")


def _validate_optional_manifest_digest(
    document: Mapping[str, Any],
    path: str,
    manifest_sha256: str,
    result: ValidationResult,
) -> None:
    if "based_on_manifest_sha256" not in document:
        return
    value = document["based_on_manifest_sha256"]
    if _expect_string(
        value,
        f"{path}.based_on_manifest_sha256",
        result,
        pattern=SHA256_RE,
    ) and value != manifest_sha256:
        result.issue(
            f"{path}.based_on_manifest_sha256",
            "targets a different manifest snapshot",
        )


def _manifest_context(
    manifest: Any, result: ValidationResult
) -> tuple[str, str, int, dict[str, str]] | None:
    path = "site-manifest"
    if not isinstance(manifest, dict):
        result.issue(path, "must be an object")
        return None

    required = (
        "schema_version",
        "dataset_id",
        "manifest_sha256",
        "search_configuration",
        "points",
    )
    for name in required:
        if name not in manifest:
            result.issue(path, f"missing required field {name!r}")
    if any(name not in manifest for name in required):
        return None

    if manifest["schema_version"] != 1 or isinstance(
        manifest["schema_version"], bool
    ):
        result.issue(f"{path}.schema_version", "must equal 1")
    dataset_ok = _expect_string(
        manifest["dataset_id"], f"{path}.dataset_id", result, minimum_length=1
    )
    digest_ok = _expect_string(
        manifest["manifest_sha256"],
        f"{path}.manifest_sha256",
        result,
        pattern=SHA256_RE,
    )

    search = manifest["search_configuration"]
    field_size: int | None = None
    if not isinstance(search, dict):
        result.issue(f"{path}.search_configuration", "must be an object")
    elif "field_size" not in search:
        result.issue(
            f"{path}.search_configuration", "missing required field 'field_size'"
        )
    elif _expect_integer(
        search["field_size"],
        f"{path}.search_configuration.field_size",
        result,
        minimum=1,
    ):
        field_size = search["field_size"]
        if field_size != 256:
            result.issue(
                f"{path}.search_configuration.field_size",
                "must equal the site contract value 256",
            )

    points = manifest["points"]
    point_classifications: dict[str, str] = {}
    if not isinstance(points, list):
        result.issue(f"{path}.points", "must be an array")
    else:
        for index, point in enumerate(points):
            point_path = f"{path}.points[{index}]"
            if not isinstance(point, dict):
                result.issue(point_path, "must be an object")
                continue
            if "id" not in point or "classification" not in point:
                result.issue(
                    point_path, "must contain id and classification fields"
                )
                continue
            point_id = point["id"]
            classification = point["classification"]
            id_ok = _expect_string(
                point_id, f"{point_path}.id", result, pattern=POINT_ID_RE
            )
            if not isinstance(classification, str) or classification not in {
                "excluded_by_m_local_cutoff",
                "experimentally_dead",
                "dynamics_unresolved",
            }:
                result.issue(
                    f"{point_path}.classification",
                    "is not a recognized base classification",
                )
            if id_ok:
                if point_id in point_classifications:
                    result.issue(f"{point_path}.id", f"duplicates point {point_id}")
                else:
                    point_classifications[point_id] = classification

    if not dataset_ok or not digest_ok or field_size is None:
        return None
    return (
        manifest["dataset_id"],
        manifest["manifest_sha256"],
        field_size,
        point_classifications,
    )


def validate_review_overlay(
    overlay: Any,
    *,
    dataset_id: str,
    manifest_sha256: str,
    field_size: int,
    point_classifications: Mapping[str, str],
    result: ValidationResult,
) -> None:
    path = "review-overlay"
    document = _expect_object(
        overlay,
        path,
        result,
        required=("schema_version", "dataset_id", "reviews"),
        allowed=(
            "schema_version",
            "dataset_id",
            "asset_base_url",
            "based_on_manifest_sha256",
            "reviews",
        ),
    )
    if document is None:
        return
    if "schema_version" in document and (
        document["schema_version"] != 1
        or isinstance(document["schema_version"], bool)
    ):
        result.issue(f"{path}.schema_version", "must equal 1")
    if "dataset_id" in document:
        if _expect_string(
            document["dataset_id"],
            f"{path}.dataset_id",
            result,
            minimum_length=1,
        ) and document["dataset_id"] != dataset_id:
            result.issue(
                f"{path}.dataset_id", "does not match the site manifest"
            )
    _validate_optional_asset_base_url(document, path, result)
    _validate_optional_manifest_digest(
        document, path, manifest_sha256, result
    )

    reviews = document.get("reviews")
    if not isinstance(reviews, list):
        if "reviews" in document:
            result.issue(f"{path}.reviews", "must be an array")
    else:
        result.review_count = len(reviews)
        reviewed: set[str] = set()
        for index, value in enumerate(reviews):
            review_path = f"{path}.reviews[{index}]"
            review = _expect_object(
                value,
                review_path,
                result,
                required=("point_id", "status"),
                allowed=("point_id", "status", "reviewed_at", "notes", "media"),
            )
            if review is None:
                continue
            point_id = review.get("point_id")
            if "point_id" in review:
                if _expect_string(
                    point_id,
                    f"{review_path}.point_id",
                    result,
                    pattern=POINT_ID_RE,
                ):
                    if point_id not in point_classifications:
                        result.issue(
                            f"{review_path}.point_id",
                            f"references unknown point {point_id}",
                        )
                    elif (
                        point_classifications[point_id]
                        != "dynamics_unresolved"
                    ):
                        result.issue(
                            f"{review_path}.point_id",
                            f"{point_id} is not dynamics_unresolved",
                        )
                    if point_id in reviewed:
                        result.issue(
                            f"{review_path}.point_id",
                            f"duplicates review for {point_id}",
                        )
                    reviewed.add(point_id)
            if "status" in review:
                status = review["status"]
                if (
                    not isinstance(status, str)
                    or status not in MANUAL_STATUSES
                ):
                    result.issue(
                        f"{review_path}.status",
                        "must be self_replicator or nonreplicator",
                    )
            if "reviewed_at" in review:
                _expect_string(
                    review["reviewed_at"],
                    f"{review_path}.reviewed_at",
                    result,
                    minimum_length=1,
                )
            if "notes" in review:
                _expect_string(
                    review["notes"], f"{review_path}.notes", result
                )
            if "media" in review:
                _validate_overlay_media(
                    review["media"],
                    f"{review_path}.media",
                    field_size,
                    result,
                )
    if _contains_forbidden_public_text(overlay):
        result.issue(
            path, "contains a forbidden private-path or secret pattern"
        )


def _validate_refinement_axes(
    value: Any, path: str, result: ValidationResult
) -> dict[str, Sequence[Any]] | None:
    axes = _expect_object(
        value,
        path,
        result,
        required=("m_local", "m_cross", "alpha"),
        allowed=("m_local", "m_cross", "alpha"),
    )
    if axes is None:
        return None
    parsed: dict[str, Sequence[Any]] = {}
    for name in ("m_local", "m_cross", "alpha"):
        if name not in axes:
            continue
        axis_path = f"{path}.{name}"
        values = _expect_array(axes[name], axis_path, result, minimum=1)
        if values is None:
            continue
        parsed[name] = values
        numeric = True
        for index, item in enumerate(values):
            if not _expect_number(item, f"{axis_path}[{index}]", result):
                numeric = False
        if numeric:
            if any(
                values[index] == values[prior]
                for index in range(len(values))
                for prior in range(index)
            ):
                result.issue(axis_path, "must contain unique values")
            if any(
                values[index] <= values[index - 1]
                for index in range(1, len(values))
            ):
                result.issue(axis_path, "must be strictly increasing")
    return parsed


def _validate_coordinates(
    value: Any, path: str, result: ValidationResult
) -> Mapping[str, Any] | None:
    coordinates = _expect_object(
        value,
        path,
        result,
        required=("m_local", "m_cross", "alpha"),
        allowed=("m_local", "m_cross", "alpha"),
    )
    if coordinates is None:
        return None
    for name in ("m_local", "m_cross", "alpha"):
        if name in coordinates:
            _expect_number(coordinates[name], f"{path}.{name}", result)
    return coordinates


def validate_refinement_catalog(
    catalog: Any,
    *,
    dataset_id: str,
    manifest_sha256: str,
    field_size: int,
    point_classifications: Mapping[str, str],
    result: ValidationResult,
) -> None:
    path = "refinement-catalog"
    document = _expect_object(
        catalog,
        path,
        result,
        required=("schema_version", "dataset_id", "neighborhoods"),
        allowed=(
            "schema_version",
            "dataset_id",
            "asset_base_url",
            "based_on_manifest_sha256",
            "neighborhoods",
        ),
    )
    if document is None:
        return
    if "schema_version" in document and (
        document["schema_version"] != 1
        or isinstance(document["schema_version"], bool)
    ):
        result.issue(f"{path}.schema_version", "must equal 1")
    if "dataset_id" in document:
        if _expect_string(
            document["dataset_id"],
            f"{path}.dataset_id",
            result,
            minimum_length=1,
        ) and document["dataset_id"] != dataset_id:
            result.issue(
                f"{path}.dataset_id", "does not match the site manifest"
            )
    _validate_optional_asset_base_url(document, path, result)
    _validate_optional_manifest_digest(
        document, path, manifest_sha256, result
    )

    neighborhoods = document.get("neighborhoods")
    if not isinstance(neighborhoods, list):
        if "neighborhoods" in document:
            result.issue(f"{path}.neighborhoods", "must be an array")
    else:
        result.neighborhood_count = len(neighborhoods)
        neighborhood_ids: set[str] = set()
        center_ids: set[str] = set()
        for index, value in enumerate(neighborhoods):
            neighborhood_path = f"{path}.neighborhoods[{index}]"
            neighborhood = _expect_object(
                value,
                neighborhood_path,
                result,
                required=("id", "center_point_id", "axes", "samples"),
                allowed=(
                    "id",
                    "center_point_id",
                    "axes",
                    "replay_source_point_id",
                    "shared_media",
                    "samples",
                ),
            )
            if neighborhood is None:
                continue
            neighborhood_id = neighborhood.get("id")
            if "id" in neighborhood and _expect_string(
                neighborhood_id,
                f"{neighborhood_path}.id",
                result,
                minimum_length=1,
            ):
                if neighborhood_id in neighborhood_ids:
                    result.issue(
                        f"{neighborhood_path}.id",
                        f"duplicates refinement neighborhood {neighborhood_id}",
                    )
                neighborhood_ids.add(neighborhood_id)

            center_id = neighborhood.get("center_point_id")
            if "center_point_id" in neighborhood and _expect_string(
                center_id,
                f"{neighborhood_path}.center_point_id",
                result,
                pattern=POINT_ID_RE,
            ):
                if center_id not in point_classifications:
                    result.issue(
                        f"{neighborhood_path}.center_point_id",
                        "references an unknown center point",
                    )
                # The browser selects the first matching center.  Rejecting
                # duplicates prevents an otherwise valid but ambiguous catalog.
                if center_id in center_ids:
                    result.issue(
                        f"{neighborhood_path}.center_point_id",
                        f"duplicates refinement center {center_id}",
                    )
                center_ids.add(center_id)

            replay_id = neighborhood.get("replay_source_point_id")
            if "replay_source_point_id" in neighborhood and _expect_string(
                replay_id,
                f"{neighborhood_path}.replay_source_point_id",
                result,
                pattern=POINT_ID_RE,
            ) and replay_id not in point_classifications:
                result.issue(
                    f"{neighborhood_path}.replay_source_point_id",
                    "references an unknown replay source",
                )
            if "shared_media" in neighborhood:
                _validate_overlay_media(
                    neighborhood["shared_media"],
                    f"{neighborhood_path}.shared_media",
                    field_size,
                    result,
                )

            axes = None
            if "axes" in neighborhood:
                axes = _validate_refinement_axes(
                    neighborhood["axes"],
                    f"{neighborhood_path}.axes",
                    result,
                )

            samples_value = neighborhood.get("samples")
            if not isinstance(samples_value, list):
                if "samples" in neighborhood:
                    result.issue(
                        f"{neighborhood_path}.samples", "must be an array"
                    )
                continue
            result.sample_count += len(samples_value)
            sample_indices: set[tuple[int, int, int]] = set()
            for sample_index, value in enumerate(samples_value):
                sample_path = (
                    f"{neighborhood_path}.samples[{sample_index}]"
                )
                sample = _expect_object(
                    value,
                    sample_path,
                    result,
                    required=("grid_index", "coordinates", "status"),
                    allowed=("grid_index", "coordinates", "status", "media"),
                )
                if sample is None:
                    continue
                grid_index: tuple[int, int, int] | None = None
                if "grid_index" in sample:
                    indices = _expect_array(
                        sample["grid_index"],
                        f"{sample_path}.grid_index",
                        result,
                        exact=3,
                    )
                    if indices is not None:
                        indices_ok = True
                        for axis_index, item in enumerate(indices):
                            if not _expect_integer(
                                item,
                                f"{sample_path}.grid_index[{axis_index}]",
                                result,
                                minimum=0,
                            ):
                                indices_ok = False
                        if indices_ok and len(indices) == 3:
                            grid_index = (indices[0], indices[1], indices[2])
                            if grid_index in sample_indices:
                                result.issue(
                                    f"{sample_path}.grid_index",
                                    "duplicates sample "
                                    + ",".join(map(str, grid_index)),
                                )
                            sample_indices.add(grid_index)

                coordinates = None
                if "coordinates" in sample:
                    coordinates = _validate_coordinates(
                        sample["coordinates"],
                        f"{sample_path}.coordinates",
                        result,
                    )
                if "status" in sample:
                    status = sample["status"]
                    if (
                        not isinstance(status, str)
                        or status not in MANUAL_STATUSES
                    ):
                        result.issue(
                            f"{sample_path}.status",
                            "must be self_replicator or nonreplicator",
                        )
                if "media" in sample:
                    _validate_overlay_media(
                        sample["media"],
                        f"{sample_path}.media",
                        field_size,
                        result,
                    )

                if (
                    grid_index is not None
                    and axes is not None
                    and all(name in axes for name in ("m_local", "m_cross", "alpha"))
                ):
                    i, j, k = grid_index
                    axis_values = (
                        axes["m_local"],
                        axes["m_cross"],
                        axes["alpha"],
                    )
                    if any(
                        index_value >= len(axis)
                        for index_value, axis in zip(grid_index, axis_values)
                    ):
                        result.issue(
                            f"{sample_path}.grid_index",
                            "is outside its refinement axes",
                        )
                    elif coordinates is not None and all(
                        name in coordinates
                        and _is_number(coordinates[name])
                        for name in ("m_local", "m_cross", "alpha")
                    ):
                        expected = (
                            axes["m_local"][i],
                            axes["m_cross"][j],
                            axes["alpha"][k],
                        )
                        actual = (
                            coordinates["m_local"],
                            coordinates["m_cross"],
                            coordinates["alpha"],
                        )
                        if actual != expected:
                            result.issue(
                                f"{sample_path}.coordinates",
                                "do not match the values at grid_index",
                            )
    if _contains_forbidden_public_text(catalog):
        result.issue(
            path, "contains a forbidden private-path or secret pattern"
        )


def validate_cross_document_visibility(
    overlay: Any,
    catalog: Any,
    result: ValidationResult,
) -> None:
    """Ensure every refinement can be activated by a green coarse point.

    The website only exposes a neighborhood after its center has a manual
    ``self_replicator`` review.  The TypeScript documents are independently
    valid without this link, but publishing both documents in that state would
    make the refinement data unreachable in the intended UI.
    """

    if not isinstance(overlay, dict) or not isinstance(catalog, dict):
        return
    reviews = overlay.get("reviews")
    neighborhoods = catalog.get("neighborhoods")
    if not isinstance(reviews, list) or not isinstance(neighborhoods, list):
        return
    review_statuses: dict[str, str] = {}
    for review in reviews:
        if not isinstance(review, dict):
            continue
        point_id = review.get("point_id")
        status = review.get("status")
        if isinstance(point_id, str) and isinstance(status, str):
            review_statuses[point_id] = status
    for index, neighborhood in enumerate(neighborhoods):
        if not isinstance(neighborhood, dict):
            continue
        center_id = neighborhood.get("center_point_id")
        if not isinstance(center_id, str):
            continue
        if review_statuses.get(center_id) != "self_replicator":
            result.issue(
                f"refinement-catalog.neighborhoods[{index}].center_point_id",
                f"{center_id} needs a matching self_replicator review "
                "to make the refinement visible",
            )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


class InitialFieldPayloadError(ValueError):
    """Raised when a staged initial-field object cannot be rendered safely."""


def _inspect_json_initial_field(payload: bytes) -> tuple[int, int]:
    try:
        decoded = payload.decode("utf-8-sig")
        document = json.loads(
            decoded,
            parse_constant=_reject_non_json_constant,
        )
    except (
        UnicodeError,
        json.JSONDecodeError,
        ValueError,
        RecursionError,
    ) as error:
        raise InitialFieldPayloadError(
            f"initial-field JSON is not valid finite UTF-8 JSON: {error}"
        ) from error

    candidate = document
    if isinstance(document, dict):
        if "shape" in document:
            shape = document["shape"]
            if (
                not isinstance(shape, list)
                or len(shape) != 2
                or any(
                    not _is_integer(dimension)
                    for dimension in shape
                )
                or shape != [INITIAL_FIELD_SIDE, INITIAL_FIELD_SIDE]
            ):
                raise InitialFieldPayloadError(
                    "initial-field JSON shape must be [256, 256]"
                )
        candidate = None
        for name in ("values", "data", "field"):
            value = document.get(name)
            if value is not None:
                candidate = value
                break

    if not isinstance(candidate, list):
        raise InitialFieldPayloadError(
            "initial-field JSON must contain an array in values, data, "
            "or field"
        )

    is_matrix = (
        len(candidate) == INITIAL_FIELD_SIDE
        and all(
            isinstance(row, list) and len(row) == INITIAL_FIELD_SIDE
            for row in candidate
        )
    )
    if is_matrix:
        values: Iterable[Any] = (
            value for row in candidate for value in row
        )
    elif len(candidate) == INITIAL_FIELD_VALUE_COUNT:
        values = candidate
    else:
        raise InitialFieldPayloadError(
            "initial-field JSON must contain exactly 65,536 values "
            "as a flat array or a 256x256 matrix"
        )

    for index, value in enumerate(values):
        if not _is_number(value):
            raise InitialFieldPayloadError(
                "initial-field JSON contains a non-finite or non-numeric "
                f"value at flat index {index}"
            )
    return INITIAL_FIELD_SIDE, INITIAL_FIELD_SIDE


def _inspect_npy_initial_field(payload: bytes) -> tuple[int, int]:
    if len(payload) < 10 or not payload.startswith(NPY_MAGIC):
        raise InitialFieldPayloadError(
            "initial-field NPY has an invalid or truncated magic header"
        )

    version = (payload[6], payload[7])
    if version == (1, 0):
        header_start = 10
        header_length = int.from_bytes(payload[8:10], "little")
        encoding = "latin1"
    elif version in {(2, 0), (3, 0)}:
        if len(payload) < 12:
            raise InitialFieldPayloadError(
                "initial-field NPY header is truncated"
            )
        header_start = 12
        header_length = int.from_bytes(payload[8:12], "little")
        encoding = "utf-8" if version == (3, 0) else "latin1"
    else:
        raise InitialFieldPayloadError(
            f"initial-field NPY version {version[0]}.{version[1]} "
            "is unsupported"
        )

    if header_length <= 0 or header_length > MAX_NPY_HEADER_BYTES:
        raise InitialFieldPayloadError(
            "initial-field NPY header length is unsupported"
        )
    header_end = header_start + header_length
    if header_end > len(payload):
        raise InitialFieldPayloadError(
            "initial-field NPY header is truncated"
        )
    header_bytes = payload[header_start:header_end]
    if not header_bytes.endswith(b"\n"):
        raise InitialFieldPayloadError(
            "initial-field NPY header must end with a newline"
        )
    try:
        header = ast.literal_eval(header_bytes.decode(encoding).strip())
    except (
        UnicodeError,
        ValueError,
        SyntaxError,
        RecursionError,
        MemoryError,
    ) as error:
        raise InitialFieldPayloadError(
            f"initial-field NPY header dictionary is malformed: {error}"
        ) from error
    if not isinstance(header, dict):
        raise InitialFieldPayloadError(
            "initial-field NPY header must be a dictionary"
        )

    descriptor = header.get("descr")
    fortran_order = header.get("fortran_order")
    shape = header.get("shape")
    if not isinstance(descriptor, str):
        raise InitialFieldPayloadError(
            "initial-field NPY dtype descriptor is missing"
        )
    if fortran_order is not False:
        raise InitialFieldPayloadError(
            "initial-field NPY must use C order, not Fortran order"
        )
    if (
        not isinstance(shape, tuple)
        or len(shape) != 2
        or any(not _is_integer(dimension) for dimension in shape)
        or shape != (INITIAL_FIELD_SIDE, INITIAL_FIELD_SIDE)
    ):
        raise InitialFieldPayloadError(
            "initial-field NPY shape must be (256, 256)"
        )

    if len(descriptor) < 2 or descriptor[0] not in "<>=|":
        raise InitialFieldPayloadError(
            f"initial-field NPY dtype {descriptor!r} is unsupported"
        )
    byte_order = descriptor[0]
    data_type = descriptor[1:]
    type_formats = {
        "f4": ("f", 4),
        "f8": ("d", 8),
        "u1": ("B", 1),
        "u2": ("H", 2),
        "i2": ("h", 2),
        "i4": ("i", 4),
    }
    type_format = type_formats.get(data_type)
    if type_format is None or (
        byte_order == "|" and data_type != "u1"
    ):
        raise InitialFieldPayloadError(
            f"initial-field NPY dtype {descriptor!r} is unsupported"
        )
    format_character, bytes_per_value = type_format
    expected_bytes = INITIAL_FIELD_VALUE_COUNT * bytes_per_value
    data = payload[header_end:]
    if len(data) < expected_bytes:
        raise InitialFieldPayloadError(
            "initial-field NPY numeric data is truncated"
        )
    if len(data) > expected_bytes:
        raise InitialFieldPayloadError(
            "initial-field NPY contains trailing data after the array"
        )

    endian_prefix = ">" if byte_order == ">" else "<"
    unpack_format = (
        format_character
        if bytes_per_value == 1
        else endian_prefix + format_character
    )
    try:
        for index, (value,) in enumerate(
            struct.iter_unpack(unpack_format, data)
        ):
            if isinstance(value, float) and not math.isfinite(value):
                raise InitialFieldPayloadError(
                    "initial-field NPY contains a non-finite value at "
                    f"flat index {index}"
                )
    except struct.error as error:
        raise InitialFieldPayloadError(
            f"initial-field NPY numeric data is malformed: {error}"
        ) from error
    return INITIAL_FIELD_SIDE, INITIAL_FIELD_SIDE


def _png_scanline_layout(
    width: int,
    height: int,
    bits_per_pixel: int,
    interlace: int,
) -> list[tuple[int, int]]:
    if interlace == 0:
        return [((width * bits_per_pixel + 7) // 8, height)]

    layout: list[tuple[int, int]] = []
    adam7_passes = (
        (0, 0, 8, 8),
        (4, 0, 8, 8),
        (0, 4, 4, 8),
        (2, 0, 4, 4),
        (0, 2, 2, 4),
        (1, 0, 2, 2),
        (0, 1, 1, 2),
    )
    for x_start, y_start, x_step, y_step in adam7_passes:
        pass_width = (
            0
            if width <= x_start
            else (width - x_start + x_step - 1) // x_step
        )
        pass_height = (
            0
            if height <= y_start
            else (height - y_start + y_step - 1) // y_step
        )
        if pass_width and pass_height:
            layout.append(
                ((pass_width * bits_per_pixel + 7) // 8, pass_height)
            )
    return layout


def _inspect_png_initial_field(payload: bytes) -> tuple[int, int]:
    if not payload.startswith(PNG_SIGNATURE):
        raise InitialFieldPayloadError(
            "initial-field PNG has an invalid signature"
        )

    offset = len(PNG_SIGNATURE)
    chunks: list[tuple[bytes, bytes]] = []
    seen_iend = False
    while offset < len(payload):
        if len(payload) - offset < 12:
            raise InitialFieldPayloadError(
                "initial-field PNG chunk header is truncated"
            )
        length = int.from_bytes(payload[offset : offset + 4], "big")
        chunk_type = payload[offset + 4 : offset + 8]
        data_start = offset + 8
        data_end = data_start + length
        chunk_end = data_end + 4
        if chunk_end > len(payload):
            raise InitialFieldPayloadError(
                "initial-field PNG chunk data is truncated"
            )
        if not chunk_type.isalpha() or chunk_type[2] & 0x20:
            raise InitialFieldPayloadError(
                "initial-field PNG contains an invalid chunk type"
            )
        chunk_data = payload[data_start:data_end]
        expected_crc = int.from_bytes(payload[data_end:chunk_end], "big")
        actual_crc = zlib.crc32(chunk_type)
        actual_crc = zlib.crc32(chunk_data, actual_crc) & 0xFFFFFFFF
        if actual_crc != expected_crc:
            raise InitialFieldPayloadError(
                f"initial-field PNG {chunk_type.decode('ascii')} "
                "chunk has an invalid CRC"
            )
        if seen_iend:
            raise InitialFieldPayloadError(
                "initial-field PNG contains data after IEND"
            )
        chunks.append((chunk_type, chunk_data))
        offset = chunk_end
        if chunk_type == b"IEND":
            seen_iend = True
            break

    if offset != len(payload):
        raise InitialFieldPayloadError(
            "initial-field PNG contains trailing bytes after IEND"
        )
    if not chunks or chunks[0][0] != b"IHDR":
        raise InitialFieldPayloadError(
            "initial-field PNG must begin with IHDR"
        )
    if not seen_iend or chunks[-1] != (b"IEND", b""):
        raise InitialFieldPayloadError(
            "initial-field PNG is missing a valid IEND chunk"
        )
    if sum(chunk_type == b"IHDR" for chunk_type, _ in chunks) != 1:
        raise InitialFieldPayloadError(
            "initial-field PNG must contain exactly one IHDR"
        )

    ihdr = chunks[0][1]
    if len(ihdr) != 13:
        raise InitialFieldPayloadError(
            "initial-field PNG IHDR must contain 13 bytes"
        )
    width, height = struct.unpack(">II", ihdr[:8])
    bit_depth, color_type, compression, filtering, interlace = ihdr[8:]
    allowed_depths = {
        0: {1, 2, 4, 8, 16},
        2: {8, 16},
        3: {1, 2, 4, 8},
        4: {8, 16},
        6: {8, 16},
    }
    if (
        width == 0
        or height == 0
        or color_type not in allowed_depths
        or bit_depth not in allowed_depths.get(color_type, set())
        or compression != 0
        or filtering != 0
        or interlace not in {0, 1}
    ):
        raise InitialFieldPayloadError(
            "initial-field PNG has an unsupported IHDR layout"
        )
    if width != INITIAL_FIELD_SIDE or height != INITIAL_FIELD_SIDE:
        raise InitialFieldPayloadError(
            f"initial-field PNG is {width}x{height}, not 256x256"
        )

    idat_indices = [
        index
        for index, (chunk_type, _) in enumerate(chunks)
        if chunk_type == b"IDAT"
    ]
    if not idat_indices:
        raise InitialFieldPayloadError(
            "initial-field PNG contains no IDAT data"
        )
    if idat_indices != list(
        range(idat_indices[0], idat_indices[-1] + 1)
    ):
        raise InitialFieldPayloadError(
            "initial-field PNG IDAT chunks must be consecutive"
        )

    known_critical = {b"IHDR", b"PLTE", b"IDAT", b"IEND"}
    for chunk_type, _ in chunks:
        if not chunk_type[0] & 0x20 and chunk_type not in known_critical:
            raise InitialFieldPayloadError(
                "initial-field PNG contains an unknown critical chunk "
                f"{chunk_type.decode('ascii')}"
            )

    palettes = [
        data for chunk_type, data in chunks if chunk_type == b"PLTE"
    ]
    if len(palettes) > 1:
        raise InitialFieldPayloadError(
            "initial-field PNG contains multiple PLTE chunks"
        )
    if color_type == 3 and not palettes:
        raise InitialFieldPayloadError(
            "indexed initial-field PNG is missing PLTE"
        )
    if color_type in {0, 4} and palettes:
        raise InitialFieldPayloadError(
            "grayscale initial-field PNG must not contain PLTE"
        )
    if palettes:
        palette = palettes[0]
        palette_index = next(
            index
            for index, (chunk_type, _) in enumerate(chunks)
            if chunk_type == b"PLTE"
        )
        if palette_index > idat_indices[0]:
            raise InitialFieldPayloadError(
                "initial-field PNG PLTE must appear before IDAT"
            )
        if (
            len(palette) == 0
            or len(palette) % 3 != 0
            or len(palette) > 768
            or (
                color_type == 3
                and len(palette) // 3 > 2**bit_depth
            )
        ):
            raise InitialFieldPayloadError(
                "initial-field PNG contains an invalid PLTE"
            )

    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    layout = _png_scanline_layout(
        width,
        height,
        channels * bit_depth,
        interlace,
    )
    expected_decoded_bytes = sum(
        (row_bytes + 1) * rows for row_bytes, rows in layout
    )
    compressed = b"".join(
        data for chunk_type, data in chunks if chunk_type == b"IDAT"
    )
    decoder = zlib.decompressobj()
    try:
        decoded = decoder.decompress(
            compressed,
            expected_decoded_bytes + 1,
        )
        if decoder.unconsumed_tail or len(decoded) > expected_decoded_bytes:
            raise InitialFieldPayloadError(
                "initial-field PNG expands beyond its declared dimensions"
            )
        decoded += decoder.flush(
            expected_decoded_bytes + 1 - len(decoded)
        )
    except zlib.error as error:
        raise InitialFieldPayloadError(
            f"initial-field PNG IDAT stream is malformed: {error}"
        ) from error
    if (
        not decoder.eof
        or decoder.unused_data
        or len(decoded) != expected_decoded_bytes
    ):
        raise InitialFieldPayloadError(
            "initial-field PNG IDAT stream is truncated or has the "
            "wrong decoded size"
        )

    cursor = 0
    for row_bytes, rows in layout:
        for _ in range(rows):
            filter_type = decoded[cursor]
            if filter_type > 4:
                raise InitialFieldPayloadError(
                    "initial-field PNG contains an invalid scanline filter"
                )
            cursor += row_bytes + 1
    return width, height


def _inspect_vp8_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 11:
        raise InitialFieldPayloadError(
            "initial-field WebP VP8 frame is truncated"
        )
    frame_tag = int.from_bytes(data[:3], "little")
    if frame_tag & 1:
        raise InitialFieldPayloadError(
            "initial-field WebP VP8 frame is not a key frame"
        )
    if ((frame_tag >> 1) & 0x7) > 3 or not ((frame_tag >> 4) & 1):
        raise InitialFieldPayloadError(
            "initial-field WebP VP8 frame header is unsupported"
        )
    first_partition_bytes = (frame_tag >> 5) & 0x7FFFF
    if (
        first_partition_bytes == 0
        or 10 + first_partition_bytes >= len(data)
    ):
        raise InitialFieldPayloadError(
            "initial-field WebP VP8 frame partitions are truncated"
        )
    if data[3:6] != b"\x9d\x01\x2a":
        raise InitialFieldPayloadError(
            "initial-field WebP VP8 key-frame signature is invalid"
        )
    width = int.from_bytes(data[6:8], "little") & 0x3FFF
    height = int.from_bytes(data[8:10], "little") & 0x3FFF
    if width == 0 or height == 0:
        raise InitialFieldPayloadError(
            "initial-field WebP VP8 dimensions are invalid"
        )
    return width, height


def _inspect_vp8l_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 6 or data[0] != 0x2F:
        raise InitialFieldPayloadError(
            "initial-field WebP VP8L frame header is truncated or invalid"
        )
    packed = int.from_bytes(data[1:5], "little")
    if packed >> 29:
        raise InitialFieldPayloadError(
            "initial-field WebP VP8L version is unsupported"
        )
    width = (packed & 0x3FFF) + 1
    height = ((packed >> 14) & 0x3FFF) + 1
    return width, height


def _inspect_webp_initial_field(payload: bytes) -> tuple[int, int]:
    if (
        len(payload) < 20
        or payload[:4] != b"RIFF"
        or payload[8:12] != b"WEBP"
    ):
        raise InitialFieldPayloadError(
            "initial-field WebP has an invalid or truncated RIFF header"
        )
    declared_size = int.from_bytes(payload[4:8], "little") + 8
    if declared_size != len(payload):
        raise InitialFieldPayloadError(
            "initial-field WebP RIFF size does not match the file size"
        )

    chunks: list[tuple[bytes, bytes]] = []
    offset = 12
    while offset < len(payload):
        if len(payload) - offset < 8:
            raise InitialFieldPayloadError(
                "initial-field WebP chunk header is truncated"
            )
        chunk_type = payload[offset : offset + 4]
        if any(byte < 0x20 or byte > 0x7E for byte in chunk_type):
            raise InitialFieldPayloadError(
                "initial-field WebP contains an invalid FourCC"
            )
        length = int.from_bytes(payload[offset + 4 : offset + 8], "little")
        data_start = offset + 8
        data_end = data_start + length
        padded_end = data_end + (length & 1)
        if padded_end > len(payload):
            raise InitialFieldPayloadError(
                "initial-field WebP chunk data is truncated"
            )
        if length & 1 and payload[data_end] != 0:
            raise InitialFieldPayloadError(
                "initial-field WebP chunk padding is invalid"
            )
        chunks.append((chunk_type, payload[data_start:data_end]))
        offset = padded_end
    if offset != len(payload) or not chunks:
        raise InitialFieldPayloadError(
            "initial-field WebP RIFF contents are malformed"
        )

    vp8x_chunks = [
        data for chunk_type, data in chunks if chunk_type == b"VP8X"
    ]
    if len(vp8x_chunks) > 1:
        raise InitialFieldPayloadError(
            "initial-field WebP contains multiple VP8X chunks"
        )
    image_chunks = [
        (chunk_type, data)
        for chunk_type, data in chunks
        if chunk_type in {b"VP8 ", b"VP8L"}
    ]
    if len(image_chunks) != 1:
        raise InitialFieldPayloadError(
            "initial-field WebP must contain exactly one still-image "
            "bitstream"
        )
    if any(
        chunk_type in {b"ANIM", b"ANMF"}
        for chunk_type, _ in chunks
    ):
        raise InitialFieldPayloadError(
            "animated WebP is not supported for an initial field"
        )

    image_type, image_data = image_chunks[0]
    if image_type == b"VP8 ":
        image_dimensions = _inspect_vp8_dimensions(image_data)
    else:
        image_dimensions = _inspect_vp8l_dimensions(image_data)

    if vp8x_chunks:
        if chunks[0][0] != b"VP8X":
            raise InitialFieldPayloadError(
                "initial-field WebP VP8X must be the first chunk"
            )
        vp8x = vp8x_chunks[0]
        if len(vp8x) != 10:
            raise InitialFieldPayloadError(
                "initial-field WebP VP8X chunk must contain 10 bytes"
            )
        flags = vp8x[0]
        if flags & 0xC1 or vp8x[1:4] != b"\0\0\0":
            raise InitialFieldPayloadError(
                "initial-field WebP VP8X reserved bits are not zero"
            )
        if flags & 0x02:
            raise InitialFieldPayloadError(
                "animated WebP is not supported for an initial field"
            )
        canvas_dimensions = (
            int.from_bytes(vp8x[4:7], "little") + 1,
            int.from_bytes(vp8x[7:10], "little") + 1,
        )
        if canvas_dimensions != image_dimensions:
            raise InitialFieldPayloadError(
                "initial-field WebP canvas and bitstream dimensions disagree"
            )
        dimensions = canvas_dimensions
    else:
        if len(chunks) != 1 or chunks[0][0] not in {b"VP8 ", b"VP8L"}:
            raise InitialFieldPayloadError(
                "initial-field WebP metadata requires a VP8X chunk"
            )
        dimensions = image_dimensions

    if dimensions != (INITIAL_FIELD_SIDE, INITIAL_FIELD_SIDE):
        raise InitialFieldPayloadError(
            "initial-field WebP is "
            f"{dimensions[0]}x{dimensions[1]}, not 256x256"
        )
    return dimensions


def _sniff_initial_field_format(payload: bytes) -> str | None:
    if payload.startswith(PNG_SIGNATURE):
        return "png"
    if payload.startswith(NPY_MAGIC):
        return "npy"
    if (
        len(payload) >= 12
        and payload[:4] == b"RIFF"
        and payload[8:12] == b"WEBP"
    ):
        return "webp"
    candidate = payload
    if candidate.startswith(b"\xef\xbb\xbf"):
        candidate = candidate[3:]
    if candidate.lstrip().startswith((b"{", b"[")):
        return "json"
    return None


def _inspect_initial_field_payload(
    payload: bytes,
    declared_format: str,
) -> tuple[int, int]:
    sniffed_format = _sniff_initial_field_format(payload)
    if (
        sniffed_format is not None
        and sniffed_format != declared_format
    ):
        raise InitialFieldPayloadError(
            f"payload is {sniffed_format}, but descriptor declares "
            f"{declared_format}"
        )
    inspectors = {
        "json": _inspect_json_initial_field,
        "npy": _inspect_npy_initial_field,
        "png": _inspect_png_initial_field,
        "webp": _inspect_webp_initial_field,
    }
    inspector = inspectors.get(declared_format)
    if inspector is None:
        raise InitialFieldPayloadError(
            f"initial-field format {declared_format!r} is unsupported"
        )
    return inspector(payload)


def verify_media(
    references: Sequence[AssetReference],
    media_root: Path,
    *,
    require_media_files: bool,
    result: ValidationResult,
) -> tuple[int, int]:
    root = media_root.resolve()
    if not root.is_dir():
        result.issue("media-root", f"is not a directory: {root}")
        return 0, 0

    checked = 0
    missing = 0
    digest_cache: dict[Path, tuple[int, str]] = {}
    initial_field_cache: dict[tuple[Path, str], str | None] = {}
    for reference in references:
        candidate = (root / Path(*reference.key.split("/"))).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            result.issue(
                reference.label,
                f"asset path escapes media root: {reference.key}",
            )
            continue
        if not candidate.is_file():
            missing += 1
            message = f"referenced media file is missing: {candidate}"
            if require_media_files:
                result.issue(reference.label, message)
            else:
                result.warning(reference.label, message)
            continue

        checked += 1
        if candidate not in digest_cache:
            try:
                digest_cache[candidate] = (
                    candidate.stat().st_size,
                    _sha256_file(candidate),
                )
            except OSError as error:
                result.issue(
                    reference.label,
                    f"could not read media file {candidate}: {error}",
                )
                continue
        actual_bytes, actual_sha256 = digest_cache[candidate]
        if actual_bytes != reference.bytes:
            result.issue(
                reference.label,
                f"bytes is {reference.bytes}, but file size is {actual_bytes}",
            )
        if actual_sha256 != reference.sha256:
            result.issue(
                reference.label,
                "sha256 does not match the referenced media file",
            )
        if reference.asset_kind != "initial_field":
            continue

        declared_format = reference.initial_field_format
        if declared_format not in INITIAL_FIELD_FORMATS:
            result.issue(
                reference.label,
                "initial field cannot be inspected because its format "
                "descriptor is missing or unsupported",
            )
            continue
        expected_suffix = f".{declared_format}"
        actual_suffix = PurePosixPath(reference.key).suffix.lower()
        if actual_suffix != expected_suffix:
            result.issue(
                reference.label,
                f"initial-field format {declared_format} requires a "
                f"{expected_suffix} object key, not "
                f"{actual_suffix or 'an extensionless key'}",
            )
        if actual_bytes > MAX_INITIAL_FIELD_BYTES:
            result.issue(
                reference.label,
                "initial-field payload exceeds the 64 MiB safety limit",
            )
            continue

        cache_key = (candidate, declared_format)
        inspection_error = initial_field_cache.get(cache_key, NOT_PROVIDED)
        if inspection_error is NOT_PROVIDED:
            try:
                payload = candidate.read_bytes()
                _inspect_initial_field_payload(payload, declared_format)
            except OSError as error:
                inspection_error = (
                    f"could not read initial-field payload: {error}"
                )
            except InitialFieldPayloadError as error:
                inspection_error = str(error)
            else:
                inspection_error = None
            initial_field_cache[cache_key] = inspection_error
        if inspection_error is not None:
            result.issue(reference.label, inspection_error)
    return checked, missing


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate review-overlay and refinement-catalog JSON against a "
            "Lenia site manifest."
        )
    )
    parser.add_argument(
        "--manifest",
        required=True,
        type=Path,
        help="Path to the decoded site-manifest JSON.",
    )
    parser.add_argument(
        "--review-overlay",
        type=Path,
        help="Path to review-overlay JSON (optional).",
    )
    parser.add_argument(
        "--refinement-catalog",
        type=Path,
        help="Path to refinement-catalog JSON (optional).",
    )
    parser.add_argument(
        "--media-root",
        type=Path,
        help=(
            "Local object-root directory containing media/v1 and/or repro/v1. "
            "Existing referenced files are size- and hash-checked."
        ),
    )
    parser.add_argument(
        "--require-media-files",
        action="store_true",
        help=(
            "Treat every referenced media file missing below --media-root as "
            "an error instead of a warning."
        ),
    )
    args = parser.parse_args(argv)
    if args.review_overlay is None and args.refinement_catalog is None:
        parser.error(
            "provide --review-overlay, --refinement-catalog, or both"
        )
    if args.refinement_catalog is not None and args.review_overlay is None:
        parser.error(
            "--refinement-catalog requires --review-overlay so every "
            "refinement center can be checked for a self_replicator review"
        )
    if args.require_media_files and args.media_root is None:
        parser.error("--require-media-files requires --media-root")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    result = ValidationResult()
    manifest = load_json(args.manifest, "site-manifest", result)
    context = (
        _manifest_context(manifest, result)
        if manifest is not LOAD_FAILED
        else None
    )

    review_overlay: Any = NOT_PROVIDED
    if args.review_overlay is not None:
        review_overlay = load_json(
            args.review_overlay, "review-overlay", result
        )
    refinement_catalog: Any = NOT_PROVIDED
    if args.refinement_catalog is not None:
        refinement_catalog = load_json(
            args.refinement_catalog, "refinement-catalog", result
        )

    if context is not None:
        dataset_id, manifest_sha256, field_size, point_classifications = context
        if (
            review_overlay is not NOT_PROVIDED
            and review_overlay is not LOAD_FAILED
        ):
            validate_review_overlay(
                review_overlay,
                dataset_id=dataset_id,
                manifest_sha256=manifest_sha256,
                field_size=field_size,
                point_classifications=point_classifications,
                result=result,
            )
        if (
            refinement_catalog is not NOT_PROVIDED
            and refinement_catalog is not LOAD_FAILED
        ):
            validate_refinement_catalog(
                refinement_catalog,
                dataset_id=dataset_id,
                manifest_sha256=manifest_sha256,
                field_size=field_size,
                point_classifications=point_classifications,
                result=result,
            )
        if (
            review_overlay is not NOT_PROVIDED
            and review_overlay is not LOAD_FAILED
            and refinement_catalog is not NOT_PROVIDED
            and refinement_catalog is not LOAD_FAILED
        ):
            validate_cross_document_visibility(
                review_overlay, refinement_catalog, result
            )

    checked = 0
    missing = 0
    if args.media_root is not None:
        checked, missing = verify_media(
            result.assets,
            args.media_root,
            require_media_files=args.require_media_files,
            result=result,
        )
    elif result.assets:
        result.issue(
            "media-root",
            "auxiliary media is referenced; provide --media-root and "
            "--require-media-files to verify every staged object",
        )

    for warning in result.warnings:
        print(f"WARNING: {warning}", file=sys.stderr)
    if result.issues:
        for issue in result.issues:
            print(f"ERROR: {issue}", file=sys.stderr)
        print(
            f"FAIL: {len(result.issues)} validation issue(s), "
            f"{len(result.warnings)} warning(s).",
            file=sys.stderr,
        )
        return 1

    summary = (
        f"PASS: {result.review_count} review(s), "
        f"{result.neighborhood_count} refinement neighborhood(s), "
        f"{result.sample_count} refinement sample(s), "
        f"{len(result.assets)} auxiliary media reference(s)"
    )
    if args.media_root is not None:
        summary += f", {checked} file reference(s) checked, {missing} missing"
    print(summary + ".")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
