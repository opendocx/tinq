// SPDX-License-Identifier: MPL-2.0

export class AST {

}

AST.Identifier = 'Identifier'
AST.Literal = 'Literal'
AST.Program = 'Program' // a template
AST.TemplateBlock = 'TemplateBlock' // a sequence of quasis and fields in a template
AST.TemplateElement = 'TemplateElement' // a chunk of boilerplate content (no fields) in a template
AST.ContentField = 'ContentField' // a content field in a template
AST.NoOp = 'NoOp' // no-op statement in a template
AST.ConditionalField = 'ConditionalField' // an if/elseif/else/endif block in a template
AST.ListField = 'ListField' // a list/endlist block in a template (properties: expression and content (block); optional lowering metadata: frame)
AST.ThisExpression = 'ThisExpression' // "this" keyword -- in angular-expression, this represents the "scope"
AST.ArrayExpression = 'ArrayExpression'
AST.ObjectExpression = 'ObjectExpression'
AST.Property = 'Property'
AST.UnaryExpression = 'UnaryExpression'
AST.BinaryExpression = 'BinaryExpression'
AST.LogicalExpression = 'LogicalExpression'
AST.MemberExpression = 'MemberExpression'
AST.ConditionalExpression = 'ConditionalExpression'
AST.CallExpression = 'CallExpression'
AST.AssignmentExpression = 'AssignmentExpression'
// also includes some custom node types:
AST.FilterExpression = 'FilterExpression' // properties: input (node), filter (ident), arguments (node array)
AST.LambdaExpression = 'LambdaExpression' // list filter argument -- properties: expression (node); optional lowering metadata: frame
AST.SortKeyExpression = 'SortKeyExpression' // sort filter argument -- properties: key (node), descending (bool); optional lowering metadata: frame
// static methods
AST.serialize = serializeAstNode
// Internal use only
AST.NGValueParameter = 'NGValueParameter'

// Some serialization logic adapted from AString
// https://github.com/davidbonnet/astring/blob/master/src/astring.js

const OPERATOR_PRECEDENCE = {
  '||': 3,
  '&&': 4,
  '==': 8,
  '!=': 8,
  '===': 8,
  '!==': 8,
  '<': 9,
  '>': 9,
  '<=': 9,
  '>=': 9,
  '+': 11,
  '-': 11,
  '*': 12,
  '%': 12,
  '/': 12
}

// Enables parenthesis regardless of precedence
const NEEDS_PARENTHESES = 18

const EXPRESSIONS_PRECEDENCE = {
  // Definitions
  [AST.ArrayExpression]: 21,
  [AST.ThisExpression]: 21,
  [AST.Identifier]: 21,
  // Operations
  [AST.MemberExpression]: 20,
  [AST.CallExpression]: 20,
  // Other definitions
  [AST.Literal]: 19,
  [AST.ObjectExpression]: NEEDS_PARENTHESES,
  // Other operations
  [AST.UnaryExpression]: 17,
	[AST.SortKeyExpression]: 17,
  [AST.BinaryExpression]: 14,
  [AST.LogicalExpression]: 12,
  [AST.ConditionalExpression]: 4,
  CommaOrSequence: 1,
  [AST.Property]: 1,
	[AST.LambdaExpression]: 1,
  [AST.FilterExpression]: 0,
}

function getExpressionPrecedence (node) {
	if (node.type === AST.LambdaExpression)
			return EXPRESSIONS_PRECEDENCE[node.expression.type]
	// else
  return EXPRESSIONS_PRECEDENCE[node.type]
}

function expressionNeedsParentheses (node, parentNode, isRightHand) {
  const nodePrecedence = getExpressionPrecedence(node)
  if (nodePrecedence === NEEDS_PARENTHESES) {
    return true
  }
  const parentNodePrecedence = getExpressionPrecedence(parentNode)
  if (nodePrecedence !== parentNodePrecedence) {
    // Different node types
    return nodePrecedence < parentNodePrecedence
  }
  if (nodePrecedence !== EXPRESSIONS_PRECEDENCE.LogicalExpression
    && nodePrecedence !== EXPRESSIONS_PRECEDENCE.BinaryExpression) {
    return false
  }
  if (isRightHand) {
    // Parenthesis are used if both operators have the same precedence
    return (OPERATOR_PRECEDENCE[node.operator] <= OPERATOR_PRECEDENCE[parentNode.operator])
  }
  return (OPERATOR_PRECEDENCE[node.operator] < OPERATOR_PRECEDENCE[parentNode.operator])
}

function serializeOptionallyWrapped (node, subs, maxPrecedence, orEqual = false) {
  const wrap = orEqual
    ? (getExpressionPrecedence(node) <= maxPrecedence)
    : (getExpressionPrecedence(node) < maxPrecedence)
  return (wrap || node.endGroup) ? ('(' + serializeAstNode(node, subs) + ')') : serializeAstNode(node, subs)
}

function serializeFilterArg (argNode, rtl) {
	const argPrecedence = getExpressionPrecedence(argNode)
	const filterPrecedence = EXPRESSIONS_PRECEDENCE[AST.FilterExpression] // getExpressionPrecedence(filterNode)
	if (rtl) { // right-to-left precedence by default for this filter
		// so if arg is also a filter, DON'T wrap it in parens
		return serializeAstNode(argNode)
	} else { // normal/default left-to-right precedence
		// otherwise, if arg is a filter, it WILL need to be wrapped in parens
		return serializeOptionallyWrapped(argNode, false, filterPrecedence, true)
	}
}

function serializeBinaryExpressionPart (node, parentNode, isRightHand, subs) {
  /*
    serializes a left-hand or right-hand expression `node`
    from a binary expression applying the provided `operator`.
    The `isRightHand` parameter should be `true` if the `node` is a right-hand argument.
  */
  const result = serializeAstNode(node, subs)
  return expressionNeedsParentheses(node, parentNode, isRightHand) ? `(${result})` : result
}

function serializeAstNode (ast, subs = false, isElseIf = false) {
  if (ast === null) return ''
  switch (ast.type) {
    case AST.Program:
		case AST.TemplateBlock:
			return ast.body.map(statement => serializeAstNode(statement, subs)).join(ast.joiner || '')
		case AST.TemplateElement:
			return ast.text ?? ''
    case AST.ContentField:
      return '{[' + serializeAstNode(ast.expression, subs) + serializeComment(ast.comment, ast.commentPrefix) + ']}'
		case AST.ConditionalField:
			return (isElseIf ? '{[elseif ' : '{[if ')
				+ serializeAstNode(ast.test, subs) + serializeComment(ast.comment, ast.commentPrefix) + ']}'
			  + serializeAstNode(ast.consequent, subs)
				+ (ast.alternate
				  ? ast.alternate.type === AST.ConditionalField
					  ? serializeAstNode(ast.alternate, subs, true)
						: '{[else' + serializeComment(ast.altComment, ast.altCommentPrefix) + ']}' + serializeAstNode(ast.alternate, subs) + '{[endif' + serializeComment(ast.endComment, ast.endCommentPrefix) + ']}'
					: '{[endif' + serializeComment(ast.endComment, ast.endCommentPrefix) + ']}'
        )
    case AST.ListField:
      return '{[list ' + serializeAstNode(ast.expression, subs) + serializeComment(ast.comment, ast.commentPrefix) + ']}' + serializeAstNode(ast.content) + '{[endlist' + serializeComment(ast.endComment, ast.endCommentPrefix) + ']}'
    case AST.Literal:
      if (typeof ast.value === 'string') { return '"' + ast.value + '"' }
      if (ast.value === null) { return 'null' }
      return String(ast.value)
    case AST.Identifier:
      return ast.name
    case AST.MemberExpression:
      return serializeOptionallyWrapped(ast.object, subs, EXPRESSIONS_PRECEDENCE.MemberExpression) + (
        ast.computed
          ? ('[' + serializeAstNode(ast.property, subs) + ']')
          : ('.' + serializeAstNode(ast.property, subs))
      )
    case AST.CallExpression:
			return serializeAstNode(ast.callee, subs) + '('
				+ ast.arguments.map(
					argObj => serializeOptionallyWrapped(argObj, subs, EXPRESSIONS_PRECEDENCE.CommaOrSequence)
				).join(',') + ')'
    case AST.FilterExpression:
      return (
        serializeOptionallyWrapped(ast.input, subs, EXPRESSIONS_PRECEDENCE.FilterExpression)
        + '|' + serializeAstNode(ast.filter, subs)
        + ast.arguments.map(arg =>
          ':' + serializeFilterArg(arg, ast.rtl) // serializeOptionallyWrapped(arg, subs, EXPRESSIONS_PRECEDENCE.FilterExpression)
        ).join('')
      )
		case AST.LambdaExpression:
			return serializeAstNode(ast.expression) // serializeOptionallyWrapped(ast.expression, subs, EXPRESSIONS_PRECEDENCE.LambdaExpression)
		case AST.SortKeyExpression:
			return (ast.descending ? '-' : '') +  serializeOptionallyWrapped(ast.key, subs, EXPRESSIONS_PRECEDENCE.SortKeyExpression)
		case AST.ArrayExpression:
      return '[' + ast.elements.map(
        elem => serializeOptionallyWrapped(elem, subs, EXPRESSIONS_PRECEDENCE.CommaOrSequence)
      ).join(',') + ']'
    case AST.ObjectExpression:
      return '{' + ast.properties.map(prop => serializeAstNode(prop, subs)).join(',') + '}'
    case AST.Property:
      return (ast.computed ? '[' : '') + serializeAstNode(ast.key, subs)
        + (ast.computed ? ']' : '') + ':'
        + serializeOptionallyWrapped(ast.value, subs, EXPRESSIONS_PRECEDENCE.Property)
    case AST.BinaryExpression:
    case AST.LogicalExpression:
      return serializeBinaryExpressionPart(ast.left, ast, false, subs)
        + ast.operator + serializeBinaryExpressionPart(ast.right, ast, true, subs)
    case AST.UnaryExpression:
      return ast.prefix
        ? ast.operator + serializeOptionallyWrapped(ast.argument, subs, EXPRESSIONS_PRECEDENCE.UnaryExpression)
        : serializeAstNode(ast.argument, subs) + ast.operator
    case AST.ConditionalExpression:
      return (
        serializeOptionallyWrapped(ast.test, subs, EXPRESSIONS_PRECEDENCE.ConditionalExpression, true)
        + '?' + serializeOptionallyWrapped(
          ast.consequent,
          subs,
          EXPRESSIONS_PRECEDENCE.ConditionalExpression
        ) + ':' + serializeOptionallyWrapped(
          ast.alternate,
          subs,
          EXPRESSIONS_PRECEDENCE.ConditionalExpression
        )
      )
    case AST.ThisExpression:
      return 'this'
		case AST.AssignmentExpression:
			return serializeAstNode(ast.left) + '=' + serializeAstNode(ast.right)
    default:
      throw new Error(`Unsupported expression type '${ast.type}'`)
  }
}

function serializeComment (comment, prefix = '//') {
  return comment === undefined ? '' : prefix + comment
}
