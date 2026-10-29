# Serialized template fixtures

These JSON files exercise template field import and data extraction. They
contain field/logic structures, not the source DOCX/PDF documents or completed
customer records. File extensions describe the expected input format; TINQ
does not open DOCX or PDF files directly.

## Intended integration workflow

The fixtures represent saved metadata between template preparation and document
assembly. The broader workflow has two stages:

1. Prepare a source template: extract its fields, associate them with expressions
   and control-flow structure, and save that metadata with the template.
2. Assemble output: use TINQ to evaluate the saved logic against application data,
   then pass the evaluated values to the appropriate document assembler.

The metadata, source/compiled template, and evaluated field identifiers must
agree; keep them associated with the same template version.

### DOCX

DOCX integration is intended to use
[opendocx-net](https://github.com/opendocx/opendocx-net). That project handles
extracting fields and compiling a Word template for OpenXmlPowerTools document
assembly. A host application uses TINQ to evaluate the corresponding logic and
produce the XML consumed by the assembler, then asks the document tooling to
assemble the compiled template with that XML.

The DOCX-style fixtures exercise the field/logic import and evaluated-data part
of that workflow. They do not test Word extraction, template compilation, or
final DOCX assembly. Text-template features such as comments and source locations
also depend on what the DOCX extraction metadata preserves.

### PDF

The intended PDF workflow uses a host adapter around `node-pdftk` to extract
PDF form-field metadata and record a mapping from PDF field names to TINQ
expressions. At assembly time, the host evaluates those expressions with TINQ,
converts the results to the field-value mapping expected by the PDF tooling,
and fills the template to produce a new PDF.

TINQ's `extractData(logicTree, scope)` supplies evaluated data; its `data`
aggregator exposes `toJson()` for JSON serialization and `toXml()` for XML.
The PDF-style fixtures exercise import and evaluation with PDF field names,
while an adapter must handle the actual PDF extraction, value conversion, and
form filling.

The availability of a published standalone PDF adapter still needs to be
confirmed. A runnable extraction-and-filling example, or a reusable adapter
project, would make a useful companion to TINQ. That integration code is not
included here.

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
