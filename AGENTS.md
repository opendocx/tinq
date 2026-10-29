# Agent Guidance

## Project Context

TINQ is the experimental successor for the `yatte` and `angular-expressions`
projects (expression and template parsing/compilation). Treat it as a small
open-source library for parsing, compiling, and evaluating expressions and text
templates, with APIs that remain usable across host applications.

The main current direction is conservative:

- Keep TINQ broadly type-agnostic (like angular-expressions and yatte were).
- Leave application-specific static type/model resolution to host applications.
- Use TINQ for clean parsing, template parsing, list filters/lambda-like
  behavior, compilation, and optional explicit lowered-frame access.

## Module Format

- Source is ESM under `src/*.mjs`.
- The package also exports a generated CommonJS bundle at `index.cjs`.
- Do not hand-edit `index.cjs`; run `npm run build`.
- CommonJS consumers may use `require('@opendocx/tinq')`, so after source changes
  intended for those consumers, rebuild and smoke-test the CJS path.

Useful checks:

```sh
npm test
npm run build
```

The Rollup build may warn about external dependencies and an existing circular
dependency. Those warnings are currently expected unless the code under review
specifically changes that area.

## Parser And AST Conventions

- Expression AST locations, when `includeLocation` is true, are relative to the
  expression string being parsed.
- Template AST locations, when `includeLocation` is true, are absolute character
  offsets within the full template text.
- Template field nodes may have:
  - `loc`: full field or block span.
  - `expressionLoc`: expression/code portion within the template.
  - `commentPrefixLoc` / `commentLoc`: field comment delimiter/spacing and
    comment text.
  - Block fields may also expose `openLoc`, `testLoc`, `altLoc`, and `endLoc`.
- `TemplateElement` is the current representation for static template text.
  Prefer `text` over older template-string-inspired `value.raw` conventions.

## Field Comments

Text template fields support optional field-level comments delimited by `//`,
for example:

```text
{[Name // shown in Designer]}
{[endif // closes optional spouse block]}
```

The comment belongs to the field, not to the expression AST. `//` inside quoted
strings must not be treated as a field comment.

Comment round-tripping uses:

- `comment`: text after the delimiter.
- `commentPrefix`: whitespace immediately before the delimiter plus `//`, such
  as `"//"` or `" //"`.

This is intentional so whitespace surrounding comments can round-trip without
leaking into the parsed expression text.

## Scope And Lowered Frames

TINQ supports ordinary dynamic scope lookup for unlowered expressions. This
preserves standalone/library behavior.

Lowered identifiers use an explicit environment parameter so compiled
expressions can name the frame they mean instead of walking a runtime stack.
The standard generated/evaluated function signature is:

```text
scope, env, assign, inputs
```

In minified/internal code this commonly appears as:

```text
s, e, a, i
```

Be careful not to reuse `a` for the lowered environment. `a` is the legacy
assignment helper slot inherited from angular-expressions/yatte patterns.

`env` / `e` is optional for ordinary dynamic evaluation. Explicit lowered frame
identifiers require the corresponding environment entries; they do not fall
back to dynamic lookup when those entries are absent.

## Template Lists And Generated Fields

Template list parsing may synthesize a `_punc` content field. This generated
field often has no source `loc`, because it does not correspond to a user-authored
template field.

When adding tests around template serialization, remember that list templates may
serialize with an inserted `{[_punc]}` field.

## Truthiness

TINQ intentionally treats an empty array (and other empty iterable lists) as
falsy in every language-level boolean context: unary `!`, `&&`, `||`, ternary
tests, template conditional fields, and list predicates. This is a deliberate
departure from JavaScript and from yatte's inconsistent split between template
conditions and ordinary expressions. Do not reintroduce native JavaScript
truthiness in those contexts without an explicit compatibility decision.

## Host Application Integration

Keep the integration boundary clear:

- TINQ parses expressions/templates and can compile lowered expressions.
- Host applications resolve identifiers against their own type/model systems.
- Host applications may generate lowered ASTs/expressions with explicit frame names.
- TINQ compiles/evaluates that lowered form.

Avoid making TINQ depend on a host application's type definitions, resolver
metadata, or runtime-extension definitions unless the user explicitly asks for
that direction.

## Cross-Repo Notes

Related repos commonly involved in this work:

- `yatte`: current/legacy expression and assembly infrastructure.
- `angular-expressions`: legacy compiler/evaluator influence.
- `opendocx-net`: DOCX extraction/assembly path.

Do not assume DOCX template support behaves exactly like text template support.
DOCX extraction currently tends to persist parsed field dictionaries rather than
raw template field arrays, so text-template conveniences like field comments and
template locations may not automatically survive through DOCX support files.

## Editing Rules

- Prefer small, focused changes.
- Add tests for parser/compiler behavior changes.
- Keep source changes in `src/*.mjs`; rebuild `index.cjs` with `npm run build`
  when CommonJS consumers need the change.
- Do not add dependencies without asking first.
