/* Template Batching in TINQ is roughly analagous to "meta templates" in Yatte. It's a way to assemble one template
   that refers to multiple other templates, and have the result of this one template be a LIST of documents
   rather than a single document. This works for plain text documents as well as binary formats that must be
   produced asynchronously/out-of-band.
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
      Template1: tinq.compileExternal('Template1', 'Hello {[Name]}.'),
      Template2: tinq.compileExternal('Template2', 'I\'m sorry, {[Name]}. I\'m afraid I can\'t do that.'),
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

})
