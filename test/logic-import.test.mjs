import { describe, it } from 'mocha'
import assert from 'node:assert/strict'
import { Tinq } from '../src/index.mjs'

describe('Logic tree import source fields', () => {
  it('attaches the field number to expression errors in content, conditions and lists', () => {
    const tinq = new Tinq()
    for (const type of ['Content', 'If', 'List']) {
      for (const id of ['37', 37, 0]) {
        const field = { type, id, expr: 'Name +', contentArray: [] }
        assert.throws(() => tinq.logicToTemplateAst([field]), error => {
          assert.equal(error.fieldNum, id)
          assert.match(error.message, /Unexpected end of expression/)
          return true
        })
      }
    }
  })

  it('retains the innermost failing field through nested blocks and alternate branches', () => {
    const tinq = new Tinq()
    for (const type of ['Content', 'ElseIf']) {
      const logic = [{ type: 'List', id: '10', expr: 'Items', contentArray: [
        { type: 'If', id: '11', expr: 'Enabled', contentArray: [
          { type, id: '12', expr: 'Name +', contentArray: [] },
        ] },
      ] }]
      assert.throws(() => tinq.logicToTemplateAst(logic), error => {
        assert.equal(error.fieldNum, '12')
        return true
      })
    }
  })

  it('does not invent a field number for unnumbered fields or standalone expressions', () => {
    const tinq = new Tinq()
    for (const parse of [
      () => tinq.parseExpression('Name +'),
      () => tinq.logicToTemplateAst([{ type: 'List', id: '10', expr: 'Items', contentArray: [
        { type: 'Content', expr: 'Name +' },
      ] }]),
    ]) assert.throws(parse, error => {
      assert.equal(Object.hasOwn(error, 'fieldNum'), false)
      return true
    })
  })

  it('preserves the original exception and successful field metadata', () => {
    const tinq = new Tinq()
    const original = new SyntaxError('Invalid expression')
    const parser = tinq.parseExpression
    tinq.parseExpression = () => { throw original }
    assert.throws(() => tinq.logicToTemplateAst([{ type: 'Content', id: '7', expr: 'Name' }]), error => error === original)
    assert.equal(original.fieldNum, '7')
    tinq.parseExpression = parser
    const ast = tinq.logicToTemplateAst([{ type: 'Content', id: '8', expr: 'Name' }])
    assert.equal(ast.body[0].fieldNum, '8')
    assert.equal(ast.body[0].expression.name, 'Name')
  })
})
