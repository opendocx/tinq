import { describe, it } from 'mocha'
import chai from 'chai'
import path from 'path'
import { fileURLToPath } from 'node:url'
import { Tinq, AST } from '../src/index.mjs'
import { useScope } from '../src/scope.mjs'
import { readJSONFile } from './test-utils.mjs'
import { TV_Family_Data } from './test-data.mjs'

var assert = chai.assert
var expect = chai.expect

var testPhases = ['interpreter', 'compiler']

describe("tinql.templater", function() {

  testPhases.forEach(phase => {
    const options = { interpreter: (phase === 'interpreter') }

    describe(phase, function() {
      var scope;
      var evaluate;
      var tinql = new Tinq(options)
  
      beforeEach(function() {
        scope = {
          ship: {
            pirate: {
              name: "Jenny"
            }
          }
        }
      })
  
      it("should return a function", function() {
        var c = tinql.compileTemplate("")
        expect(c).to.be.a("function")
      })
  
      it("should throw an error if the given value is not a string", function() {
        expect(function() {
          tinql.compileTemplate()
        }).to.throw("src must be a string or AST object; instead saw 'undefined'")
      })

      // it("should expose the ast", function() {
      //   expect(tinql.compileTemplate("tmp").ast).to.be.a("object")
      // })

      describe('Assembling text templates', function () {
        it('should assemble a simple template', function () {
          const template = 'Hello {[planet]}!'
          evaluate = tinql.compileTemplate(template)
          // const data = TObject.pushObject({ planet: 'World' })
          const data = { planet: 'World' }
          const result = evaluate(data)
          assert.strictEqual(result, 'Hello World!')
        })
        // it('should compile a conditional expression', function () {
        //   evaluate = tinql.compileExpression('Middle?Middle+" ":""')
        //   console.log(evaluate.toString())
        // })
        it('should assemble the FullName template', function () {
          const template = '{[First]} {[if Middle]}{[Middle]} {[endif]}{[Last]}{[if Suffix]} {[Suffix]}{[endif]}'
          evaluate = tinql.compileTemplate(template)
          const data = { First: 'John', Last: 'Smith', Suffix: 'Jr.' }
          assert.strictEqual(evaluate(data), 'John Smith Jr.')
          data.Middle = 'W.'
          delete data.Suffix
          assert.strictEqual(evaluate(data), 'John W. Smith')
        })
        it('should assemble the if/endif template', function () {
          const template = '{[if true]}A{[endif]}'
          evaluate = tinql.compileTemplate(template)
          const data = {}
          const result = evaluate(data)
          assert.strictEqual(result, 'A')
        })
        it('should assemble the if/else/endif template', function () {
          const template = '{[if false]}A{[else]}B{[endif]}'
          evaluate = tinql.compileTemplate(template)
          const data = {}
          const result = evaluate(data)
          assert.strictEqual(result, 'B')
        })
        it('should assemble the if/elseif/endif template', function () {
          const template = '{[if false]}A{[elseif true]}B{[endif]}'
          evaluate = tinql.compileTemplate(template)
          const data = {}
          const result = evaluate(data)
          assert.strictEqual(result, 'B')
        })
        it('should assemble the if/elseif/else/endif template', function () {
          const template = '{[if false]}A{[elseif false]}B{[else]}C{[endif]}'
          evaluate = tinql.compileTemplate(template)
          const data = {}
          const result = evaluate(data)
          assert.strictEqual(result, 'C')
        })
        it('should assemble the oceans template', function () {
          const template = 'Oceans are:\n\n{[list Oceans]}\n * {[Name]} (Average depth {[AverageDepth]} m)\n{[endlist]}'
          evaluate = tinql.compileTemplate(template)
          const data = {
            Planet: 'Earth',
            Continents: ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Antarctica', 'Australia/Oceania'],
            Oceans: [
              { Name: 'Pacific', AverageDepth: 3970 },
              { Name: 'Atlantic', AverageDepth: 3646 },
              { Name: 'Indian', AverageDepth: 3741 },
              { Name: 'Southern', AverageDepth: 3270 },
              { Name: 'Arctic', AverageDepth: 1205 }
            ],
            IsHome: true,
            Lifeless: false
          }
          const result = evaluate(data)
          assert.strictEqual(result, 'Oceans are:\n\n * Pacific (Average depth 3970 m)\n * Atlantic (Average depth 3646 m)\n * Indian (Average depth 3741 m)\n * Southern (Average depth 3270 m)\n * Arctic (Average depth 1205 m)\n')
        })
        it('should assemble a filtered list', function () {
          const template = 'Continents containing u:\n\n{[list ContinentsWithU]}\n * {[this]}\n{[endlist]}'
          evaluate = tinql.compileTemplate(template)
          const data = {
            Planet: 'Earth',
            Continents: ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Antarctica', 'Australia/Oceania'],
            ContinentsWithU: tinql.compileExpression('Continents|filter:this.includes("u")'),
            Oceans: [
              { Name: 'Pacific', AverageDepth: 3970 },
              { Name: 'Atlantic', AverageDepth: 3646 },
              { Name: 'Indian', AverageDepth: 3741 },
              { Name: 'Southern', AverageDepth: 3270 },
              { Name: 'Arctic', AverageDepth: 1205 }
            ],
            IsHome: true,
            Lifeless: false,
          }
          const result = evaluate(data)
          assert.strictEqual(result, 'Continents containing u:\n\n * Europe\n * South America\n * Australia/Oceania\n')
        })
        it('should assemble a dynamically filtered list', function () {
          const template = '{[list Oceans | filter: AverageDepth < 3500]}\n * {[Name]}\n{[endlist]}'
          evaluate = tinql.compileTemplate(template)
          const data = {
            Oceans: [
              { Name: 'Pacific', AverageDepth: 3970 },
              { Name: 'Atlantic', AverageDepth: 3646 },
              { Name: 'Indian', AverageDepth: 3741 },
              { Name: 'Southern', AverageDepth: 3270 },
              { Name: 'Arctic', AverageDepth: 1205 }
            ]
          }
          const result = evaluate(data)
          assert.strictEqual(result, ' * Southern\n * Arctic\n')
        })
        it('should assemble a dynamically sorted list (ascending by name)', function () {
          const template = '{[list Oceans | sort: Name]}\n*{[Name]}\n{[endlist]}'
          evaluate = tinql.compileTemplate(template)
          const data = {
            Oceans: [
              { Name: 'Pacific', AverageDepth: 3970 },
              { Name: 'Atlantic', AverageDepth: 3646 },
              { Name: 'Indian', AverageDepth: 3741 },
              { Name: 'Southern', AverageDepth: 3270 },
              { Name: 'Arctic', AverageDepth: 1205 }
            ]
          }
          const result = evaluate(data)
          assert.strictEqual(result, '*Arctic\n*Atlantic\n*Indian\n*Pacific\n*Southern\n')
        })
        it('should assemble a dynamically sorted list (descending by AverageDepth)', function () {
          const template = '{[list Oceans | sort: -AverageDepth]}\n{[Name]}\n{[endlist]}'
          evaluate = tinql.compileTemplate(template)
          const data = {
            Oceans: [
              { Name: 'Pacific', AverageDepth: 3970 },
              { Name: 'Atlantic', AverageDepth: 3646 },
              { Name: 'Indian', AverageDepth: 3741 },
              { Name: 'Southern', AverageDepth: 3270 },
              { Name: 'Arctic', AverageDepth: 1205 }
            ]
          }
          const result = evaluate(data)
          assert.strictEqual(result, 'Pacific\nIndian\nAtlantic\nSouthern\nArctic\n')
        })
        it('should assemble a dynamically filtered list of wrapped strings', function () {
          const template = '{[list Oceans | filter: AverageDepth < 3500]}\n * {[this]}\n{[endlist]}'
          evaluate = tinql.compileTemplate(template)
          const data = {
            Oceans: [
              new String('Pacific'),
              new String('Atlantic'),
              new String('Indian'),
              new String('Southern'),
              new String('Arctic'),
            ]
          }
          data.Oceans[0].AverageDepth = 3970
          data.Oceans[1].AverageDepth = 3646
          data.Oceans[2].AverageDepth = 3741
          data.Oceans[3].AverageDepth = 3270
          data.Oceans[4].AverageDepth = 1205
          const result = evaluate(data)
          assert.strictEqual(result, ' * Southern\n * Arctic\n')
        })
        it('should assemble a dynamically filtered list of wrapped strings WITH filters', function () {
          const template = '{[list Oceans | filter: AverageDepth < 3500]}\n * {[this|upper]}\n{[endlist]}'
          evaluate = tinql.compileTemplate(template)
          const data = {
            Oceans: [
              new String('Pacific'),
              new String('Atlantic'),
              new String('Indian'),
              new String('Southern'),
              new String('Arctic'),
            ]
          }
          data.Oceans[0].AverageDepth = 3970
          data.Oceans[1].AverageDepth = 3646
          data.Oceans[2].AverageDepth = 3741
          data.Oceans[3].AverageDepth = 3270
          data.Oceans[4].AverageDepth = 1205
          const result = evaluate(data)
          assert.strictEqual(result, ' * SOUTHERN\n * ARCTIC\n')
        })
        it('should assemble a dynamically sorted list (descending by birth date, then ascending by name)', function () {
          const template = '{[list Children | sort:-Birth:+Name]}\n{[Name]}\n{[endlist]}'
          evaluate = tinql.compileTemplate(template)
          const result = evaluate(data_Children)
          assert.strictEqual(result, 'Eric\nMark\nTed\nBeth\nYolanda\nAlice\nJohn\n')
        })
        it('should assemble a dynamically sorted THEN filtered list', function () {
          const template = "{[list Children | sort:-Birth:+Name | filter:Group=='A']}\n*{[Name]}\n{[endlist]}"
          evaluate = tinql.compileTemplate(template)
          const result = evaluate(data_Children)
          assert.strictEqual(result, '*Beth\n*Yolanda\n*Alice\n*John\n')
        })
        it('should assemble a dynamically filtered THEN sorted list', function () {
          const template = "{[list Children | filter:Group=='A' | sort:-Birth:+Name]}\n*{[Name]}\n{[endlist]}"
          evaluate = tinql.compileTemplate(template)
          const result = evaluate(data_Children)
          assert.strictEqual(result, '*Beth\n*Yolanda\n*Alice\n*John\n')
        })
        it('check if an item is in a list using the "any" filter', function () {
          const template = "{[if Children|any:Name == 'Yolanda']}We found Yolanda!{[else]}No luck.{[endif]}"
          evaluate = tinql.compileTemplate(template)
          const result = evaluate(data_Children)
          assert.strictEqual(result, 'We found Yolanda!')
        })
        it('check if any nested lists meet a qualification by chaining the "any" filter (+ nested scope lookups)', function () {
          evaluate = tinql.compileTemplate('Future families: {[Families|any:Children|any:Birthdate>testDate]}')
          // "Any family has any children with a birthdate AFTER testDate" ... true for our data set
          const data = {
            ...TV_Family_Data,
            testDate: new Date(2019, 11, 6),
          }
          assert.strictEqual(evaluate(data), 'Future families: true')
          const evaluate2 = tinql.compileTemplate('Past families: {[Families|filter:Surname!="Robinson"|any:Children|any:Birthdate>testDate]}')
          // "Any family (OTHER THAN the Robinsons!) has any children with a birthdate AFTER testDate"... false for our data set, since the Robinsons are the only future-family included.
          assert.strictEqual(evaluate2(data), 'Past families: false')
        })
        it('check if all items in a list meet a criteria using the "every" filter', function () {
          const template = "{[if Children|every:Group == 'A' || Group == 'B']}Either A or B{[endif]}"
          evaluate = tinql.compileTemplate(template)
          const result = evaluate(data_Children)
          assert.strictEqual(result, 'Either A or B')
        })
        it('recognize that NOT all items in a list meet a criteria (using "every" filter)', function () {
          const template = "{[if Children|every:Group == 'A']}All A{[else]}Not all A{[endif]}"
          evaluate = tinql.compileTemplate(template)
          const result = evaluate(data_Children)
          assert.strictEqual(result, 'Not all A')
        })
        it('should find a specific item in a list', function () {
          const template = 'First child with a d in their name is {[(Children|find:Name.includes("d")).Name]}'
          evaluate = tinql.compileTemplate(template)
          const result = evaluate(data_Children)
          assert.strictEqual(result, 'First child with a d in their name is Ted')
        })
        it('should use grouping to find unique items in a list (+ list punctuation)', function () {
          const template = 'Children were born in the years {[list Children|group:Birth.getFullYear()|sort:_key|punc:\'1, 2 and 3\']}{[_key]}{[endlist]}.'
          evaluate = tinql.compileTemplate(template)
          const result = evaluate(data_Children)
          assert.strictEqual(result, 'Children were born in the years 1970, 2000 and 2007.')
        })
        it('should use grouping to create nested lists from a flat list', function () {
          const template = 'Children were born in the years {[list Children|group:Birth.getFullYear()|sort:_key|punc:"1; 2; and 3"]}{[_key]} ({[list _values|sort:Name|punc:"1, 2 and 3"]}{[Name]}{[endlist]}){[endlist]}.'
          evaluate = tinql.compileTemplate(template)
          const result = evaluate(data_Children)
          assert.strictEqual(result, 'Children were born in the years 1970 (Alice and John); 2000 (Beth and Yolanda); and 2007 (Eric, Mark and Ted).')
        })
        it('should assemble a document with a primitive list, _index', function () {
          const template = 'Continents:\n\n{[list Continents]}\n * {[this]} (#{[_index]} on {[Planet]})\n{[endlist]}'
          evaluate = tinql.compileTemplate(template)
          const data = {
            Planet: 'Earth',
            Continents: ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Antarctica', 'Australia/Oceania']
          }
          const result = evaluate(data)
          assert.strictEqual(result, 'Continents:\n\n * Africa (#1 on Earth)\n * Asia (#2 on Earth)\n * Europe (#3 on Earth)\n * North America (#4 on Earth)\n * South America (#5 on Earth)\n * Antarctica (#6 on Earth)\n * Australia/Oceania (#7 on Earth)\n')
        })
        it('should assemble a document with a list of wrapped primitives', function () {
          const template = '{[list Continents|sort:-SurfaceArea]}\n{[this]}\n{[endlist]}'
          evaluate = tinql.compileTemplate(template)
          const data = {
            ContinentData: [{
              Name: 'Africa',
              SurfaceArea: 30370000
            }, {
              Name: 'Asia',
              SurfaceArea: 44579000
            }, {
              Name: 'Europe',
              SurfaceArea: 10180000
            }, {
              Name: 'North America',
              SurfaceArea: 24709000
            }, {
              Name: 'South America',
              SurfaceArea: 17840000
            }, {
              Name: 'Antarctica',
              SurfaceArea: 14000000
            }, {
              Name: 'Australia/Oceania',
              SurfaceArea: 8600000
            }
            ]
          }
          data.Continents = data.ContinentData.map(obj => {
            const newObj = new String(obj.Name)
            newObj.Name = obj.Name
            newObj.SurfaceArea = obj.SurfaceArea
            return newObj
          })
          const result = evaluate(data)
          assert.strictEqual(result, 'Asia\nAfrica\nNorth America\nSouth America\nAntarctica\nEurope\nAustralia/Oceania\n')
        })
        it('in nested but otherwise unrelated lists, _parent in the inner object list refers to the outer primitive list', function () {
          const template =
`Continents:
{[list Continents|filter:!this.startsWith("A")]}
 * {[this]} ({[list Oceans|filter:Name.startsWith("A")]}{[_index]}. {[Name]} in {[_parent]}, {[endlist]})
{[endlist]}`
          evaluate = tinql.compileTemplate(template)
          const result = evaluate(data_Planet)
          assert.strictEqual(result,
`Continents:
 * Europe (1. Atlantic in Europe, 2. Arctic in Europe, )
 * North America (1. Atlantic in North America, 2. Arctic in North America, )
 * South America (1. Atlantic in South America, 2. Arctic in South America, )
`
          )
        })
        it('in nested but otherwise unrelated lists, _parent in the inner primitive list refers to the outer object list', function () {
          const template =
`Oceans:
{[list Oceans|filter:Name.startsWith("A")]}
 * {[Name]} ({[list Continents|filter:!this.startsWith("A")]}{[_index]}. {[this]} in {[_parent.Name]}, {[endlist]})
{[endlist]}`
          const evaluate = tinql.compileTemplate(template)
          const result = evaluate(data_Planet)
          assert.strictEqual(result,
`Oceans:
 * Atlantic (1. Europe in Atlantic, 2. North America in Atlantic, 3. South America in Atlantic, )
 * Arctic (1. Europe in Arctic, 2. North America in Arctic, 3. South America in Arctic, )
`
          )
        })
        it('should assemble a (simple) full name template', function () {
          const template = '{[ClientFirstName]} {[ClientMiddleName?ClientMiddleName + " ":""]}{[ClientLastName]}'
          evaluate = tinql.compileTemplate(template)
          const data = {
            ClientFirstName: 'John',
            ClientMiddleName: 'Jacob',
            ClientLastName: 'Smith'
          }
          const result = evaluate(data)
          assert.strictEqual(result, 'John Jacob Smith')
        })
        it('should assemble a simple template with local and global scopes', function () {
          const template = '{[First]} {[Middle ? Middle + " " : ""]}{[Last]}'
          evaluate = tinql.compileTemplate(template)
          const scope = useScope({ Last: 'Smith' }).pushScope({ First: 'John' }) // Last is "global", First is "local"
          const result = evaluate(scope)
          assert.strictEqual(result, 'John Smith')
        })
      })
    })
  })
})

const data_Children = {
  Children: [
    { Name: 'John', Birth: new Date(1970, 8, 5), Group: 'A' },
    { Name: 'Alice', Birth: new Date(1970, 8, 5), Group: 'A' },
    { Name: 'Eric', Birth: new Date(2007, 9, 24), Group: 'B' },
    { Name: 'Ted', Birth: new Date(2007, 9, 24), Group: 'B' },
    { Name: 'Mark', Birth: new Date(2007, 9, 24), Group: 'B' },
    { Name: 'Yolanda', Birth: new Date(2000, 1, 1), Group: 'A' },
    { Name: 'Beth', Birth: new Date(2000, 1, 1), Group: 'A' }
  ]
}

const data_Planet = {
  Planet: 'Earth',
  Continents: ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Antarctica', 'Australia/Oceania'],
  Oceans: [
    { Name: 'Pacific', AverageDepth: 3970 },
    { Name: 'Atlantic', AverageDepth: 3646 },
    { Name: 'Indian', AverageDepth: 3741 },
    { Name: 'Southern', AverageDepth: 3270 },
    { Name: 'Arctic', AverageDepth: 1205 }
  ]
}
