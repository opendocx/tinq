import { Compiler, AST } from '../src/index.mjs'
import { TV_Family_Data } from './test-data.mjs'
import chai from 'chai'
var expect = chai.expect
var assert = chai.assert

chai.config.includeStack = true;

describe('Parsing expressions ', function () {

  const compiler = new Compiler()

  describe('via exported API', function () {
    // it('should reuse a compiled expression rather than re-compiling it', function () {
    //   const evaluator = compiler.compile('A + B')
    //   const evaluator2 = compiler.compile('A + B')
    //   assert.strictEqual(evaluator, evaluator2)
    // })

    it('should correctly categorize the outcomes of a conditional expression', function () {
      const ast = compiler.parse('test ? consequent : alternative')
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, 'test?consequent:alternative')
      assert.deepStrictEqual(ast, {
        type: 'ConditionalExpression',
        test: {
          type: 'Identifier',
          name: 'test',
          // constant: false,
          loc: { start: { column: 0 }, end: { column: 4 } }
        },
        // fixed: true,
        consequent: {
          type: 'Identifier',
          name: 'consequent',
          // constant: false,
          loc: { start: { column: 7 }, end: { column: 17 } }
        },
        alternate: {
          type: 'Identifier',
          name: 'alternative',
          // constant: false,
          loc: { start: { column: 20 }, end: { column: 31 } }
        },
        // constant: false,
        loc: { start: { column: 0 } }
      })
    })

    it('re-compiling a normalized list filter expression produces the same normalization but does not go back to original AST', function () {
      // note: compiling a normalized list filter expression should produce the same AST as the original (non-normalized) list filter expression
      // we do this so downline features that depend on the AST can reliably know what they're going to get.
      compiler.cache = {}
      const expr = ' Families|any: Children|any: Birthdate > currentDate' // space at beginning is intentional, to avoid cached expression AST
      compiler.parser.options.includeLocation = false
      const ast = compiler.parse(expr)
      const normalized = AST.serialize(ast)
      // const evaluator = compiler.compile(expr)
      compiler.parser.options.includeLocation = true
      assert.deepStrictEqual(normalized, 'Families|any:Children|any:Birthdate>currentDate')
      assert.deepStrictEqual(ast, ListFilterAST)
    })

    it('correctly normalizes an expression with functions and this', function () {
      const ast = compiler.parse('[].concat(Client, Spouse, Children)|filter: this')
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, '[].concat(Client,Spouse,Children)|filter:this')
    })

    it('correctly parses array concatenation and filtering out falsy values', function () {
      const ast = compiler.parse('[].concat(Client, Spouse, Children)|filter:this')
      assert.deepStrictEqual(ast, {
        type: 'ListFilterExpression',
        input: {
          type: 'CallExpression',
          callee: {
            type: 'MemberExpression',
            computed: false,
            object: { type: 'ArrayExpression', elements: [] },
            property: { type: 'Identifier', name: 'concat', loc: { start: { column: 3 }, end: { column: 9 } } }
          },
          arguments: [
            { type: 'Identifier', name: 'Client', loc: { start: { column: 10 }, end: { column: 16 } } },
            { type: 'Identifier', name: 'Spouse', loc: { start: { column: 18 }, end: { column: 24 } } },
            { type: 'Identifier', name: 'Children', loc: { start: { column: 26 }, end: { column: 34 } } }
          ]
        },
        filter: { type: 'Identifier', name: 'filter', loc: { start: { column: 36 }, end: { column: 42 } } },
        lambda: { type: 'ThisExpression' }, // in yatte this was a LocalsExpression instead??
        arguments: [],
        rtl: false
      })
    })

    it('allow chaining of "any" filter (and/or its "some" alias)', function () {
      compiler.parser.options.includeLocation = false
      const ast = compiler.parse('Families | some: Children|any: Birthdate > currentDate')
      compiler.parser.options.includeLocation = true
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, 'Families|some:Children|any:Birthdate>currentDate') // true normalization would change some -> any ... 
      const temphackAst = { ...ListFilterAST, filter: { ...ListFilterAST.filter, name: 'some' } }
      assert.deepStrictEqual(ast, temphackAst)
    })

    const ListFilterAST = {
      type: 'ListFilterExpression',
      input: { type: 'Identifier', name: 'Families' },
      filter: { type: 'Identifier', name: 'any' },
      lambda: {
        type: 'ListFilterExpression',
        input: { type: 'Identifier', name: 'Children' },
        filter: { type: 'Identifier', name: 'any' },
        lambda: {
          type: 'BinaryExpression',
          operator: '>',
          left: { type: 'Identifier', name: 'Birthdate' },
          right: { type: 'Identifier', name: 'currentDate' },
        },
        arguments: [],
        rtl: true,
      },
      arguments: [],
      rtl: true,
    }

    it('allow chaining of the "any" filter with nested objects', function () {
      compiler.parser.options.includeLocation = false
      const ast = compiler.parse('obj1.list1|any:obj2.list2|any:prop3')
      const normalized = AST.serialize(ast)
      compiler.parser.options.includeLocation = true
      assert.deepStrictEqual(normalized, 'obj1.list1|any:obj2.list2|any:prop3')
      assert.deepStrictEqual(ast, nestedAny_AST)
      // ensure the normalized expression produces the same AST but does not get recompiled!
      compiler.parser.options.includeLocation = false
      const ast2 = compiler.parse(' ' + normalized)
      const normalized2 = AST.serialize(ast2)
      compiler.parser.options.includeLocation = true
      assert.deepStrictEqual(ast2, ast)
      assert.deepStrictEqual(normalized2, normalized)
    })

    const nestedAny_AST = {
      type: 'ListFilterExpression',
      input: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'obj1' },
        property: { type: 'Identifier', name: 'list1' },
        computed: false,
      },
      filter: { type: 'Identifier', name: 'any' },
      lambda: {
        type: 'ListFilterExpression',
        input: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'obj2' },
          property: { type: 'Identifier', name: 'list2' },
          computed: false,
        },
        filter: { type: 'Identifier', name: 'any' },
        lambda: { type: 'Identifier', name: 'prop3' },
        arguments: [],
        rtl: true,
      },
      arguments: [],
      rtl: true,
    }

  //   it('cleans up parse errors thrown by angular-expressions', function () {
  //     assert.throws(() => compiler.compile('members|name!=this.name'), // forgot "filter" filter
  //       {
  //         name: 'SyntaxError',
  //         message: "Syntax Error: '!=' is an unexpected token:\nmembers|name!=this.name\n            ^^"
  //       })
  //     assert.throws(() => compiler.compile('ProbateClient.MaritalStatus == “Married”'), // used curly quotes
  //       {
  //         name: 'SyntaxError',
  //         message: "Lexer Error: Unexpected next character '“':\nProbateClient.MaritalStatus == “Married”\n                               ^" })
  //     assert.throws(() => compiler.compile('Name|UPPER'), // non-existing filter
  //       {
  //         name: 'SyntaxError',
  //         message: 'Syntax Error: did you refer to a nonexistent filter?\nName|UPPER'
  //       })
  //   })

  //   it('correctly serializes a simple AST as an expression', function () {
  //     const evaluator = compiler.compile('!test')
  //     assert.deepStrictEqual(evaluator.ast, {
  //       type: AST.UnaryExpression,
  //       prefix: true,
  //       operator: '!',
  //       argument: {
  //         type: AST.Identifier,
  //         name: 'test',
  //         constant: false
  //       },
  //       constant: false
  //     })
  //     assert.deepStrictEqual(evaluator.normalized, '!test')
  //   })

  //   it('correctly serializes grouping in nested conditionals (grouping needed)', function () {
  //     const evaluator = compiler.compile(`a
  //   ? b
  //     ? (c|map:C)
  //     : (d|map:D)
  //   : e`)
  //     assert.deepStrictEqual(evaluator.normalized, 'a?b?(c|map:"C"):(d|map:"D"):e')
  //   })

  //   it('correctly serializes grouping in nested conditionals (complex)', function () {
  //     const evaluator = compiler.compile(`
  // (a ? b : c)
  //   ? (
  //     d
  //       ? e
  //       : (
  //         f
  //           ? g
  //           : h
  //       )
  //   )
  //   : i`)
  //     assert.deepStrictEqual(evaluator.normalized, '(a?b:c)?d?e:f?g:h:i')
  //   })

  //   it('correctly serializes grouping in object literals (grouping needed)', function () {
  //     const evaluator = compiler.compile('{ a: a, b: (b|map:B) }')
  //     assert.deepStrictEqual(evaluator.normalized, '{a:a,b:(b|map:"B")}')
  //   })

  //   it('correctly serializes grouping in array elements (grouping needed)', function () {
  //     const evaluator = compiler.compile('[ a, (b|format:"9") ]')
  //     assert.deepStrictEqual(evaluator.normalized, '[a,(b|format:"9")]')
  //   })

  //   it('correctly serializes grouping in array elements (2)', function () {
  //     const evaluator = compiler.compile('[ (b|format:"9") ]')
  //     assert.deepStrictEqual(evaluator.normalized, '[(b|format:"9")]')
  //   })

  //   it('correctly serializes grouping in function calls (grouping needed)', function () {
  //     const evaluator = compiler.compile('a.func((b|map: B))')
  //     assert.deepStrictEqual(evaluator.normalized, 'a.func((b|map:"B"))')
  //   })

  //   it('correctly serializes grouping in function calls (2)', function () {
  //     const evaluator = compiler.compile('a.func((b|map: B), c)')
  //     assert.deepStrictEqual(evaluator.normalized, 'a.func((b|map:"B"),c)')
  //   })

  //   it('correctly serializes grouping in function calls (3)', function () {
  //     const evaluator = compiler.compile('(a|map: A).func(b)')
  //     assert.deepStrictEqual(evaluator.normalized, '(a|map:"A").func(b)')
  //   })

  //   it('correctly "pretty serializes" list filters', function () {
  //     const evaluator = compiler.compile('a|map:b')
  //     const after = yatte.Engine.AST.serialize(evaluator.ast, true) // true means don't embed child expressions in literals
  //     assert.deepStrictEqual(after, 'a|map:b')
  //   })

  //   it('correctly normalizes chained list filters', function () {
  //     const evaluator = compiler.compile('a|map:b|map:c')
  //     assert.deepStrictEqual(evaluator.normalized, 'a|map:"b"|map:"c"')
  //     const after = yatte.Engine.AST.serialize(evaluator.ast, true)
  //     assert.deepStrictEqual(after, 'a|map:b|map:c')
  //   })

  //   it('correctly normalizes and serializes nested list filters (1)', function () {
  //     const evaluator = compiler.compile('a|map:(b|map:c)')
  //     assert.deepStrictEqual(evaluator.normalized, 'a|map:"b|map:&quot;c&quot;"', "Bad normalization")
  //     const after = yatte.Engine.AST.serialize(evaluator.ast, true)
  //     assert.deepStrictEqual(after, 'a|map:b|map:c', "Bad serialization")
  //   })

  //   it('correctly normalizes and serializes nested list filters (2)', function () {
  //     const evaluator = compiler.compile('(a|map:b)|map:c') // map is LTR, so same as with no parens
  //     assert.deepStrictEqual(evaluator.normalized, 'a|map:"b"|map:"c"', "Bad normalization")
  //     const after = yatte.Engine.AST.serialize(evaluator.ast, true)
  //     assert.deepStrictEqual(after, 'a|map:b|map:c', "Bad serialization")
  //   })

  //   it('correctly normalizes and serializes chained rtl list filters', function () {
  //     const evaluator = compiler.compile('a|any:b|any:c')
  //     assert.deepStrictEqual(evaluator.normalized, 'a|any:"b|any:&quot;c&quot;"', "Bad normalization")
  //     const after = yatte.Engine.AST.serialize(evaluator.ast, true)
  //     assert.deepStrictEqual(after, 'a|any:b|any:c', "Bad serialization")
  //   })

  //   it('correctly normalizes and serializes nested rtl list filters (1)', function () {
  //     const evaluator = compiler.compile('a|any:(b|any:c)') // any is RTL, so same as with no parens
  //     assert.deepStrictEqual(evaluator.normalized, 'a|any:"b|any:&quot;c&quot;"', "Bad normalization")
  //     const after = yatte.Engine.AST.serialize(evaluator.ast, true)
  //     assert.deepStrictEqual(after, 'a|any:b|any:c', "Bad serialization")
  //   })

  //   it('correctly normalizes and serializes an ugly nested mess', function () {
  //     const evaluator = compiler.compile('a|map:b|any:c|map:d|any:e|map:f') // map is LTR, any is RTL
  //     assert.deepStrictEqual(evaluator.normalized, '((a|map:"b")|any:"c"|map:"d")|any:"e"|map:"f"', "Bad normalization")
  //     // this fails but I'm not sweatin' it yet...
  //     // const after = yatte.Engine.AST.serialize(evaluator.ast, true)
  //     // assert.deepStrictEqual(after, 'a|map:b|any:c|map:d|any:e|map:f', "Bad serialization")
  //   })

  //   // not supported:
  //   // it('correctly normalizes and serializes nested rtl list filters (2)', function () {
  //   //   const evaluator = compiler.compile('(a|any:b)|any:c')
  //   //   assert.deepStrictEqual(evaluator.normalized, 'a|any:"b"|any:"c"')
  //   //   const after = yatte.Engine.AST.serialize(evaluator.ast, true)
  //   //   assert.deepStrictEqual(after, 'a|any:b|any:c')
  //   // })

  })
})
