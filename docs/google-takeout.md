# Google Takeout import

Takeout is opt-in per source. Choose **Google Takeout** only for a Drive folder containing an extracted Google Photos Takeout export.

## Quick path

1. Extract the Takeout archive locally and upload or otherwise place its exported folder under the selected Drive root.
2. Create the source as **Google Takeout**.
3. Start a sync. Each image remains indexable even if its adjacent JSON is absent or invalid.

## What is read

Only JSON files enumerated inside that selected source are parsed. The parser accepts `title`, `photoTakenTime.timestamp`, and usable `geoData.latitude`/`longitude`; it does not log JSON content. Matching stays inside the same folder and records `TAKEOUT_MATCHED`, `TAKEOUT_NOT_FOUND`, or `TAKEOUT_AMBIGUOUS` with a short reason.

| Case           | Behavior                                                          |
| -------------- | ----------------------------------------------------------------- |
| Invalid JSON   | Warning `INVALID_TAKEOUT_JSON`; sync continues.                   |
| No JSON        | Photo is indexed normally; no issue is created.                   |
| Ambiguous JSON | Photo is indexed without Takeout metadata and receives a warning. |
| Valid GPS      | Stored only with a validated Takeout match; no map is built.      |

## Limits

There is no normal 100-image sync limit. JSON is read only for `GOOGLE_TAKEOUT` sources, is capped at 1 MiB per file, and is not parsed for generic sources. This phase does not import local filesystem paths directly, scan beyond the selected Drive tree, interpret events/albums, or perform AI/OCR/visual matching.
