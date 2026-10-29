# Third-party notices

TINQ includes code adapted from the projects below. TINQ's contributions and
modifications are licensed under MPL-2.0; the following notices preserve the
terms and attribution for upstream material. They do not offer the entire
TINQ project under the Unlicense or MIT license.

## yatte

- Project: https://github.com/opendocx/yatte
- Author: Lowell Stewart
- License: Mozilla Public License 2.0 (MPL-2.0); see [LICENSE](LICENSE).

TINQ reworks code from yatte, including template logic extraction, filters,
and evaluation infrastructure.

## angular-expressions

- Project: https://github.com/peerigon/angular-expressions
- Author: Peerigon and contributors
- Declared license: Unlicense

TINQ's expression lexer, parser, compiler, interpreter, and supporting utilities
include adaptations of angular-expressions code. The upstream version reviewed
for this attribution is [1.0.0](https://github.com/peerigon/angular-expressions/tree/058b4ae)
(2018-10-06).

angular-expressions declares the Unlicense, reproduced below. Its implementation
was extracted from AngularJS; the AngularJS MIT notice is also preserved in the
next section for inherited code.

```text
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org>
```

## AngularJS

- Project: https://github.com/angular/angular.js
- License: MIT

AngularJS is the upstream origin of the expression implementation extracted by
angular-expressions. The notice below is from
[AngularJS v1.5.8](https://github.com/angular/angular.js/blob/v1.5.8/LICENSE),
contemporary with angular-expressions' November 2016 source synchronization.
[Earlier AngularJS code](https://github.com/angular/angular.js/blob/6b049c74ccc9ee19688bb9bbe504c300e61776dc/LICENSE)
linked from angular-expressions' README carries the additional copyright notice:

```text
Copyright (c) 2010-2014 Google, Inc. http://angularjs.org
```

The MIT license and copyright notice are retained for the inherited portions:

```text
The MIT License

Copyright (c) 2010-2016 Google, Inc. http://angularjs.org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## AString

- Project: https://github.com/davidbonnet/astring
- License: MIT

Expression serialization and parenthesis/precedence logic in `src/ast.mjs`
include adaptations of AString. Its copyright and permission notice follows:

```text
Copyright (c) 2015, David Bonnet <david@bonnet.cc>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Package dependencies

Dependencies installed through npm retain their own licenses and notices.
This file documents code adapted into TINQ; it does not replace the license
files distributed with those dependencies.
