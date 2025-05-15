/* Template Batching in TINQ is roughly analagous to "meta templates" in Yatte. It's a way to assemble one template
   that refers to multiple other templates, and have the result of this one template be a LIST of documents
   rather than a single document. The "batch" template itself is expected to be a text template, but the templates
   to which it refers may be either text or "external" (which would then be produced asynchronously/out-of-band).
*/

import { Tinq, ExternalFile } from '../src/index.mjs'
import chai from 'chai'
var expect = chai.expect

chai.config.includeStack = true

const tinq = new Tinq()
function makeObject (proto, obj) {
  return Object.assign(Object.create(proto), obj)
}

describe("output batching", function() {
  it("can produce a list of outputs instead of a single output", function () {
    const scope = {
      Name: 'Dave',
      Template1: tinq.compileExternal('Template1', 'Hello {[Name]}.', 'Greeting.txt'),
      Template2: tinq.compileExternal('Template2', 'I\'m sorry, {[Name]}. I\'m afraid I can\'t do that.', 'No {[Name]}.txt'),
    }
    const evaluate = tinq.compileBatch('{[Template1]}\n{[Template2]}')
    const result = evaluate(scope)
    const work = {}
    const output = []
    for (const item of result) {
      if (item.id) {
        work[item.id] = item
      }
      if (item.outputOrder) {
        output[item.outputOrder - 1] = item.data // ??
      }
    }
    expect(output).to.deep.equal(['Hello Dave.', 'I\'m sorry, Dave. I\'m afraid I can\'t do that.'])
  })

  it("can produce a list of outputs with externally composed templates", function () {
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
    ]
    const insert2 = [
      {"type":"Content","expr":"Name2","id":"1","atom":"C1"},
    ]
    const scope = {
      Name1: 'Dave',
      Name2: 'Lisa',
      Married: true,
      MainTemplate: tinq.compileExternal('MainTemplate', level0, 'Main'),
      Insert1: tinq.compileExternal('Insert1', insert1),
      Insert2: tinq.compileExternal('Insert2', insert2, 'Insert for {[Name2]}'),
    }
    const evaluate = tinq.compileBatch('{[MainTemplate]}\n{[Insert2]}')
    const result = evaluate(scope)
    const work = {}
    const output = []
    for (const item of result) {
      if (item.id) {
        work[item.id] = item
      }
      if (item.outputOrder) {
        output[item.outputOrder - 1] = item //{
        //   template: item.template,
        //   data: item.data.toXml()
        // }
      }
    }
    expect(result.length).to.equal(3)
    expect(output.length).to.equal(2)
  })

})
