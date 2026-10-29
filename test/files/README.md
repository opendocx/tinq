# Serialized template fixtures

These JSON files exercise template field import and data extraction. They
contain field/logic structures, not the source DOCX/PDF documents or completed
customer records. File extensions describe the expected input format; TINQ
does not open DOCX or PDF files directly.

## PDF-style fields

The six descriptively named files in `pdf/` were authored as synthetic TINQ
regression cases on 2026-10-29. They replace older, UUID-named inputs whose
source documents were not recorded. Names, addresses, and model properties in
the cases are illustrative.

They cover conditional fallbacks, null/missing values, nested and repeated
member access, value formatting, arrays, and optional members. The extraction
tests supply synthetic data and assert the resulting field values.

## Legacy DOCX-style fields

`SimpleWill.docxobj.json` is a legacy field-array example used by the JSON
template lexer test. The files in `docx/` are legacy logic-tree regression
inputs retained from the library's existing test suite. Their original source
documents are not recorded here; these files contain expressions, field
identifiers, and control-flow structure rather than document prose or answers.
Some equivalent cases also appear in yatte's test suite.

The populated example data lives in the test modules and uses fictional/sample
values. The will-related names describe the sample schema, not legal guidance.
Two unused inputs, `Trust.docxobj.json` and `MismatchedEndIf.docxobj.json`, have
been removed.

Future fixtures should be authored from synthetic examples, include a
descriptive filename, and state any external source and redistribution terms.
