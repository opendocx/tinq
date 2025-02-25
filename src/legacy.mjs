import { AST } from './ast.mjs'

// legacy field types
export const OD = {
  Content: 'Content',
  If: 'If',
  ElseIf: 'ElseIf',
  Else: 'Else',
  EndIf: 'EndIf',
  List: 'List',
  EndList: 'EndList'
}

export function toContentArray (ast, subs = false, isElseIf = false) {
  switch (ast.type) {
    case AST.Program:
    case AST.TemplateBlock:
      return ast.body.map(elem => toContentArray(elem))
    case AST.TemplateElement:
      return ast.text
    case AST.ContentField:
      return legacyNode({
        type: OD.Content,
        expr: AST.serialize(ast.expression),
        id: ast.fieldNum,
      })
    case AST.ConditionalField: {
      const contentArray = [].concat(toContentArray(ast.consequent))
      let endArray = contentArray
      if (ast.alternate) {
        if (ast.alternate.type === AST.ConditionalField) {
          contentArray.push(toContentArray(ast.alternate, false, true))
        } else {
          contentArray.push(legacyNode({
            type: OD.Else,
            id: ast.altFieldNum,
            contentArray: (endArray = [].concat(toContentArray(ast.alternate))),
          }))
        }
      }
      if (ast.endFieldNum) {
        endArray.push(legacyNode({
          type: OD.EndIf,
          id: ast.endFieldNum,
        }))
      }
      return legacyNode({
        type: isElseIf ? OD.ElseIf : OD.If,
        expr: AST.serialize(ast.test),
        id: ast.fieldNum,
        contentArray,
      })
    }
    case AST.ListField: {
      const contentArray = [].concat(toContentArray(ast.content))
      contentArray.push(legacyNode({
        type: OD.EndList,
        id: ast.endFieldNum,
      }))
      return legacyNode({
        type: OD.List,
        expr: AST.serialize(ast.expression),
        id: ast.fieldNum,
        contentArray,
      })
    }
    default:
      throw new Error(`Unsupported node type '${ast.type}'`)
  }
}

function legacyNode (obj) {
  const result = {
    type: obj.type
  }
  if (typeof obj.expr === 'string') result.expr = obj.expr
  if (obj.id) result.id = String(obj.id)
  if (obj.contentArray) result.contentArray = obj.contentArray
  return result
}

export class LogicTreeImporter {
  constructor (tinq) {
    this.tinq = tinq
  }

  arrayToBlock (nodeArray, type) {
    if (nodeArray.length === 1 && type === AST.TemplateBlock) {
      // block is unnecessary when length === 1
      return this.nodeToAst(nodeArray[0])
    }
    const body = nodeArray.map(node => this.nodeToAst(node))
    return {
      type,
      body,
    }
  }
  
  nodeToAst (node) {
    switch (node.type) {
      case OD.Content:
        return this.contentField(node)
      case OD.If:
        return this.conditionalBlock(node)
      case OD.List:
        return this.listBlock(node)
    }
  }
  
  contentField (node) {
    const result = {
      type: AST.ContentField,
      expression: this.tinq.parseExpression(node.expr),
    }
    if (node.id) {
      result.fieldNum = node.id
    }
    if (node.key || node.atom || node.fieldName) {
      result.key = node.key || node.atom || node.fieldName
    }
    return result
  }

  conditionalBlock (node) {
    const lastChild = node.contentArray.length > 0 && node.contentArray[node.contentArray.length - 1]
    let consequent, alternate, endFieldNum
    if (lastChild && (lastChild.type === OD.Else || lastChild.type === OD.ElseIf)) {
      consequent = this.arrayToBlock(node.contentArray.slice(0,-1), AST.TemplateBlock)
      alternate = lastChild.type === OD.ElseIf
        ? this.conditionalBlock(lastChild)
        : this.arrayToBlock(lastChild.contentArray, AST.TemplateBlock)
    } else {
      consequent = this.arrayToBlock(node.contentArray, AST.TemplateBlock)
      alternate = null
    }
    const result = {
      type: AST.ConditionalField,
      test: this.tinq.parseExpression(node.expr),
      consequent,
      alternate,
    }
    if (node.id) {
      result.fieldNum = node.id
      // result.endFieldNum = ?
    }
    if (alternate && lastChild.id) {
      result.altFieldNum = lastChild.id
    }
    if (node.key || node.atom || node.fieldName) {
      result.key = node.key || node.atom || node.fieldName
    }
    return result
  }

  listBlock (node) {
    const content = this.arrayToBlock(node.contentArray, AST.TemplateBlock)
    const result = {
      type: AST.ListField,
      expression: this.tinq.parseExpression(node.expr),
      content,
    }
    if (node.id) {
      result.fieldNum = node.id
      //result.endFieldNum = ?
    }
    if (node.key || node.atom || node.fieldName) {
      result.key = node.key || node.atom || node.fieldName
    }
    return result
  }

}
