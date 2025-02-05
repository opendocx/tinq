import { describe, it } from 'mocha'
import chai from 'chai'
import { Tinql } from '../src/index.mjs'
import { toContentArray } from '../src/legacy.mjs'

var assert = chai.assert

const tinql = new Tinql()
const templateParser = tinql.templater
const parseTemplateLegacy = (text) => {
  // warning: this is a convenience function for these (old/legacy) unit tests, but it would be a bad idea
  // to do something like this in production. It does a lot of wasted work:  templateParser parses the whole template
  // (including all fields), whereas a contentArray does NOT have parsed fields, so after parsing all the individual
  // field ASTs, toContentArray immediately re-serializes them.
  const result = templateParser.ast(text)
  return toContentArray(result)
}

describe('Field parsing of simple conditionals', function () {
  it('should parse the FullName template', function () {
    const template = '{[First]} {[if Middle]}{[Middle]} {[endif]}{[Last]}{[if Suffix]} {[Suffix]}{[endif]}'
    const result = parseTemplateLegacy(template)
    assert.deepStrictEqual(result, [
      { type: 'Content', expr: 'First', id: '1' },
      ' ',
      { type: 'If', expr: 'Middle', id: '2', contentArray: [
        { type: 'Content', expr: 'Middle', id: '3' }, ' ', { type: 'EndIf', id: '4' }
      ] },
      { type: 'Content', expr: 'Last', id: '5' },
      { type: 'If', expr: 'Suffix', id: '6', contentArray: [
        ' ', { type: 'Content', expr: 'Suffix', id: '7' }, { type: 'EndIf', id: '8' }] }
    ])
  })
  it('should parse the if/endif template', function () {
    const template = '{[if true]}A{[endif]}'
    const result = parseTemplateLegacy(template)
    assert.deepStrictEqual(result, [
      { type: 'If', expr: 'true', id: '1', contentArray: ['A', { type: 'EndIf', id: '2' }] }
    ])
  })
  it('should parse the if/else/endif template', function () {
    const template = '{[if false]}A{[else]}B{[endif]}'
    const result = parseTemplateLegacy(template)
    assert.deepStrictEqual(result, [
      { type: 'If',
        expr: 'false',
        id: '1',
        contentArray: [
          'A',
          { type: 'Else', id: '2', contentArray: ['B', { type: 'EndIf', id: '3' }] }
        ] }
    ])
  })
  it('should parse the if/elseif/endif template', function () {
    const template = '{[if false]}A{[elseif true]}B{[endif]}'
    const result = parseTemplateLegacy(template)
    assert.deepStrictEqual(result, [
      { type: 'If',
        expr: 'false',
        id: '1',
        contentArray: [
          'A',
          { type: 'ElseIf', expr: 'true', id: '2', contentArray: ['B', { type: 'EndIf', id: '3' }] }
        ] }
    ])
  })
  it('should parse the if/elseif/else/endif template', function () {
    const template = '{[if false]}A{[elseif false]}B{[else]}C{[endif]}'
    const result = parseTemplateLegacy(template, false)
    assert.deepStrictEqual(result, [
      { type: 'If',
        expr: 'false',
        id: '1',
        contentArray: [
          'A',
          { type: 'ElseIf',
            expr: 'false',
            id: '2',
            contentArray: [
              'B',
              { type: 'Else', id: '3', contentArray: ['C', { type: 'EndIf', id: '4' }] }
            ] }
        ] }
    ])
  })
  it('should parse the if/elseif/elseif/else/endif template', function () {
    const template = '{[if false]}A{[elseif false]}B{[elseif false]}C{[else]}D{[endif]}'
    const result = parseTemplateLegacy(template, false)
    assert.deepStrictEqual(result, [
      { type: 'If',
        expr: 'false',
        id: '1',
        contentArray: [
          'A',
          { type: 'ElseIf',
            expr: 'false',
            id: '2',
            contentArray: [
              'B',
              { type: 'ElseIf',
                expr: 'false',
                id: '3',
                contentArray: [
                  'C',
                  { type: 'Else', id: '4', contentArray: ['D', { type: 'EndIf', id: '5' }] }
                ] }
            ] }
        ] }
    ])
  })
  it('should reject the if/else/elseif/endif template', function () {
    const template = '{[if false]}A{[else]}B{[elseif false]}C{[endif]}'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered {[elseif false]} in field 3 (at character position 23) when expecting an {[endif]}')
    }
  })
  it('should reject the if/else/else/endif template', function () {
    const template = '{[if false]}A{[else]}B{[else]}C{[endif]}'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered {[else]} in field 3 (at character position 23) when expecting an {[endif]}')
    }
  })
  it('should reject the if template (no endif)', function () {
    const template = '{[if true]}A'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered end of template when expecting an {[endif]}')
    }
  })
  it('should reject the if/else template (no endif)', function () {
    const template = '{[if true]}A{[else]}B'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered end of template when expecting an {[endif]}')
    }
  })
  it('should reject the if/endif/endif template', function () {
    const template = '{[if true]}A{[endif]}{[endif]}'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered {[endif]} in field 3 (at character position 22) when not expected')
    }
  })
  it('should reject the if/endif/else template', function () {
    const template = '{[if true]}A{[endif]}{[else]}B'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered {[else]} in field 3 (at character position 22) when not expected')
    }
  })
  it('should reject the if/endif/elseif template', function () {
    const template = '{[if true]}A{[endif]}{[elseif false]}B'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered {[elseif false]} in field 3 (at character position 22) when not expected')
    }
  })
})

// describe('new-and-improved text template parsing', function () {
//   it('should parse fields out of a multi-line template', function () {
//     const template = 'what\nhappens when {[IDontKnow]}{[WhatWillHappen]}\nnow'
//     const parsed = textTemplater.parseRawTemplate(template)
//     const result = textTemplater.validateParsedTemplate(parsed)
//   })
// })

describe('Field parsing of nested conditionals', function () {
  it('should parse the if/if/endif/elseif/if/endif/else/if/endif/endif template', function () {
    const template = '{[if false]}{[if true]}A{[endif]}{[elseif false]}{[if true]}B{[endif]}{[else]}{[if true]}C{[endif]}{[endif]}'
    const result = parseTemplateLegacy(template, false)
    assert.deepStrictEqual(result, [
      { type: 'If',
        expr: 'false',
        id: '1',
        contentArray: [
          { type: 'If', expr: 'true', id: '2', contentArray: ['A', { type: 'EndIf', id: '3' }] },
          { type: 'ElseIf',
            expr: 'false',
            id: '4',
            contentArray: [
              { type: 'If', expr: 'true', id: '5', contentArray: ['B', { type: 'EndIf', id: '6' }] },
              { type: 'Else',
                id: '7',
                contentArray: [
                  { type: 'If', expr: 'true', id: '8', contentArray: ['C', { type: 'EndIf', id: '9' }] },
                  { type: 'EndIf', id: '10' }
                ] }
            ] }
        ] }
    ])
  })
  it('should parse the if/if/elseif/else/endif/elseif/if/elseif/else/endif/else/if/elseif/else/endif/endif template', function () {
    const template = '{[if false]}{[if false]}A{[elseif false]}B{[else]}C{[endif]}{[elseif false]}{[if true]}D{[elseif false]}E{[else]}F{[endif]}{[else]}{[if false]}G{[elseif false]}H{[else]}I{[endif]}{[endif]}'
    const result = parseTemplateLegacy(template, false)
    assert.deepStrictEqual(result, [
      { type: 'If',
        expr: 'false',
        id: '1',
        contentArray: [
          { type: 'If',
            expr: 'false',
            id: '2',
            contentArray: [
              'A',
              { type: 'ElseIf',
                expr: 'false',
                id: '3',
                contentArray: [
                  'B',
                  { type: 'Else', id: '4', contentArray: ['C', { type: 'EndIf', id: '5' }] }
                ] }
            ] },
          { type: 'ElseIf',
            expr: 'false',
            id: '6',
            contentArray: [
              { type: 'If',
                expr: 'true',
                id: '7',
                contentArray: [
                  'D',
                  { type: 'ElseIf',
                    expr: 'false',
                    id: '8',
                    contentArray: [
                      'E',
                      { type: 'Else', id: '9', contentArray: ['F', { type: 'EndIf', id: '10' }] }
                    ] }
                ] },
              { type: 'Else',
                id: '11',
                contentArray: [
                  { type: 'If',
                    expr: 'false',
                    id: '12',
                    contentArray: [
                      'G',
                      { type: 'ElseIf',
                        expr: 'false',
                        id: '13',
                        contentArray: [
                          'H',
                          { type: 'Else', id: '14', contentArray: ['I', { type: 'EndIf', id: '15' }] }
                        ] }
                    ] },
                  { type: 'EndIf', id: '16' }
                ] }
            ] }
        ] }
    ])
  })
})

describe('Field parsing of lists and nested lists', function () {
  it('should parse the list/endlist template', function () {
    const template = '{[list []]}{[a]}{[endlist]}'
    const result = parseTemplateLegacy(template, false)
    assert.deepStrictEqual(result, [
      { type: 'List',
        expr: '[]',
        id: '1',
        contentArray: [
          { type: 'Content', expr: 'a', id: '2' },
          { type: 'Content', expr: '_punc' },
          { type: 'EndList', id: '3' }
        ] }
    ])
  })
  it('should parse the list/list/endlist/endlist template', function () {
    const template = '{[list []]}A: {[list inner]}{[a]}{[endlist inner]}{[endlist []]}'
    const result = parseTemplateLegacy(template, false)
    assert.deepStrictEqual(result, [
      { type: 'List',
        expr: '[]',
        id: '1',
        contentArray: [
          'A: ',
          { type: 'List',
            expr: 'inner',
            id: '2',
            contentArray: [
              { type: 'Content', expr: 'a', id: '3' },
              { type: 'Content', expr: '_punc' },
              { type: 'EndList', id: '4' }
            ] },
          { type: 'Content', expr: '_punc' },
          { type: 'EndList', id: '5' }
        ] }
    ])
  })
  it('should reject the list template (missing endlist)', function () {
    const template = '{[list []]}A'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered end of template when expecting an {[endlist]}')
    }
  })
  it('should reject the endlist template (missing list)', function () {
    const template = 'A{[endlist]}'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered {[endlist]} in field 1 (at character position 2) when not expected')
    }
  })
  it('should reject the list/list/endlist template (missing endlist)', function () {
    const template = '{[list []]}A{[list inner}B{[endlist]}'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered end of template when expecting an {[endlist]}')
    }
  })
  it('should reject the list/else/endlist template', function () {
    const template = '{[list []]}{[a]}{[else]}None{[endlist]}'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered {[else]} in field 3 (at character position 17) when expecting an {[endlist]}')
    }
  })
})

describe('Parsing nested conditionals and lists', function () {
  it('should parse the list/if/elseif/else/endif/endlist template', function () {
    const template = '{[list []]}{[if false]}A{[elseif a]}{[a]}{[else]}C{[endif]}, {[endlist]}'
    const result = parseTemplateLegacy(template, false)
    assert.deepStrictEqual(result, [
      { type: 'List',
        expr: '[]',
        id: '1',
        contentArray: [
          { type: 'If',
            expr: 'false',
            id: '2',
            contentArray: [
              'A',
              { type: 'ElseIf',
                expr: 'a',
                id: '3',
                contentArray: [
                  { type: 'Content', expr: 'a', id: '4' },
                  { type: 'Else', id: '5', contentArray: ['C', { type: 'EndIf', id: '6' }] }
                ] }
            ] },
          ', ',
          { type: 'Content', expr: '_punc' },
          { type: 'EndList', id: '7' }
        ] }
    ])
  })
  it('should parse the if/list/endlist/elseif/list/list/endlist/endlist/else/list/endlist/endif template', function () {
    const template = '{[if false]}{[list []]}{[test]}{[endlist]}{[elseif false]}A{[list outer]}B{[list inner]}C{[endlist]}D{[endlist]}E{[else]}F{[list another]}G{[endlist]}H{[endif]}'
    const result = parseTemplateLegacy(template, false)
    assert.deepStrictEqual(result, [
      { type: 'If',
        expr: 'false',
        id: '1',
        contentArray: [
          { type: 'List',
            expr: '[]',
            id: '2',
            contentArray: [
              { type: 'Content', expr: 'test', id: '3' },
              { type: 'Content', expr: '_punc' },
              { type: 'EndList', id: '4' }
            ] },
          { type: 'ElseIf',
            expr: 'false',
            id: '5',
            contentArray: [
              'A',
              { type: 'List',
                expr: 'outer',
                id: '6',
                contentArray: [
                  'B',
                  { type: 'List',
                    expr: 'inner',
                    id: '7',
                    contentArray: [
                      'C',
                      { type: 'Content', expr: '_punc' },
                      { type: 'EndList', id: '8' }
                    ] },
                  'D',
                  { type: 'Content', expr: '_punc' },
                  { type: 'EndList', id: '9' }
                ] },
              'E',
              { type: 'Else',
                id: '10',
                contentArray: [
                  'F',
                  { type: 'List',
                    expr: 'another',
                    id: '11',
                    contentArray: [
                      'G',
                      { type: 'Content', expr: '_punc' },
                      { type: 'EndList', id: '12' }
                    ] },
                  'H',
                  { type: 'EndIf', id: '13' }
                ] }
            ] }
        ] }
    ])
  })
  it('should reject the list/endlist/endif template', function () {
    const template = '{[list []]}A{[endlist]}{[endif]}'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered {[endif]} in field 3 (at character position 24) when not expected')
    }
  })
  it('should reject the list/endif template', function () {
    const template = '{[list []]}A{[endif]}'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered {[endif]} in field 2 (at character position 13) when expecting an {[endlist]}')
    }
  })
  it('should reject the list/endif/endlist template', function () {
    const template = '{[list []]}A{[endif]}{[endlist]}'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered {[endif]} in field 2 (at character position 13) when expecting an {[endlist]}')
    }
  })
  it('should reject the list/elseif/endlist template', function () {
    const template = '{[list []]}A{[elseif false]}{[endlist]}'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered {[elseif false]} in field 2 (at character position 13) when expecting an {[endlist]}')
    }
  })
  it('should reject the if/list/endif/endlist template', function () {
    const template = '{[if true]}A{[list source]}B{[endif]}C{[endlist]}'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered {[endif]} in field 3 (at character position 29) when expecting an {[endlist]}')
    }
  })
  it('should reject the list/if/else/endlist/endif template', function () {
    const template = '{[list source]}A{[if true]}B{[else]}C{[endlist]}{[endif]}'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered {[endlist]} in field 4 (at character position 38) when expecting an {[endif]}')
    }
  })
  it('should (for now) reject the if/list/endlist/elseif/list/else/endlist/endif template', function () {
    const template = '{[if false]}{[list source]}A{[endlist]}{[elseif true]}{[list second]}B{[else]}C{[endlist]}{[endif]}'
    try {
      const result = parseTemplateLegacy(template, false)
      assert.fail('expected error not thrown')
    } catch (err) {
      assert.strictEqual(err.message, 'Encountered {[else]} in field 6 (at character position 71) when expecting an {[endlist]}')
    }
  })
})

describe('Parsing and normalization of list filters', function () {
  it('should parse a filtered list template', function () {
    const template = '{[list Oceans | filter: AverageDepth > 3500]}\n * {[Name]}\n{[endlist]}'
    const compiled = parseTemplateLegacy(template)
    assert.deepStrictEqual(compiled, [
      {
        type: 'List',
        expr: 'Oceans|filter:AverageDepth>3500',
        id: '1',
        contentArray: [
          ' * ',
          {
            type: 'Content',
            expr: 'Name',
            id: '2'
          },
          {
            type: 'Content',
            expr: '_punc'
          },
          '\n',
          { type: 'EndList', id: '3' }
        ]
      }
    ])
  })
})

describe('Parsing and normalization of expressions', function () {
  // commented out because I'm not sure it's worthwhile to do template AST caching. How often do we
  // re-parse the same template over and over again?
  // it('should parse and cache an expression with no fields', function () {
  //   const template = 'static text'
  //   const expected = {
  //     type: "Program",
  //     body: [{ type: "TemplateElement", text: "static text" }]
  //   }
  //   const result = parser.parse(template)
  //   assert.deepStrictEqual(result, expected)
  //   const result2 = parser.parse(template)
  //   assert.deepStrictEqual(result2, expected)
  //   assert.strictEqual(result, result2)
  //   assert.isTrue(result === result2)
  // })
  it('should correctly normalize conditional and binary expressions', function () {
    const template = '{[a]} {[b ? b + " " : ""]}{[c]}'
    const result = parseTemplateLegacy(template)
    assert.deepStrictEqual(result, [
      {
        type: 'Content',
        expr: 'a',
        id: '1'
      },
      ' ',
      {
        type: 'Content',
        expr: 'b?b+" ":""',
        id: '2'
      },
      {
        type: 'Content',
        expr: 'c',
        id: '3'
      }
    ])
  })
})

describe('"Permissive" text template parsing (for real-time use during template editing)', function () {
  it('should parse an empty content field', function () {
    const template = '{[]}!'
    const result = parseTemplateLegacy(template)
    const expected = [
      { type: 'Content', expr: '', id: '1'}, //, line: 0, start: 0, end: 4 },
      '!'
    ]
    assert.deepStrictEqual(result, expected)
    // assert.deepStrictEqual(textTemplater.extractRawFields(template), [expected[0][0]])
    // assert.deepStrictEqual(textTemplater.serializeTemplate(result), template)
  })
//   it('should parse an empty if field', function () {
//     const template = 'x\r{[if]}y'
//     const result = textTemplater.parseRawTemplate(template)
//     const expected = [
//       ['x'],
//       [{ type: 'If', expr: '', id: '1', line: 1, start: 0, end: 6 }, 'y']]
//     assert.deepStrictEqual(result, expected)
//     assert.deepStrictEqual(textTemplater.extractRawFields(template), [expected[1][0]])
//     assert.deepStrictEqual(textTemplater.serializeTemplate(result), textTemplater.normalizeLineBreaks(template))
//   })
//   it('should parse an else with a comment', function () {
//     const template = '{[else something]}\r\nsomething else'
//     const result = textTemplater.parseRawTemplate(template)
//     const expected = [
//       [{ type: 'Else', comment: ' something', id: '1', line: 0, start: 0, end: 18 }],
//       ['something else']
//     ]
//     assert.deepStrictEqual(result, expected)
//     assert.deepStrictEqual(textTemplater.extractRawFields(template), [expected[0][0]])
//     assert.deepStrictEqual(textTemplater.serializeTemplate(result), textTemplater.normalizeLineBreaks(template))
//   })
//   it('should extract fields from an invalid template', function () {
//     const template = 'A{[if false]}B{[else comment]}C1\nC2{[elseif false]}D{[endif interrupted'
//     const result = textTemplater.extractRawFields(template)
//     const expected = [
//       { type: 'If', expr: 'false', id: '1', line: 0, start: 1, end: 13 },
//       { type: 'Else', comment: ' comment', id: '2', line: 0, start: 14, end: 30 },
//       { type: 'ElseIf', expr: 'false', id: '3', line: 1, start: 2, end: 18 }
//     ]
//     assert.deepStrictEqual(result, expected)
//     assert.deepStrictEqual(textTemplater.serializeTemplate(result), '{[if false]}{[else comment]}{[elseif false]}')
//   })
//   it('should extract and validate fields from a valid template', function () {
//     const template = 'A{[if false]}B{[elseif comment]}C1\nC2{[else]}D{[endif]}'
//     const result = textTemplater.extractRawFields(template)
//     const expected = [
//       { type: 'If', expr: 'false', id: '1', line: 0, start: 1, end: 13 },
//       { type: 'ElseIf', expr: 'comment', id: '2', line: 0, start: 14, end: 32 },
//       { type: 'Else', id: '3', line: 1, start: 2, end: 10 },
//       { type: 'EndIf', id: '4', line: 1, start: 11, end: 20 }
//     ]
//     assert.deepStrictEqual(result, expected)
//     const result2 = textTemplater.validateParsedTemplate(result)
//     assert.notStrictEqual(result2, null)
//   })
})
