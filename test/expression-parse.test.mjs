import { Tinq, AST } from '../src/index.mjs'
import { TV_Family_Data } from './test-data.mjs'
import chai from 'chai'
var expect = chai.expect
var assert = chai.assert

chai.config.includeStack = true;

describe('Parsing expressions ', function () {

  const tinq = new Tinq({includeLocation: true})

  describe('via exported API', function () {
    // it('should reuse a compiled expression rather than re-compiling it', function () {
    //   const ast = compiler.parse('A + B')
    //   const evaluator2 = compiler.compile('A + B')
    //   assert.strictEqual(evaluator, evaluator2)
    // })

    it('should correctly categorize the outcomes of a conditional expression', function () {
      const ast = tinq.parseExpression('test ? consequent : alternative')
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
      tinq.cache = {}
      const expr = ' Families|any: Children|any: Birthdate > currentDate' // space at beginning is intentional, to avoid cached expression AST
      tinq.expressioner.options.includeLocation = false
      const ast = tinq.parseExpression(expr)
      const normalized = AST.serialize(ast)
      // const ast = compiler.parse(expr)
      tinq.expressioner.options.includeLocation = true
      assert.deepStrictEqual(normalized, 'Families|any:Children|any:Birthdate>currentDate')
      assert.deepStrictEqual(ast, ListFilterAST)
    })

    it('correctly normalizes an expression with functions and this', function () {
      const ast = tinq.parseExpression('[].concat(Client, Spouse, Children)|filter: this')
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, '[].concat(Client,Spouse,Children)|filter:this')
    })

    it('correctly parses array concatenation and filtering out falsy values', function () {
      const ast = tinq.parseExpression('[].concat(Client, Spouse, Children)|filter:this')
      assert.deepStrictEqual(ast, {
        type: 'FilterExpression',
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
        lambda: true,
        rtl: false,
        arguments: [
          {
            type: 'LambdaExpression',
            expression: { type: 'ThisExpression', loc: { start: { column: 43 }, end: { column: 47 } } }, // in yatte this was a LocalsExpression instead
          },
        ],
      })
    })

    it('allow chaining of "any" filter (and/or its "some" alias)', function () {
      tinq.expressioner.options.includeLocation = false
      const ast = tinq.parseExpression('Families | some: Children|any: Birthdate > currentDate')
      tinq.expressioner.options.includeLocation = true
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, 'Families|any:Children|any:Birthdate>currentDate')
      assert.deepStrictEqual(ast, ListFilterAST)
    })

    const ListFilterAST = {
      type: 'FilterExpression',
      input: { type: 'Identifier', name: 'Families' },
      filter: { type: 'Identifier', name: 'any' },
      lambda: true,
      rtl: true,
      arguments: [
        {
          type: 'LambdaExpression',
          expression: {
            type: 'FilterExpression',
            input: { type: 'Identifier', name: 'Children' },
            filter: { type: 'Identifier', name: 'any' },
            lambda: true,
            rtl: true,
            arguments: [
              {
                type: 'LambdaExpression',
                expression: {
                  type: 'BinaryExpression',
                  operator: '>',
                  left: { type: 'Identifier', name: 'Birthdate' },
                  right: { type: 'Identifier', name: 'currentDate' },
                },
              },
            ],
          },
        },
      ],
    }

    it('allow chaining of the "any" filter with nested objects', function () {
      tinq.expressioner.options.includeLocation = false
      const ast = tinq.parseExpression('obj1.list1|any:obj2.list2|any:prop3')
      const normalized = AST.serialize(ast)
      tinq.expressioner.options.includeLocation = true
      assert.deepStrictEqual(normalized, 'obj1.list1|any:obj2.list2|any:prop3')
      assert.deepStrictEqual(ast, nestedAny_AST)
      // ensure the normalized expression produces the same AST but does not get recompiled!
      tinq.expressioner.options.includeLocation = false
      const ast2 = tinq.parseExpression(' ' + normalized)
      const normalized2 = AST.serialize(ast2)
      tinq.expressioner.options.includeLocation = true
      assert.deepStrictEqual(ast2, ast)
      assert.deepStrictEqual(normalized2, normalized)
    })

    const nestedAny_AST = {
      type: 'FilterExpression',
      input: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'obj1' },
        property: { type: 'Identifier', name: 'list1' },
        computed: false,
      },
      filter: { type: 'Identifier', name: 'any' },
      lambda: true,
      rtl: true,
      arguments: [
        {
          type: 'LambdaExpression',
          expression: {
            type: 'FilterExpression',
            input: {
              type: 'MemberExpression',
              object: { type: 'Identifier', name: 'obj2' },
              property: { type: 'Identifier', name: 'list2' },
              computed: false,
            },
            filter: { type: 'Identifier', name: 'any' },
            lambda: true,
            rtl: true,
            arguments: [
              {
                type: 'LambdaExpression',
                expression: { type: 'Identifier', name: 'prop3' },
              },
            ],
          },
        },
      ],
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

    it('correctly serializes grouping in nested conditionals (grouping needed)', function () {
      const ast = tinq.parseExpression(`a
        ? b
          ? (c|map:C)
          : (d|map:D)
        : e`)
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, 'a?b?(c|map:C):(d|map:D):e')
    })

    it('correctly serializes grouping in nested conditionals (complex)', function () {
      const ast = tinq.parseExpression(`
        (a ? b : c)
          ? (
            d
              ? e
              : (
                f
                  ? g
                  : h
              )
          )
          : i`)
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, '(a?b:c)?d?e:f?g:h:i')
    })

    it('correctly serializes grouping in object literals (grouping needed)', function () {
      const ast = tinq.parseExpression('{ a: a, b: (b|map:B) }')
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, '{a:a,b:(b|map:B)}')
    })

    it('correctly serializes grouping in array elements (grouping needed)', function () {
      const ast = tinq.parseExpression('[ a, (b|format:"9") ]')
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, '[a,(b|format:"9")]')
    })

    it('correctly serializes grouping in array elements (2)', function () {
      const ast = tinq.parseExpression('[ (b|format:"9") ]')
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, '[(b|format:"9")]')
    })

    it('correctly serializes grouping in function calls (grouping needed)', function () {
      const ast = tinq.parseExpression('a.func((b|map: B))')
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, 'a.func((b|map:B))')
    })

    it('correctly serializes grouping in function calls (2)', function () {
      const ast = tinq.parseExpression('a.func((b|map: B), c)')
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, 'a.func((b|map:B),c)')
    })

    it('correctly serializes grouping in function calls (3)', function () {
      const ast = tinq.parseExpression('(a|map: A).func(b)')
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, '(a|map:A).func(b)')
    })

    it('correctly normalizes chained list filters', function () {
      const ast = tinq.parseExpression('a|map:b|map:c') // no parens, so how-ever it gets parsed initially,
      assert.strictEqual(ast.input.input.name, 'a')
      const normalized = AST.serialize(ast) // the serialized output should also not have parentheses
      assert.deepStrictEqual(normalized, 'a|map:b|map:c')
    })

    it('correctly normalizes and serializes nested list filters (1)', function () {
      const ast = tinq.parseExpression('a|map:(b|map:c)') // map is LTR, so parens change the parsed structure
      assert.strictEqual(ast.input.name, 'a', "Parse fail")
      const normalized = AST.serialize(ast) // must retain parentheses!
      assert.deepStrictEqual(normalized, 'a|map:(b|map:c)', "Serialization fail")
    })

    it('correctly normalizes and serializes nested list filters (2)', function () {
      const ast = tinq.parseExpression('(a|map:b)|map:c') // map is LTR, so these parens do NOT change parsed structure
      const normalized = AST.serialize(ast) // ... and they are not created during re-serialization
      assert.deepStrictEqual(normalized, 'a|map:b|map:c', "Bad normalization")
    })

    it('correctly normalizes and serializes chained rtl list filters', function () {
      const ast = tinq.parseExpression('a|any:b|any:c') // no parens, so how-ever it gets parsed initially
      assert.strictEqual(ast.input.name, 'a', "Parse fail") // // (which will be different from |map, because |any is RTL)
      const normalized = AST.serialize(ast) // the serialized output should also not have parentheses
      assert.deepStrictEqual(normalized, 'a|any:b|any:c', "Bad normalization")
    })

    it('correctly normalizes and serializes nested rtl list filters (1)', function () {
      const ast = tinq.parseExpression('a|any:(b|any:c)') // any is RTL, so same as with no parens
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, 'a|any:b|any:c', "Bad normalization")
    })

    it('correctly normalizes and serializes nested rtl list filters (2)', function () {
      const ast = tinq.parseExpression('(a|any:b)|any:c') // even though this expr is nonsensical, it should still parse
      assert.strictEqual(ast.input.input.name, 'a', "Parse fail")
      assert.strictEqual(ast.input.arguments[0].expression.name, 'b', "Parse fail")
      assert.strictEqual(ast.arguments[0].expression.name, 'c', "Parse fail")
      const normalized = AST.serialize(ast) // ... and the parentheses should survive the parse/serialization
      assert.deepStrictEqual(normalized, '(a|any:b)|any:c', "Serialization fail")
    })

    it('correctly normalizes and serializes an ugly nested mess', function () {
      const ast = tinq.parseExpression('a|map:b|any:c|map:d|any:e|map:f') // map is LTR, any is RTL
      // but because no RTLs are adjacent to other RTLs, the RTL doesn't do anything and it's all
      // stacked up the same as if everything were LTR
      assert.strictEqual(ast.filter.name, 'map')
      assert.strictEqual(ast.arguments[0].expression.name, 'f')
      assert.strictEqual(ast.input.filter.name, 'any')
      assert.strictEqual(ast.input.arguments[0].expression.name, 'e')
      assert.strictEqual(ast.input.input.filter.name, 'map')
      assert.strictEqual(ast.input.input.arguments[0].expression.name, 'd')
      assert.strictEqual(ast.input.input.input.arguments[0].expression.name, 'c')
      // etc.
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, 'a|map:b|any:c|map:d|any:e|map:f', "Bad normalization")
    })

    it('correctly normalizes and serializes an uglier nesteder mess', function () {
      const ast = tinq.parseExpression('a|map:b|map:c|any:d|any:e|any:f') // map is LTR, any is RTL
      assert.strictEqual(ast.filter.name, 'any')
      assert.strictEqual(ast.input.input.input.name, 'a')
      assert.strictEqual(ast.input.input.arguments[0].expression.name, 'b')
      assert.strictEqual(ast.input.arguments[0].expression.name, 'c')
      assert.strictEqual(ast.arguments[0].expression.input.name, 'd')
      assert.strictEqual(ast.arguments[0].expression.arguments[0].expression.input.name, 'e')
      assert.strictEqual(ast.arguments[0].expression.arguments[0].expression.arguments[0].expression.name, 'f')
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, 'a|map:b|map:c|any:d|any:e|any:f', "Bad normalization")
    })

    it('correctly normalizes and serializes parentheses in messy list filter chains', function () {
      const ast = tinq.parseExpression('a|map:(b|map:(c|any:d))|any:e|any:f') // map is LTR, any is RTL
      assert.strictEqual(ast.filter.name, 'any')
      assert.strictEqual(ast.input.input.name, 'a')
      assert.strictEqual(ast.input.arguments[0].expression.input.name, 'b')
      assert.strictEqual(ast.input.arguments[0].expression.arguments[0].expression.input.name, 'c')
      assert.strictEqual(ast.input.arguments[0].expression.arguments[0].expression.arguments[0].expression.name, 'd')
      assert.strictEqual(ast.arguments[0].expression.input.name, 'e')
      assert.strictEqual(ast.arguments[0].expression.arguments[0].expression.name, 'f')
      const normalized = AST.serialize(ast)
      assert.deepStrictEqual(normalized, 'a|map:(b|map:(c|any:d))|any:e|any:f', "Bad normalization")
    })

  })
})
