from __future__ import annotations

import contextlib
import hashlib
import io
import json
import struct
import sys
import unittest
import zlib
from pathlib import Path
from unittest import mock


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "scripts"))

import validate_auxiliary_data as validator  # noqa: E402


MANIFEST_SHA = "a" * 64


def initial_field_json_payload(last_value: str = "0") -> bytes:
    values = ",".join(["0"] * (256 * 256 - 1) + [last_value])
    return (
        '{"shape":[256,256],"values":[' + values + "]}"
    ).encode("utf-8")


def npy_payload(
    *,
    descriptor: str = "<f4",
    shape: tuple[int, int] = (256, 256),
    fortran_order: bool = False,
    data: bytes | None = None,
) -> bytes:
    header_text = repr(
        {
            "descr": descriptor,
            "fortran_order": fortran_order,
            "shape": shape,
        }
    )
    padding = (16 - ((10 + len(header_text) + 1) % 16)) % 16
    header = (header_text + " " * padding + "\n").encode("latin1")
    prefix = b"\x93NUMPY\x01\x00" + len(header).to_bytes(2, "little")
    if data is None:
        item_size = {
            "f4": 4,
            "f8": 8,
            "u1": 1,
            "u2": 2,
            "i2": 2,
            "i4": 4,
        }.get(descriptor[1:], 1)
        data = b"\0" * (shape[0] * shape[1] * item_size)
    return prefix + header + data


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type)
    crc = zlib.crc32(data, crc) & 0xFFFFFFFF
    return (
        len(data).to_bytes(4, "big")
        + chunk_type
        + data
        + crc.to_bytes(4, "big")
    )


def png_payload(width: int = 256, height: int = 256) -> bytes:
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    scanlines = b"".join(
        b"\0" + b"\0" * width for _ in range(height)
    )
    return (
        validator.PNG_SIGNATURE
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", zlib.compress(scanlines))
        + png_chunk(b"IEND", b"")
    )


def webp_payload(width: int = 256, height: int = 256) -> bytes:
    packed = (width - 1) | ((height - 1) << 14)
    # The final byte represents the beginning of the lossless entropy stream.
    frame = b"\x2f" + packed.to_bytes(4, "little") + b"\0"
    chunk = b"VP8L" + len(frame).to_bytes(4, "little") + frame
    body = b"WEBP" + chunk
    return b"RIFF" + len(body).to_bytes(4, "little") + body


def manifest() -> dict:
    return {
        "schema_version": 1,
        "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
        "manifest_sha256": MANIFEST_SHA,
        "search_configuration": {"field_size": 256},
        "points": [
            {
                "id": "triple_00001",
                "classification": "dynamics_unresolved",
            },
            {
                "id": "triple_00002",
                "classification": "experimentally_dead",
            },
        ],
    }


def context(result: validator.ValidationResult):
    parsed = validator._manifest_context(manifest(), result)
    assert parsed is not None
    dataset_id, manifest_sha256, field_size, classifications = parsed
    return {
        "dataset_id": dataset_id,
        "manifest_sha256": manifest_sha256,
        "field_size": field_size,
        "point_classifications": classifications,
        "result": result,
    }


class AuxiliaryValidatorTests(unittest.TestCase):
    def test_valid_documents_and_media_pass(self) -> None:
        media_root = REPOSITORY_ROOT / "public"
        media_key = (
            "media/v1/triple_00503/top_1/"
            "7b8e9954dabfb82ba49542193abc70baaf050c95f0e1d54a32e8f934d439486d.png"
        )
        media_path = media_root / Path(*media_key.split("/"))
        payload = media_path.read_bytes()
        descriptor = {
            "key": media_key,
            "sha256": hashlib.sha256(payload).hexdigest(),
            "bytes": len(payload),
            "width": 1128,
            "height": 2240,
        }
        review_overlay = {
            "schema_version": 1,
            "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
            "based_on_manifest_sha256": MANIFEST_SHA,
            "reviews": [
                {
                    "point_id": "triple_00001",
                    "status": "self_replicator",
                    "media": {"poster": descriptor},
                }
            ],
        }
        refinement_catalog = {
            "schema_version": 1,
            "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
            "based_on_manifest_sha256": MANIFEST_SHA,
            "neighborhoods": [
                {
                    "id": "around-triple-00001",
                    "center_point_id": "triple_00001",
                    "axes": {
                        "m_local": [0.1, 0.11],
                        "m_cross": [1.0],
                        "alpha": [0.4],
                    },
                    "samples": [
                        {
                            "grid_index": [1, 0, 0],
                            "coordinates": {
                                "m_local": 0.11,
                                "m_cross": 1.0,
                                "alpha": 0.4,
                            },
                            "status": "nonreplicator",
                        }
                    ],
                }
            ],
        }

        result = validator.ValidationResult()
        validator.validate_review_overlay(review_overlay, **context(result))
        validator.validate_refinement_catalog(
            refinement_catalog, **context(result)
        )
        validator.validate_cross_document_visibility(
            review_overlay, refinement_catalog, result
        )

        checked, missing = validator.verify_media(
            result.assets,
            media_root,
            require_media_files=True,
            result=result,
        )

        self.assertEqual(result.issues, [])
        self.assertEqual(result.warnings, [])
        self.assertEqual((checked, missing), (1, 0))
        self.assertEqual(result.review_count, 1)
        self.assertEqual(result.neighborhood_count, 1)
        self.assertEqual(result.sample_count, 1)

    def test_initial_field_json_payload_is_fully_inspected(self) -> None:
        self.assertEqual(
            validator._inspect_initial_field_payload(
                initial_field_json_payload(),
                "json",
            ),
            (256, 256),
        )
        with self.assertRaisesRegex(
            validator.InitialFieldPayloadError,
            "shape must be",
        ):
            validator._inspect_initial_field_payload(
                b'{"shape":[128,256],"values":[]}',
                "json",
            )
        with self.assertRaisesRegex(
            validator.InitialFieldPayloadError,
            "non-finite",
        ):
            validator._inspect_initial_field_payload(
                initial_field_json_payload("1e400"),
                "json",
            )
        with self.assertRaisesRegex(
            validator.InitialFieldPayloadError,
            "valid finite UTF-8 JSON",
        ):
            validator._inspect_initial_field_payload(
                b'{"values": [}',
                "json",
            )

    def test_initial_field_npy_payload_is_fully_inspected(self) -> None:
        valid_payload = npy_payload()
        self.assertEqual(
            validator._inspect_initial_field_payload(valid_payload, "npy"),
            (256, 256),
        )

        cases = (
            (
                npy_payload(shape=(128, 256)),
                r"shape must be \(256, 256\)",
            ),
            (
                npy_payload(descriptor="<i8"),
                "dtype '<i8' is unsupported",
            ),
            (
                npy_payload(fortran_order=True),
                "must use C order",
            ),
            (
                valid_payload[:-1],
                "numeric data is truncated",
            ),
            (
                npy_payload(
                    data=(
                        b"\0" * (256 * 256 * 4 - 4)
                        + struct.pack("<f", float("nan"))
                    )
                ),
                "contains a non-finite value",
            ),
        )
        for payload, expected_message in cases:
            with self.subTest(expected_message=expected_message):
                with self.assertRaisesRegex(
                    validator.InitialFieldPayloadError,
                    expected_message,
                ):
                    validator._inspect_initial_field_payload(payload, "npy")

    def test_initial_field_png_payload_is_fully_inspected(self) -> None:
        valid_payload = png_payload()
        self.assertEqual(
            validator._inspect_initial_field_payload(valid_payload, "png"),
            (256, 256),
        )
        with self.assertRaisesRegex(
            validator.InitialFieldPayloadError,
            "128x256",
        ):
            validator._inspect_initial_field_payload(
                png_payload(width=128),
                "png",
            )

        bad_crc = bytearray(valid_payload)
        bad_crc[-1] ^= 1
        with self.assertRaisesRegex(
            validator.InitialFieldPayloadError,
            "invalid CRC",
        ):
            validator._inspect_initial_field_payload(bytes(bad_crc), "png")
        with self.assertRaisesRegex(
            validator.InitialFieldPayloadError,
            "truncated|trailing",
        ):
            validator._inspect_initial_field_payload(
                valid_payload[:-5],
                "png",
            )
        indexed_ihdr = struct.pack(
            ">IIBBBBB", 256, 256, 8, 3, 0, 0, 0
        )
        indexed_scanlines = (b"\0" + b"\0" * 256) * 256
        palette_after_data = (
            validator.PNG_SIGNATURE
            + png_chunk(b"IHDR", indexed_ihdr)
            + png_chunk(b"IDAT", zlib.compress(indexed_scanlines))
            + png_chunk(b"PLTE", b"\0\0\0")
            + png_chunk(b"IEND", b"")
        )
        with self.assertRaisesRegex(
            validator.InitialFieldPayloadError,
            "PLTE must appear before IDAT",
        ):
            validator._inspect_initial_field_payload(
                palette_after_data,
                "png",
            )

    def test_initial_field_webp_container_and_dimensions_are_inspected(
        self,
    ) -> None:
        valid_payload = webp_payload()
        self.assertEqual(
            validator._inspect_initial_field_payload(valid_payload, "webp"),
            (256, 256),
        )
        with self.assertRaisesRegex(
            validator.InitialFieldPayloadError,
            "128x256",
        ):
            validator._inspect_initial_field_payload(
                webp_payload(width=128),
                "webp",
            )
        with self.assertRaisesRegex(
            validator.InitialFieldPayloadError,
            "RIFF size",
        ):
            validator._inspect_initial_field_payload(
                valid_payload[:-1],
                "webp",
            )

    def test_initial_field_format_and_extension_mismatches_are_rejected(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            validator.InitialFieldPayloadError,
            "payload is png, but descriptor declares webp",
        ):
            validator._inspect_initial_field_payload(
                png_payload(),
                "webp",
            )

        media_root = REPOSITORY_ROOT / "public"
        key = (
            "media/v1/triple_00503/top_1/"
            "7b8e9954dabfb82ba49542193abc70baaf050c95f0e1d54a32e8f934d439486d.png"
        )
        payload = (media_root / Path(*key.split("/"))).read_bytes()
        digest = hashlib.sha256(payload).hexdigest()
        reference = validator.AssetReference(
            label="review initial field",
            key=key,
            sha256=digest,
            bytes=len(payload),
            asset_kind="initial_field",
            initial_field_format="json",
        )
        result = validator.ValidationResult()
        checked, missing = validator.verify_media(
            [reference],
            media_root,
            require_media_files=True,
            result=result,
        )
        self.assertEqual((checked, missing), (1, 0))
        self.assertIn(
            "format json requires a .json object key",
            "\n".join(result.issues),
        )

    def test_review_contract_rejects_wrong_point_extra_field_and_bad_field(
        self,
    ) -> None:
        overlay = {
            "schema_version": 1,
            "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
            "reviews": [
                {
                    "point_id": "triple_00002",
                    "status": "self_replicator",
                    "unexpected": True,
                    "media": {
                        "initial_field": {
                            "key": "media/v1/fields/bad%2fkey.npy",
                            "sha256": "b" * 64,
                            "bytes": 4,
                            "format": "npy",
                            "width": 128,
                            "height": 256,
                        }
                    },
                }
            ],
        }
        result = validator.ValidationResult()
        validator.validate_review_overlay(overlay, **context(result))
        issues = "\n".join(result.issues)
        self.assertIn("unexpected field 'unexpected'", issues)
        self.assertIn("is not dynamics_unresolved", issues)
        self.assertIn("not a safe relative object key", issues)
        self.assertIn("initial field must be 256x256", issues)

    def test_refinement_contract_rejects_ambiguous_centers_and_bad_samples(
        self,
    ) -> None:
        neighborhood = {
            "id": "first",
            "center_point_id": "triple_00001",
            "axes": {
                "m_local": [0.2, 0.1],
                "m_cross": [1.0],
                "alpha": [0.4],
            },
            "samples": [
                {
                    "grid_index": [0, 0, 0],
                    "coordinates": {
                        "m_local": 9.0,
                        "m_cross": 1.0,
                        "alpha": 0.4,
                    },
                    "status": "self_replicator",
                },
                {
                    "grid_index": [0, 0, 0],
                    "coordinates": {
                        "m_local": 0.2,
                        "m_cross": 1.0,
                        "alpha": 0.4,
                    },
                    "status": "nonreplicator",
                },
            ],
        }
        catalog = {
            "schema_version": 1,
            "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
            "neighborhoods": [
                neighborhood,
                {
                    **neighborhood,
                    "id": "second",
                    "samples": [],
                },
            ],
        }
        result = validator.ValidationResult()
        validator.validate_refinement_catalog(catalog, **context(result))
        issues = "\n".join(result.issues)
        self.assertIn("must be strictly increasing", issues)
        self.assertIn("do not match the values at grid_index", issues)
        self.assertIn("duplicates sample 0,0,0", issues)
        self.assertIn("duplicates refinement center triple_00001", issues)

    def test_missing_media_is_warning_unless_required(self) -> None:
        reference = validator.AssetReference(
            label="review media",
            key="media/v1/missing.mp4",
            sha256="c" * 64,
            bytes=10,
        )
        root = REPOSITORY_ROOT / "public"
        result = validator.ValidationResult()
        validator.verify_media(
            [reference], root, require_media_files=False, result=result
        )
        self.assertEqual(result.issues, [])
        self.assertEqual(len(result.warnings), 1)

        required_result = validator.ValidationResult()
        validator.verify_media(
            [reference],
            root,
            require_media_files=True,
            result=required_result,
        )
        self.assertEqual(len(required_result.issues), 1)

    def test_stale_digest_and_invalid_asset_base_are_rejected(self) -> None:
        for asset_base_url in (
            "https://objects.example/media?token=public",
            "https://objects.example:bad/media",
            "https://objects.example:99999/media",
            "https://exa mple.com/media",
            "https:///objects.example/media",
            "https://%/media",
            "https://user@example.com/media",
        ):
            with self.subTest(asset_base_url=asset_base_url):
                overlay = {
                    "schema_version": 1,
                    "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
                    "asset_base_url": asset_base_url,
                    "based_on_manifest_sha256": "d" * 64,
                    "reviews": [],
                }
                result = validator.ValidationResult()
                validator.validate_review_overlay(overlay, **context(result))
                issues = "\n".join(result.issues)
                self.assertIn("asset_base_url", issues)
                self.assertIn(
                    "targets a different manifest snapshot", issues
                )

    def test_refinement_center_needs_self_replicator_review(self) -> None:
        overlay = {
            "schema_version": 1,
            "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
            "reviews": [
                {
                    "point_id": "triple_00001",
                    "status": "nonreplicator",
                }
            ],
        }
        catalog = {
            "schema_version": 1,
            "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
            "neighborhoods": [
                {
                    "id": "hidden-refinement",
                    "center_point_id": "triple_00001",
                    "axes": {
                        "m_local": [0.1],
                        "m_cross": [1.0],
                        "alpha": [0.4],
                    },
                    "samples": [],
                }
            ],
        }
        result = validator.ValidationResult()
        validator.validate_cross_document_visibility(
            overlay, catalog, result
        )
        self.assertIn(
            "needs a matching self_replicator review",
            "\n".join(result.issues),
        )

    def test_cli_rejects_json_null_documents(self) -> None:
        valid_review = {
            "schema_version": 1,
            "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
            "reviews": [],
        }
        valid_catalog = {
            "schema_version": 1,
            "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
            "neighborhoods": [],
        }
        cases = (
            (None, valid_review, valid_catalog),
            (manifest(), None, valid_catalog),
            (manifest(), valid_review, None),
        )
        for documents in cases:
            with self.subTest(null_document=documents.index(None)):
                stdout = io.StringIO()
                stderr = io.StringIO()
                with mock.patch.object(
                    validator, "load_json", side_effect=documents
                ), contextlib.redirect_stdout(
                    stdout
                ), contextlib.redirect_stderr(
                    stderr
                ):
                    exit_code = validator.main(
                        [
                            "--manifest",
                            "manifest.json",
                            "--review-overlay",
                            "review.json",
                            "--refinement-catalog",
                            "catalog.json",
                        ]
                    )
                self.assertEqual(exit_code, 1)
                self.assertIn("must be an object", stderr.getvalue())

    def test_cli_requires_review_when_refinement_is_supplied(self) -> None:
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                validator.parse_args(
                    [
                        "--manifest",
                        "manifest.json",
                        "--refinement-catalog",
                        "catalog.json",
                    ]
                )
        self.assertEqual(raised.exception.code, 2)

    def test_pathological_json_numbers_and_depth_fail_cleanly(self) -> None:
        self.assertFalse(validator._is_integer(10**309))
        self.assertFalse(validator._is_number(10**309))

        result = validator.ValidationResult()
        with mock.patch.object(
            Path, "open", mock.mock_open()
        ), mock.patch.object(
            validator.json,
            "load",
            side_effect=RecursionError("document is nested too deeply"),
        ):
            document = validator.load_json(
                Path("deep.json"), "review-overlay", result
            )
        self.assertIs(document, validator.LOAD_FAILED)
        self.assertIn("nested too deeply", "\n".join(result.issues))


if __name__ == "__main__":
    unittest.main()
