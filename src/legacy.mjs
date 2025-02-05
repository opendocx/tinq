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

export function toLegacyAST (ast, subs = false, isElseIf = false) {
  switch (ast.type) {
    case AST.Program:
    case AST.TemplateBlock:
      return ast.body.map(elem => toLegacyAST(elem))
    case AST.TemplateElement:
      return ast.text
    case AST.ContentField:
      return legacyNode({
        type: OD.Content,
        expr: AST.serialize(ast.expression),
        id: ast.fieldNum,
      })
    case AST.ConditionalField: {
      const contentArray = [].concat(toLegacyAST(ast.consequent))
      let endArray = contentArray
      if (ast.alternate) {
        if (ast.alternate.type === AST.ConditionalField) {
          contentArray.push(toLegacyAST(ast.alternate, false, true))
        } else {
          contentArray.push(legacyNode({
            type: OD.Else,
            id: ast.altFieldNum,
            contentArray: (endArray = [].concat(toLegacyAST(ast.alternate))),
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
      const contentArray = [].concat(toLegacyAST(ast.content))
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
