import { Tinq } from '../src/index.mjs'
import chai from 'chai'
var expect = chai.expect
var assert = chai.assert

chai.config.includeStack = true;

var testPhases = ['interpreter', 'compiler']

describe("YEvaluate Filters", function() {

  testPhases.forEach(phase => {
    const options = { interpreter: (phase === 'interpreter') }

    describe(phase, function() {
      var scope
      var evaluate
      var tinq = new Tinq(options)

      describe("value filters", function() {
        it("should apply the given filter", function() {
          evaluate = tinq.compileExpression('1.2345 | format:"000.00"')
          expect(
            evaluate({})
          ).to.equal("001.23")
        })

        describe('text formatting', function () {
          it('upper', function () {
            evaluate = tinq.compileExpression('text|upper')
            assert.strictEqual(evaluate({ text: 'hello World' }), 'HELLO WORLD')
          })
          it('lower', function () {
            evaluate = tinq.compileExpression('text|lower')
            assert.strictEqual(evaluate({ text: 'hello World' }), 'hello world')
          })
          it('initcap', function () {
            evaluate = tinq.compileExpression('text|initcap')
            assert.strictEqual(evaluate({ text: 'hello World' }), 'Hello World')
          })
          it('initcap forced lower', function () {
            evaluate = tinq.compileExpression('text|initcap:true')
            assert.strictEqual(evaluate({ text: 'hello World' }), 'Hello world')
          })
          it('titlecaps', function () {
            evaluate = tinq.compileExpression('text|titlecaps')
            assert.strictEqual(evaluate({ text: 'HELLO world' }), 'HELLO World')
          })
          it('titlecaps forced lower', function () {
            evaluate = tinq.compileExpression('text|titlecaps:true')
            assert.strictEqual(evaluate({ text: 'HELLO world' }), 'Hello World')
          })
          it('titlecaps with punctuation', function () {
            evaluate = tinq.compileExpression('text|titlecaps')
            const text = `RegExr's creator is gskinner.com.
        Edit the Expression & Text willy-nilly to see y'all's matches.
        "does john-doe know him," she said
        ¿que?
        «oi!»
        Em dashes—what?
        it’d be okay
        there'dn't've been a problem
        “what about when he said, 'dude!'? or ‘whoa.’?”
        oh ’tis a fine morning
        's wonderful
        änders wäre besser
        šaha
        удачи тебе`
            const expected = `RegExr's Creator Is Gskinner.Com.
        Edit The Expression & Text Willy-Nilly To See Y'all's Matches.
        "Does John-Doe Know Him," She Said
        ¿Que?
        «Oi!»
        Em Dashes—What?
        It’d Be Okay
        There'dn't've Been A Problem
        “What About When He Said, 'Dude!'? Or ‘Whoa.’?”
        Oh ’Tis A Fine Morning
        'S Wonderful
        Änders Wäre Besser
        Šaha
        Удачи Тебе`
            assert.strictEqual(evaluate({ text }), expected)
          })
          it('keepsections should be no-op', function () {
            evaluate = tinq.compileExpression('text|keepsections')
            assert.strictEqual(evaluate({ text: 'HELLO world' }), 'HELLO world')
          })
        })
        
        describe('number formatting', function () {
          it('cardinal', function () {
            evaluate = tinq.compileExpression('num|cardinal')
            assert.strictEqual(evaluate({ num: 1 }), 'one')
            assert.strictEqual(evaluate({ num: 2 }), 'two')
            assert.strictEqual(evaluate({ num: 3 }), 'three')
            assert.strictEqual(evaluate({ num: 4 }), 'four')
            assert.strictEqual(evaluate({ num: 5 }), 'five')
            assert.strictEqual(evaluate({ num: 6 }), 'six')
            assert.strictEqual(evaluate({ num: 7 }), 'seven')
            assert.strictEqual(evaluate({ num: 8 }), 'eight')
            assert.strictEqual(evaluate({ num: 9 }), 'nine')
            assert.strictEqual(evaluate({ num: 10 }), 'ten')
            assert.strictEqual(evaluate({ num: 11 }), 'eleven')
            assert.strictEqual(evaluate({ num: 12 }), 'twelve')
            assert.strictEqual(evaluate({ num: 13 }), 'thirteen')
            assert.strictEqual(evaluate({ num: 14 }), 'fourteen')
            assert.strictEqual(evaluate({ num: 15 }), 'fifteen')
            assert.strictEqual(evaluate({ num: 16 }), 'sixteen')
            assert.strictEqual(evaluate({ num: 17 }), 'seventeen')
            assert.strictEqual(evaluate({ num: 18 }), 'eighteen')
            assert.strictEqual(evaluate({ num: 19 }), 'nineteen')
            assert.strictEqual(evaluate({ num: 20 }), 'twenty')
            assert.strictEqual(evaluate({ num: 21 }), 'twenty-one')
            assert.strictEqual(evaluate({ num: 22 }), 'twenty-two')
            assert.strictEqual(evaluate({ num: 23 }), 'twenty-three')
            assert.strictEqual(evaluate({ num: 24 }), 'twenty-four')
            assert.strictEqual(evaluate({ num: 123 }), 'one hundred twenty-three')
          })
        
          it('cardinal - over one thousand', function () {
            evaluate = tinq.compileExpression('num|cardinal')
            assert.strictEqual(evaluate({ num: 1234 }), 'one thousand two hundred thirty-four')
          })
        
          it('cardinal - null input', function () {
            evaluate = tinq.compileExpression('num|cardinal')
            assert.strictEqual(evaluate({ num: null }), null)
          })
        
          it('cardinal - NaN input', function () {
            evaluate = tinq.compileExpression('num|cardinal')
            assert.strictEqual(evaluate({ num: NaN }), null)
          })
        
          it('ordinal', function () {
            evaluate = tinq.compileExpression('num|ordinal')
            assert.strictEqual(evaluate({ num: 1 }), 'first')
            assert.strictEqual(evaluate({ num: 2 }), 'second')
            assert.strictEqual(evaluate({ num: 3 }), 'third')
            assert.strictEqual(evaluate({ num: 4 }), 'fourth')
            assert.strictEqual(evaluate({ num: 5 }), 'fifth')
            assert.strictEqual(evaluate({ num: 6 }), 'sixth')
            assert.strictEqual(evaluate({ num: 7 }), 'seventh')
            assert.strictEqual(evaluate({ num: 8 }), 'eighth')
            assert.strictEqual(evaluate({ num: 9 }), 'ninth')
            assert.strictEqual(evaluate({ num: 10 }), 'tenth')
            assert.strictEqual(evaluate({ num: 11 }), 'eleventh')
            assert.strictEqual(evaluate({ num: 12 }), 'twelfth')
            assert.strictEqual(evaluate({ num: 13 }), 'thirteenth')
            assert.strictEqual(evaluate({ num: 14 }), 'fourteenth')
            assert.strictEqual(evaluate({ num: 15 }), 'fifteenth')
            assert.strictEqual(evaluate({ num: 16 }), 'sixteenth')
            assert.strictEqual(evaluate({ num: 17 }), 'seventeenth')
            assert.strictEqual(evaluate({ num: 18 }), 'eighteenth')
            assert.strictEqual(evaluate({ num: 19 }), 'nineteenth')
            assert.strictEqual(evaluate({ num: 20 }), 'twentieth')
            assert.strictEqual(evaluate({ num: 21 }), 'twenty-first')
            assert.strictEqual(evaluate({ num: 22 }), 'twenty-second')
            assert.strictEqual(evaluate({ num: 23 }), 'twenty-third')
            assert.strictEqual(evaluate({ num: 24 }), 'twenty-fourth')
            assert.strictEqual(evaluate({ num: 123 }), 'one hundred twenty-third')
          })
        
          it('ordSuffix', function () {
            evaluate = tinq.compileExpression('num|ordsuffix')
            assert.strictEqual(evaluate({ num: 1 }), 'st')
            assert.strictEqual(evaluate({ num: 2 }), 'nd')
            assert.strictEqual(evaluate({ num: 3 }), 'rd')
            assert.strictEqual(evaluate({ num: 4 }), 'th')
            assert.strictEqual(evaluate({ num: 5 }), 'th')
            assert.strictEqual(evaluate({ num: 6 }), 'th')
            assert.strictEqual(evaluate({ num: 7 }), 'th')
            assert.strictEqual(evaluate({ num: 8 }), 'th')
            assert.strictEqual(evaluate({ num: 9 }), 'th')
            assert.strictEqual(evaluate({ num: 10 }), 'th')
            assert.strictEqual(evaluate({ num: 11 }), 'th')
            assert.strictEqual(evaluate({ num: 12 }), 'th')
            assert.strictEqual(evaluate({ num: 13 }), 'th')
            assert.strictEqual(evaluate({ num: 14 }), 'th')
            assert.strictEqual(evaluate({ num: 15 }), 'th')
            assert.strictEqual(evaluate({ num: 16 }), 'th')
            assert.strictEqual(evaluate({ num: 17 }), 'th')
            assert.strictEqual(evaluate({ num: 18 }), 'th')
            assert.strictEqual(evaluate({ num: 19 }), 'th')
            assert.strictEqual(evaluate({ num: 20 }), 'th')
            assert.strictEqual(evaluate({ num: 21 }), 'st')
            assert.strictEqual(evaluate({ num: 22 }), 'nd')
            assert.strictEqual(evaluate({ num: 23 }), 'rd')
            assert.strictEqual(evaluate({ num: 24 }), 'th')
            assert.strictEqual(evaluate({ num: 111 }), 'th')
            assert.strictEqual(evaluate({ num: 123 }), 'rd')
          })
        
          it('base 26 - under 26', function () {
            evaluate = tinq.compileExpression('num|format:"a"')
            assert.strictEqual(evaluate({ num: 3 }), 'c')
          })
        
          it('base 26 - over 26', function () {
            evaluate = tinq.compileExpression('num|format:"A"')
            assert.strictEqual(evaluate({ num: 30 }), 'AD')
          })
        
          it('base 26 - null input', function () {
            evaluate = tinq.compileExpression('num|format:"a"')
            assert.strictEqual(evaluate({ num: null }), null)
          })
        
          it('base 26 - NaN input', function () {
            evaluate = tinq.compileExpression('num|format:"a"')
            assert.strictEqual(evaluate({ num: NaN }), null)
          })
        })
        
        describe('date formatting', function () {
          it('MM/dd/yyyy', function () {
            evaluate = tinq.compileExpression('d|format:"MM/dd/yyyy"')
            assert.strictEqual(evaluate({ d: new Date(2019, 0, 2) }), '01/02/2019')
          })
        
          it('MM/DD/YYYY (compat)', function () {
            evaluate = tinq.compileExpression('d|format:"MM/DD/YYYY"')
            assert.strictEqual(evaluate({ d: new Date(2019, 0, 2) }), '01/02/2019')
          })
        
          it('M/d/yyyy', function () {
            evaluate = tinq.compileExpression('d|format:"M/d/yyyy"')
            assert.strictEqual(evaluate({ d: new Date(2019, 0, 2) }), '1/2/2019')
          })
        
          it('M/D/YYYY (compat)', function () {
            evaluate = tinq.compileExpression('d|format:"M/D/YYYY"')
            assert.strictEqual(evaluate({ d: new Date(2019, 0, 2) }), '1/2/2019')
          })
        
          it('dd/MM/yyyy', function () {
            evaluate = tinq.compileExpression('d|format:"dd/MM/yyyy"')
            assert.strictEqual(evaluate({ d: new Date(2019, 0, 2) }), '02/01/2019')
          })
        
          it('DD/MM/YYYY (compat)', function () {
            evaluate = tinq.compileExpression('d|format:"DD/MM/YYYY"')
            assert.strictEqual(evaluate({ d: new Date(2019, 0, 2) }), '02/01/2019')
          })
        
          it('d/M/yyyy', function () {
            evaluate = tinq.compileExpression('d|format:"d/M/yyyy"')
            assert.strictEqual(evaluate({ d: new Date(2019, 0, 2) }), '2/1/2019')
          })
        
          it('D/M/YYYY (compat)', function () {
            evaluate = tinq.compileExpression('d|format:"D/M/YYYY"')
            assert.strictEqual(evaluate({ d: new Date(2019, 0, 2) }), '2/1/2019')
          })
        
          it('do \'day of\' MMMM yyyy', function () {
            evaluate = tinq.compileExpression('d|format:"do \'day of\' MMMM yyyy"')
            assert.strictEqual(evaluate({ d: new Date(2019, 0, 2) }), '2nd day of January 2019')
          })
        
          it('Do [day of] MMMM YYYY (compat)', function () {
            evaluate = tinq.compileExpression('d|format:"Do [day of] MMMM YYYY"')
            assert.strictEqual(evaluate({ d: new Date(2019, 0, 2) }), '2nd day of January 2019')
          })
        
          it('MMMM d, yyyy', function () {
            evaluate = tinq.compileExpression('d|format:"MMMM d, yyyy"')
            assert.strictEqual(evaluate({ d: new Date(2019, 0, 2) }), 'January 2, 2019')
          })
        
          it('MMMM D, YYYY (compat)', function () {
            evaluate = tinq.compileExpression('d|format:"MMMM D, YYYY"')
            assert.strictEqual(evaluate({ d: new Date(2019, 0, 2) }), 'January 2, 2019')
          })
        })
        
        describe('contains filter', function () {
          it('string array contains string', function () {
            evaluate = tinq.compileExpression('array|contains:"Joe"')
            const evaluator2 = tinq.compileExpression('array|contains:"John"')
            const data = { array: ['Margot', null, 'Joe', 'Lou'] }
            assert.strictEqual(evaluate(data), true)
            assert.strictEqual(evaluator2(data), false)
          })
          it('number array contains number', function () {
            evaluate = tinq.compileExpression('array|contains:3')
            const data = { array: [NaN, null, undefined, 4, 3, 2, 1] }
            assert.strictEqual(evaluate(data), true)
            data.array.splice(4, 1)
            assert.strictEqual(evaluate(data), false)
          })
          it('object array contains object', function () {
            const data = { array: [{ name: 'Joel' }, { name: 'Joe', lastName: 'Schmoe' }, null, undefined, { name: 'Joe' }] }
            evaluate = tinq.compileExpression('array|contains:{ name:"Joe" }')
            assert.strictEqual(evaluate(data), true)
            data.array.pop()
            assert.strictEqual(evaluate(data), false)
          })
          it('array of string wrappers contains string', function () {
            evaluate = tinq.compileExpression('array|contains:"Joe"')
            const evaluator2 = tinq.compileExpression('array|contains:"John"')
            const data = { array: [new String('Margot'), null, new String('Joe'), new String('Lou')] }
            data.array[0].First = 'Margot'
            data.array[0].Last = 'Hemingway'
            data.array[2].First = 'Joe'
            data.array[2].Last = 'Schmoe'
            data.array[3].First = 'Lou'
            assert.strictEqual(evaluate(data), true)
            assert.strictEqual(evaluator2(data), false)
          })
          it('string contains substring', function () {
            const data = { str: 'Quick brown fox jumps over the lazy dog' }
            evaluate = tinq.compileExpression('str|contains:"fox"')
            const evaluator2 = tinq.compileExpression('str|contains:"Fox"')
            assert.strictEqual(evaluate(data), true)
            assert.strictEqual(evaluator2(data), false)
          })
          // array of strings contains wrapped primitive String
          // array of wrapped primitive string contains object???
        })

      })

      describe("list filters", function() {
        it("should apply the filter filter", function() {
          evaluate = tinq.compileExpression('[1,2,3,4] | filter: this > 1')
          expect(
            evaluate({})
          ).to.deep.equal([2,3,4])
        })
        it("should apply the sort filter", function() {
          evaluate = tinq.compileExpression('[3,1,4,1,5,9] | sort: this')
          expect(
            evaluate({})
          ).to.deep.equal([1,1,3,4,5,9])
        })
        it("should apply the descending sort filter", function() {
          evaluate = tinq.compileExpression('[3,1,4,1,5,9] | sort: -this')
          expect(
            evaluate({})
          ).to.deep.equal([9,5,4,3,1,1])
        })
        it("should apply the sort filter with multiple mixed keys", function() {
          evaluate = tinq.compileExpression('[{a:"A",b:2},{a:"A",b:1},{a:"A",b:3},{a:"B",b:3},{a:"B",b:1},{a:"B",b:2}] | sort:-a:b')
          expect(
            evaluate({})
          ).to.deep.equal([{a:"B",b:1},{a:"B",b:2},{a:"B",b:3},{a:"A",b:1},{a:"A",b:2},{a:"A",b:3}])
        })
        it('allows lookup of/access to an object in a list using the find filter', function () {
          evaluate = tinq.compileExpression('(table|find:col1=="b").col2')
          const data = {
            table: [
              { col1: 'a', col2: 'A' },
              { col1: 'b', col2: 'B' },
              { col1: 'c', col2: 'C' },
            ],
          }
          expect(
            evaluate(data)
          ).to.deep.equal('B')
        })
        // it('allows lookup of/access to an object in a list with context using the find filter', function () {
        //   const evaluator = compiler.compile('(table|find:col1==value).col2')
        //   const data = {
        //     value: 'b',
        //     table: [
        //       { col1: 'a', col2: 'A' },
        //       { col1: 'b', col2: 'B' },
        //       { col1: 'c', col2: 'C' },
        //     ],
        //   }
        //   const scope = require('../src/index').Scope.pushObject(data)
        //   const result = scope.evaluate(evaluator)
        //   assert.strictEqual(result, 'B')
        // })

        // for purposes of the group filter's _key, wrapped strings must be simplified, so include wrapped strings...
        const surnameData = {
          surnames: [
            'Jones',
            'McGillicutty',
            'Jones',
            new String('Jones'),
            'Smith',
            new String('Jones'),
            'Smith',
            'Johnson'
          ]
        }
        // give one of the string objects a property (to test whether it is correctly ignored)
        surnameData.surnames[5].firstName = 'Ken'

        describe('group filter', function () {
          it('groups a list of strings', function () {
            evaluate = tinq.compileExpression('surnames|group:this')
            const value = evaluate(surnameData)
            const v = surnameData.surnames
            assert.deepStrictEqual(value, [
              { _key: 'Jones',        _values: [v[0], v[2], v[3], v[5]] },
              { _key: 'McGillicutty', _values: [v[1]] },
              { _key: 'Smith',        _values: [v[4], v[6]] },
              { _key: 'Johnson',      _values: [v[7]] },
            ])
          })

          it('simplifies a list of strings to unique values and alphabetizes them', function () {
            evaluate = tinq.compileExpression('surnames|group:this|map:_key|sort:this')
            const value = evaluate(surnameData)
            assert.deepStrictEqual(value, ['Johnson', 'Jones', 'McGillicutty', 'Smith'])
          })
        })

        describe('reduce filter', function () {
          it('sums a series of numbers (no initial value)', function () {
            evaluate = tinq.compileExpression('array|reduce:_result+this')
            const data = { array: [0, 1, 2, 3, 4] }
            const value = evaluate(data)
            assert.strictEqual(value, 10)
          })
          it('sums a series of numbers (with initial value)', function () {
            evaluate = tinq.compileExpression('array|reduce:_result+this:10')
            const data = { array: [0, 1, 2, 3, 4] }
            const value = evaluate(data)
            assert.strictEqual(value, 20)
          })
          it('flattens a nested array (no initial value)', function () {
            evaluate = tinq.compileExpression('array|reduce:_result.concat(this)')
            const data = { array: [[0], [1, 2], [3, 4]] }
            const value = evaluate(data)
            assert.deepStrictEqual(value, [0, 1, 2, 3, 4])
          })
          it('flattens a nested array (with initial value)', function () {
            evaluate = tinq.compileExpression('array|reduce:_result.concat(this):[]')
            const data = { array: [[0], [1, 2], [3, 4]] }
            const value = evaluate(data)
            assert.deepStrictEqual(value, [0, 1, 2, 3, 4])
          })
          it('flattens a nested array in an object array', function () {
            evaluate = tinq.compileExpression('array|reduce:_result.concat(nested):[]')
            const data = { array: [{ nested: [0] }, { nested: [1, 2] }, { nested: [3, 4] }] }
            let value = evaluate(data)
            assert.deepStrictEqual(value, [0, 1, 2, 3, 4])
          })
          it('concatenates a series of object properties (with initial value)', function () {
            evaluate = tinq.compileExpression('Children|reduce:_result+Name:""')
            const value = evaluate(data_Children)
            assert.strictEqual(value, "JohnAliceEricTedMarkYolandaBeth")
          })
        })

        const data_Children = {
          Children: [
            { Name: 'John', Birth: new Date(1970, 8, 5) },
            { Name: 'Alice', Birth: new Date(1970, 8, 5) },
            { Name: 'Eric', Birth: new Date(2007, 9, 24) },
            { Name: 'Ted', Birth: new Date(2007, 9, 24) },
            { Name: 'Mark', Birth: new Date(2007, 9, 24) },
            { Name: 'Yolanda', Birth: new Date(2000, 1, 1) },
            { Name: 'Beth', Birth: new Date(2000, 1, 1) }
          ]
        }

      })
    })
  })
})
