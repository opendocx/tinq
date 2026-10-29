# TINQ

**Text INtegrated Query** — expression and text-template parsing, compilation,
and evaluation for JavaScript.

TINQ is the experimental successor to [yatte](https://github.com/opendocx/yatte),
with roots in [angular-expressions](https://github.com/peerigon/angular-expressions)
and AngularJS. Its development is currently guided primarily by the needs of
Knackly, while keeping the library usable independently and broadly agnostic
about application data types and models.

## Development status

**TINQ is under active development. APIs, AST shapes, and behavior may change
before a stable 1.0 release.**

- Expression and text-template parsing are among the more established parts of
  the library, with tests for syntax, AST serialization, field comments, and
  source locations.
- Expression and text-template evaluation are implemented and tested through
  both a JavaScript compiler and an interpreter. Tests cover scope lookup,
  operators, filters, conditionals, lists, and template composition. Evaluation
  semantics, compatibility, and edge cases are still evolving.
- Data extraction, legacy logic-tree import, external composition, and output
  batching are also present, but are more specialized and less extensively
  exercised than the core expression and text-template APIs.

TINQ is not a drop-in replacement for yatte or angular-expressions. Pin the
version you depend on and test your application's expressions and templates
when upgrading.

## Installation

```sh
npm install @opendocx/tinq
```

The package supports ES modules and CommonJS:

```js
import { Tinq, AST } from '@opendocx/tinq'
```

```js
const { Tinq, AST } = require('@opendocx/tinq')
```

## Expressions

Parse an expression without evaluating it, or compile it into a reusable
function that accepts a data object:

```js
const tinq = new Tinq()

const ast = tinq.parseExpression('price * quantity')
console.log(AST.serialize(ast)) // 'price*quantity'

const total = tinq.compileExpression('price * quantity')
console.log(total({ price: 12, quantity: 3 })) // 36

const adults = tinq.compileExpression('People | filter: Age >= 18')
console.log(adults({ People: [{ Name: 'Ada', Age: 25 }, { Name: 'Ben', Age: 12 }] }))
// [{ Name: 'Ada', Age: 25 }]
```

Expressions support literals, property access, function calls, arithmetic,
comparisons, logical operators, ternary expressions, and filters. List filters
such as `filter`, `map`, `any`, and `every` evaluate their argument expressions
in the context of each list item.

**Empty lists are falsy.** Unlike JavaScript, TINQ treats empty arrays and other
empty iterable lists as false in boolean contexts, including `!`, `&&`, `||`,
ternary tests, template conditions, and list predicates.

## Text templates

Fields use `{[` and `]}` delimiters. Templates support content fields,
conditionals (`if`, `elseif`, `else`, `endif`), lists (`list`, `endlist`),
and optional field comments after `//`.

```js
const tinq = new Tinq()

const greet = tinq.compileTemplate(
  'Hello {[Name // display name]}!{[if Member]} Welcome back.{[endif]}'
)
console.log(greet({ Name: 'Ada', Member: true }))
// 'Hello Ada! Welcome back.'

const list = tinq.compileTemplate('{[list People]}- {[Name]}\n{[endlist]}')
console.log(list({ People: [{ Name: 'Ada' }, { Name: 'Ben' }] }))
// - Ada
// - Ben
```

Use `tinq.parseTemplate(text)` to obtain an AST without compiling it, and
`AST.serialize(ast)` to turn an AST back into normalized template text.
List parsing may insert a generated `{[_punc]}` field during serialization.
Field comments belong to template fields, rather than their expression ASTs;
`//` inside a quoted expression string is not a field comment.

These APIs parse and assemble text. DOCX/PDF extraction and file assembly
require separate tooling; TINQ's external-composition APIs do not implement
those file formats.

## Options and scope

```js
const tinq = new Tinq({
  includeLocation: true, // include source locations in parsed ASTs
  interpreter: true     // use the interpreter instead of generating JavaScript
})
```

Both options default to `false`. Expression locations are relative to the
expression string. Template locations are absolute character offsets within
the full template string. Locations use `loc.start.column` and
`loc.end.column`; fields may also expose expression, comment, and block spans.
Generated nodes may have no source location.

Evaluation normally resolves identifiers dynamically against the supplied data
and any enclosing `Scope` objects. Advanced integrations can pass an optional
explicit environment for lowered frame identifiers. The evaluation signature
is `evaluate(scope, env, assign, inputs)`; ordinary usage only needs `scope`.
Application-specific static type and model resolution belongs in the consuming
application.

## Development

```sh
npm ci
npm test
npm run build
```

ES module source lives in `src/*.mjs`. The build generates `index.cjs` for
CommonJS consumers; do not edit that bundle by hand. Tests are in `test/`.
Rollup currently reports expected external-dependency and circular-dependency
warnings.

## License and acknowledgments

TINQ is licensed under the [Mozilla Public License 2.0](LICENSE).
It includes code reworked from yatte (MPL-2.0), angular-expressions
(Unlicense), and AngularJS (MIT). See [third-party notices](THIRD_PARTY_NOTICES.md)
for upstream attribution and license texts.

MPL-2.0 permits TINQ to be used in a larger proprietary application. When
distributing it, preserve the applicable notices, make the MPL-covered source
(including modifications to covered files) available under MPL-2.0, and tell
recipients how to obtain that source. Separate proprietary files do not
automatically become MPL-covered merely by using TINQ. See the
[Mozilla FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) and the license for details.

Source: <https://github.com/opendocx/tinq>
