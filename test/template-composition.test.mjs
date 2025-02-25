// Template Composition in TINQ uses "External File" objects, roughly analagous to "Indirect
// Templates" in Yatte. It's a way to assemble templates that must be composed of not only data
// and static text content, but also chunks of content that are produced from other templates and/or
// external code. This works for plain text documents as well as binary formats that must be
// produced asynchronously/out-of-band.

import { Tinq } from '../src/index.mjs'
import { ExternalFile } from '../src/index.mjs';
import chai from 'chai'
var expect = chai.expect

chai.config.includeStack = true;

const tinq = new Tinq()
function makeObject (proto, obj) {
  return Object.assign(Object.create(proto), obj)
}

describe("plain text composition", function() {
  it("synchronously compose output where plain text is inserted DIRECTLY into plain text", function() {
    const template = 'This is a parent document, {[Name]}.\n{[Insert]}\nThis is the parent document again, {[Name]}.'
    const scope = {
      Name: 'Fred',
      Insert: tinq.compileTemplate('This is an inserted template, {[Name]}.'),
    }
    const evaluate = tinq.compileTemplate(template)
    const result = evaluate(scope)
    expect(result).to.equal(
      'This is a parent document, Fred.\nThis is an inserted template, Fred.\nThis is the parent document again, Fred.'
    )
  })

  it("composes output where plain text is inserted INDIRECTLY into plain text", function () {
    // this example (using compileExternal) works the same as above (with compileTemplate) ONLY because
    // the parent template in both cases is a text template, AND the compileExternal (in this case) also
    // uses a text template.  If the parent template had been external, OR the external child template
    // were constructed using an AST instead of text, then evaluate would have returned a composition queue.
    const template = 'This is a parent document, {[Name]}.\n{[Insert]}\nThis is the parent document again, {[Name]}.'
    const scope = {
      Name: 'Fred',
      Insert: tinq.compileExternal('Insert', 'This is an inserted template, {[Name]}.')
    }
    const evaluate = tinq.compileTemplate(template)
    const result = evaluate(scope)
    expect(result).to.equal(
      'This is a parent document, Fred.\nThis is an inserted template, Fred.\nThis is the parent document again, Fred.'
    )
  })
  it('allows text composition with text from custom functions', function () {
    const textFunc = scope => 'my custom value'
    textFunc.ast = true // <-- required

    const template = 'This is a parent document, {[Name]}.\n{[Insert]}\nParent again, {[Name]}.'
    const scope = {
      Name: 'Fred',
      Insert: textFunc,
    }
    const evaluate = tinq.compileTemplate(template)
    const result = evaluate(scope)
    expect(result).to.equal(
      'This is a parent document, Fred.\nmy custom value\nParent again, Fred.'
    )

  })
  it('alternate model for using custom functions', function () {
    // no benefit to this over the above, because the ExternalFile is ignored and its data is coerced
    // into a string... this is because the main template in both cases is executed using compileTemplate.
    // To interject any logic or async processing into composition, the main template must be compiled as an external!
    const textFunc = scope => scope.getOwnValue('Name') + '\'s custom value'
    const extFileFunc = scope => new ExternalFile('template_id', textFunc(scope))
    extFileFunc.ast = true // <-- required

    const template = 'This is a parent document, {[Name]}.\n{[Insert]}\nParent again, {[Name]}.'
    const scope = {
      Name: 'Fred',
      Insert: extFileFunc,
    }
    const evaluate = tinq.compileTemplate(template) // if the "parent" template is compiled using compileTemplate,
    // it WILL ALWAYS return an auto-composed string!
    const result = evaluate(scope)
    expect(result).to.equal(
      'This is a parent document, Fred.\nFred\'s custom value\nParent again, Fred.'
    )
  })
  it('alternate model for using custom functions -- manual composition', function () {
    const textFunc = scope => scope.getOwnValue('Name') + '\'s custom value'
    const extFileFunc = scope => new ExternalFile('template_id', textFunc(scope))
    extFileFunc.ast = true // <-- required

    const template = 'This is a parent document, {[Name]}.\n{[Insert]}\nParent again, {[Name]}.'
    const scope = {
      Name: 'Fred',
      Insert: extFileFunc,
    }
    const evaluate = tinq.compileExternal('Main', tinq.parseTemplate(template))
    const result = evaluate(scope)
    // debugger
    // todo: if this were a supportable thing to do/if there were realistic use cases for this,
    // we would want to implement something in the API to compose the resulting data structure
    // into plain text! (where it takes the AST + extracted data + table of externals and produces
    // plain text.)
    // expect(result).to.equal(
    //   'This is a parent document, Fred.\nFred's custom value\nParent again, Fred.'
    // )
  })
})

describe("external composition", function () {
  it('illustrates a baseline external template (no composition)', function () {
    /* Test.docx:
    This is a template, {[Name]}.
    */
    // Test.docx.json (e.g. produced by extracting fields using opendocx-net):
    const test_logic = [{"type":"Content","expr":"Name","id":"1","key":"C1"}] // opendocx content array:
    // type == field type; expr = field expression; id == field number; key = field identifier/indirect element name
    const scope = { Name: 'Fred' }
    const evaluate = tinq.compileExternal('myTemplateId', test_logic)
    const result = evaluate(scope)
    expect(result).to.be.an('object')
    expect(result).to.not.be.an('array')
    expect(result.template).to.equal('myTemplateId')
    expect(result.data.toXml('top')).to.equal('<?xml version="1.0"?><top><C1>Fred</C1></top>')
    // template can then be used to locate & retrieve whatever the template actually is
    // and data can be used as input to the assembly process for that template
  })
  it('should automatically extract the data necessary for InsertTest.docx AND Inserted.docx', function () {
    /* InsertTest.docx:
    This is a parent document, {[Name]}.
    {[Insert]}
    This is the parent document again, {[Name]}.
    */
    // InsertTest.docx.json (produced by opendocx-net):
    const template = [
      {"type":"Content","expr":"Name","id":"1","key":"C1","idd":["3"]},
      {"type":"Content","expr":"Insert","id":"2","key":"C2"}
    ]
    /* Inserted.docx:
    This is an inserted template, {[Name]}.
    */
    // Inserted.docx.json (produced by opendocx-net):
    const inserted_logic = [{"type":"Content","expr":"Name","id":"1","key":"C1"}]
    const scope = {
      Name: 'Fred',
      Insert: tinq.compileExternal({tid:2}, inserted_logic)
    }
    const evaluate = tinq.compileExternal({tid:1}, template)
    const result = evaluate(scope)
    expect(result).to.be.an('array')
    expect(result.length).to.equal(2)
    expect(result[0]).to.have.property('id')
    expect(result[0]).to.not.have.property('requires')
    const childId = result[0].id
    expect(result[0].template).to.deep.equal({tid:2})
    expect(result[0].data.toXml('top')).to.equal('<?xml version="1.0"?><top><C1>Fred</C1></top>')
    expect(result[1].template).to.deep.equal({tid:1})
    expect(result[1]).to.have.property('requires')
    expect(result[1].requires).to.be.an('array')
    expect(result[1].requires.length).to.equal(1)
    expect(result[1].requires[0]).to.equal(childId)
    expect(result[1]).to.not.have.property('id')
    const parentXml = result[1].data.toXml('top')
    expect(parentXml).to.equal(`<?xml version="1.0"?><top><C1>Fred</C1><C2>oxpt://DocumentAssembler/insert/${childId}</C2></top>`)
  })

  it('should automatically extract the data necessary for InsertTest4.docx etc,', function () {
    const template = [
      {"type":"If","expr":"A","id":"1","atom":"C1","contentArray":[
        {"type":"Content","expr":"Name","id":"2","atom":"C2"},
        {"type":"Content","expr":"Insert","id":"3","atom":"C3"}
      ]},
      {"type":"If","expr":"B","id":"5","atom":"C5","contentArray":[
        {"type":"Content","expr":"Name","id":"6","atom":"C2"},
        {"type":"Content","expr":"Insert","id":"7","atom":"C3"}
      ]}
    ]
    const inserted_logic = [{"type":"Content","expr":"Name","id":"1","key":"C1"}]
    const scope = {
      Name: 'John',
      Insert: tinq.compileExternal('Insert', inserted_logic),
      A: true,
      B: true,
    }
    const evaluate = tinq.compileExternal('Main', template)
    const result = evaluate(scope)
    // check that there is only one dependency (which will be inserted twice)
    expect(result.length).to.equal(2)
    expect(result[0]).to.not.have.property('requires')
    const childId = result[0].id
    expect(result[0].template).to.equal('Insert')
    expect(result[1].template).to.equal('Main')
    expect(result[1].requires).to.be.an('array')
    expect(result[1].requires.length).to.equal(1)
    expect(result[1].requires[0]).to.equal(childId)
  })

  it('should work with inserts in lists and filtered lists, e.g. InsertTest5', function () {
    const template = [
      {"type":"Content","expr":"Var1","id":"1","atom":"C1"},
      {"type":"List","expr":"Signers","id":"2","atom":"L2","contentArray":[
        {"type":"Content","expr":"Var2","id":"3","atom":"C3"},
        {"type":"Content","expr":"Insert","id":"4","atom":"C4"}
      ]},
      {"type":"If","expr":"Var3","id":"6","atom":"C6","contentArray":[
        {"type":"List","expr":"Signers|filter:Included","id":"7","atom":"L7","contentArray":[
          {"type":"Content","expr":"Insert","id":"8","atom":"C4"}
        ]}
      ]}
    ]
    const inserted_logic = [{"type":"Content","expr":"Name","id":"1","key":"C1"}]
    const signerProto = {
      Insert: tinq.compileExternal('Insert', inserted_logic),
    }
    const scope = {
      Var1: 'Top Level Info 1',
      Var2: 'Top Level Info 2',
      Var3: true,
      Signers: [
        makeObject(signerProto, { Name: 'John', Included: false }),
        makeObject(signerProto, { Name: 'Mary', Included: true }),
      ],
    }
    const evaluate = tinq.compileExternal('Main', template)
    const result = evaluate(scope)
    expect(result).to.be.an('array')
    expect(result.length).to.equal(3)
    let current = 0 // first doc should be an insert
    expect(result[current]).to.have.property('id')
    expect(result[current]).to.not.have.property('requires')
    const child0Id = result[current].id
    expect(result[current].template).to.deep.equal('Insert')
    expect(result[current].data.toXml('top')).to.equal(`<?xml version="1.0"?><top><C1>${result[current].data.data.C1}</C1></top>`)
    current++ // next doc should be the same insert but with different data
    expect(result[current]).to.have.property('id')
    expect(result[current]).to.not.have.property('requires')
    const child1Id = result[current].id
    expect(result[current].template).to.deep.equal('Insert')
    expect(result[current].data.toXml('top')).to.equal(`<?xml version="1.0"?><top><C1>${result[current].data.data.C1}</C1></top>`)
    current++ // third doc should be the main one
    expect(result[current].template).to.deep.equal('Main')
    expect(result[current]).to.have.property('requires')
    expect(result[current].requires).to.be.an('array')
    expect(result[current].requires.length).to.equal(2)
    expect(result[current].requires).to.include(child0Id)
    expect(result[current].requires).to.include(child1Id)
    expect(result[current]).to.not.have.property('id')
    const parentXml = result[current].data.toXml('top')
    expect(parentXml).to.equal(`
<?xml version="1.0"?>
<top>
<C1>Top Level Info 1</C1>
<L2>
<L2i>
<C3>Top Level Info 2</C3>
<C4>oxpt://DocumentAssembler/insert/${child0Id}</C4>
<L2p/>
</L2i>
<L2i>
<C3>Top Level Info 2</C3>
<C4>oxpt://DocumentAssembler/insert/${child1Id}</C4>
<L2p/>
</L2i>
</L2>
<C6b>true</C6b>
<L7>
<L7i>
<C4>oxpt://DocumentAssembler/insert/${child1Id}</C4>
<L7p/>
</L7i>
</L7>
</top>`.split('\n').join(''))
  })
  it('should appropriately pass the |keepsections filter through to externals', function () {
    const template = [
      {"type":"Content","expr":"Name","id":"1","atom":"C1","idd":["3"]},
      {"type":"Content","expr":"Indirect|keepsections","id":"2","atom":"C2"}
    ]
    const template2 = [
      {"type":"If","expr":"margin==\"2.5\"","id":"1","atom":"C1","contentArray":[
        {"type":"ElseIf","expr":"margin==\"2.0\"","id":"2","atom":"C2","contentArray":[
          {"type":"ElseIf","expr":"margin==\"1.5\"","id":"3","atom":"C3","contentArray":[]}
        ]}
      ]}
    ]
    const scope = {
      Name: 'John',
      Indirect: tinq.compileExternal('Insert', template2),
      margin: '2.0',
    }
    const evaluate = tinq.compileExternal('Main', template)
    const result = evaluate(scope)
    expect(result.length).to.equal(2)
    expect(result[0].KeepSections).to.equal(true)
    const childId = result[0].id
    expect(result[0].data.toXml('top')).to.equal('<?xml version="1.0"?><top><C1b>false</C1b><C2b>true</C2b></top>')
    expect(result[1].requires[0]).to.equal(childId)
    const parentXml = result[1].data.toXml('top')
    expect(parentXml).to.equal(`<?xml version="1.0"?><top><C1>John</C1><C2>oxpt://DocumentAssembler/insert/${childId}?KeepSections=true</C2></top>`)
  })

  // make sure we have a test case that covers
  // (1) insert dependencies 3 levels deep (to make sure they come out in the right order)
  // (2) insert dependencies where there are multiple parallel parent docs, each of which has multiple child dependencies, with some of the children shared and some of them unique.  Ensure ALL the dependencies are included (once) in the final queue, and in a valid order.
  it('should queue the expected jobs in deeply nested & repetitive compositions', function () {
    const level0 = [
      {"type":"Content","expr":"Name1","id":"1","atom":"C1"},
      {"type":"Content","expr":"Insert1","id":"2","atom":"C2"},
      {"type":"If","expr":"Married","id":"3","atom":"C3","contentArray":[
        {"type":"Content","expr":"Name2","id":"4","atom":"C4"},
        {"type":"Content","expr":"Insert2","id":"5","atom":"C5"}
      ]}
    ]
    const insert1 = [
      {"type":"Content","expr":"Name1","id":"1","atom":"C1"},
      {"type":"Content","expr":"Insert1_1","id":"2","atom":"C2"},
    ]
    const insert2 = [
      {"type":"Content","expr":"Name2","id":"1","atom":"C1"},
      {"type":"Content","expr":"Insert2_1","id":"2","atom":"C2"},
      {"type":"Content","expr":"Insert1_1","id":"3","atom":"C3"},
    ]
    const insert1_1 = [
      {"type":"Content","expr":"Name1","id":"1","atom":"C1"},
    ]
    const insert2_1 = [
      {"type":"Content","expr":"Name2","id":"1","atom":"C1"},
      {"type":"Content","expr":"Name1","id":"2","atom":"C2"},
    ]
    const scope = {
      Name1: 'John',
      Insert1: tinq.compileExternal('Insert1', insert1),
      Insert1_1: tinq.compileExternal('Insert1_1', insert1_1),
      Married: true,
      Name2: 'Mary',
      Insert2: tinq.compileExternal('Insert2', insert2),
      Insert2_1: tinq.compileExternal('Insert2_1', insert2_1),
    }
    const evaluate = tinq.compileExternal('Main', level0)
    const result = evaluate(scope)
    expect(result.length).to.equal(5)
    // check that each document in the queue comes before anything that depends on it
    const alreadySeen = []
    result.forEach((a, index, all) => {
      if (a.requires) {
        a.requires.forEach(id => {
          expect(alreadySeen).to.include(id)
        })
      }
      if (index === all.length - 1) { // last one
        expect(a).to.not.have.property('id')
      } else {
        expect(a).to.have.property('id')
        alreadySeen.push(a.id)
      }
    })
  })
})

describe("markdown (or any **custom** text-based format) into docx composition", function() {
  it('should assemble inserted text but make it availble for custom composition into parent', function () {
    /* InsertTest.docx:
    This is a parent document, {[Name]}.
    {[Insert]}
    This is the parent document again, {[Name]}.
    */
    // InsertTest.docx.json (produced by opendocx-net):
    const template = [
      {"type":"Content","expr":"Name","id":"1","key":"C1","idd":["3"]},
      {"type":"Content","expr":"Insert","id":"2","key":"C2"}
    ]
    const scope = {
      Name: 'Kathryn',
      Insert: tinq.compileExternal('Insert', 'This is an **inserted template**, {[Name]}.')
    }
    const evaluate = tinq.compileExternal('Main', template)
    const result = evaluate(scope)
    expect(result).to.be.an('array')
    expect(result.length).to.equal(2)
    expect(result[0]).to.have.property('id')
    expect(result[0]).to.not.have.property('requires')
    const childId = result[0].id
    expect(result[0].template).to.equal('Insert')
    expect(result[0].data).to.equal('This is an **inserted template**, Kathryn.')
    expect(result[1].template).to.equal('Main')
    expect(result[1]).to.have.property('requires')
    expect(result[1].requires).to.be.an('array')
    expect(result[1].requires.length).to.equal(1)
    expect(result[1].requires[0]).to.equal(childId)
    expect(result[1]).to.not.have.property('id')
    const parentXml = result[1].data.toXml('top')
    expect(parentXml).to.equal(`<?xml version="1.0"?><top><C1>Kathryn</C1><C2>oxpt://DocumentAssembler/insert/${childId}</C2></top>`)
  })
})

describe('nested unrelated scopes work as expected with external composition', function () {
  const oceanProto = {
    Summary: tinq.compileExternal('Summary', '{[Name|upper]} ({[AverageDepth]} deep)'),
  }
  const data_Planet = {
    Planet: 'Earth',
    Continents: ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Antarctica', 'Australia/Oceania'],
    Oceans: [
      makeObject(oceanProto, { Name: 'Pacific', AverageDepth: 3970 }),
      makeObject(oceanProto, { Name: 'Atlantic', AverageDepth: 3646 }),
      makeObject(oceanProto, { Name: 'Indian', AverageDepth: 3741 }),
      makeObject(oceanProto, { Name: 'Southern', AverageDepth: 3270 }),
      makeObject(oceanProto, { Name: 'Arctic', AverageDepth: 1205 }),
    ]
  }
  it('in nested but otherwise unrelated lists, outer primitive, inner typed', function () {
    const template =
`Continents:
{[list Continents|filter:!this.startsWith("A")]}
  * {[this]} ({[list Oceans|filter:Name.startsWith("A")|punc:"1; 2"]}{[_index]}. {[Summary]} in {[_parent]}{[endlist]})
{[endlist]}`
    const evaluate = tinq.compileTemplate/*External('Main', tinq.extractTemplateLogic*/(template)//)
    const result = evaluate(data_Planet)
    expect(result).to.equal(
`Continents:
  * Europe (1. ATLANTIC (3646 deep) in Europe; 2. ARCTIC (1205 deep) in Europe)
  * North America (1. ATLANTIC (3646 deep) in North America; 2. ARCTIC (1205 deep) in North America)
  * South America (1. ATLANTIC (3646 deep) in South America; 2. ARCTIC (1205 deep) in South America)
`)
  })
  it('in nested but otherwise unrelated lists, outer typed, inner primitive', function () {
    const template =
`Oceans:
{[list Oceans|filter:Name.startsWith("A")]}
  * {[Name]} ({[list Continents|filter:!this.startsWith("A")|punc:"1; 2"]}{[_index]}. {[this]} in {[_parent.Name]}{[endlist]})
{[endlist]}`
    const evaluate = tinq.compileTemplate(template)
    const result = evaluate(data_Planet)
    expect(result).to.equal(
`Oceans:
  * Atlantic (1. Europe in Atlantic; 2. North America in Atlantic; 3. South America in Atlantic)
  * Arctic (1. Europe in Arctic; 2. North America in Arctic; 3. South America in Arctic)
`
    )
  })
})