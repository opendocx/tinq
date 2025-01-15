import { ASTInterpreter } from "./astinterpreter.mjs";
import { ASTCompiler } from "./astcompiler.mjs";
import { isAssignable } from "./utils.mjs";
import filters from "./filters.mjs"

const filterAliases = {}
for (const name in filters) {
	const func = filters[name]
	if (func && func.aliases) {
		func.aliases.forEach(alias => {
			filterAliases[alias] = func
		})
	}
}

export class Parser {
	constructor (lexer, typeDict, options) {
		this.lexer = lexer
		this.options = options
		this.typeDict = typeDict
		this.$filter = function getFilter (name) {
			return filters[name] || filterAliases[name]
		}
		this.ast = new AST(lexer, options)
		this.astCompiler = options.csp
			? new ASTInterpreter(this.ast, this.$filter)
			: new ASTCompiler(this.ast, this.$filter)
	}

	parse (text) {
		return this.ast.ast_expr(text)
	}

	compile (text) {
		return this.astCompiler.compile(text)
	}
}

export class AST {
  constructor (lexer, options) {
    this.lexer = lexer
    this.options = options
    this.selfReferential = {
      this: { type: AST.ThisExpression },
      $locals: { type: AST.LocalsExpression }
    }
  }

	ast (text) { // deprecated, for expressions, in favor of ast_expr below.
		// instead, top-level asts/programs are reserved for templates.
		this.text = text
		this.tokens = this.lexer.lex(text)

		const value = this.program()

		if (this.tokens.length !== 0) {
			this.throwError("is an unexpected token", this.tokens[0])
		}

		return value
	}

	ast_expr (text) {
		this.text = text
		this.tokens = this.lexer.lex(text)
		const value = this.tokens.length ? this.filterChain() : null
		if (this.tokens.length !== 0) {
			this.throwError("is an unexpected token", this.tokens[0])
		}
		return value
	}

	addLoc (node, start, end) {
		if (this.options.includeLocation && typeof start === "number") {
			node.loc = { start: { column: start } }
			if (typeof end === "number") {
				node.loc.end = { column: end }
			}
		}
		return node
	}

	program () {
		const body = []
		let start
		while (true) {
			if (this.tokens.length > 0 && !this.peek("}", ")", ";", "]")) {
				start = this.tokens[0].index
				body.push(this.expressionStatement())
			}
			if (!this.expect(";")) {
				return this.addLoc(
					{ type: AST.Program, body: body },
					start,
					body && body.length && body[0].loc && body[0].loc.end && body[0].loc.end.column
				)
			}
		}
	}

	expressionStatement () {
		const start = this.tokens[0].index
		const expr = this.filterChain()
		return this.addLoc({ type: AST.ExpressionStatement, expression: expr }, start, expr.loc && expr.loc.end && expr.loc.end.column)
	}

	filterChain () {
		let left = this.expression()
		while (this.expect("|")) {
			left = this.filter(left)
		}
		return left
	}

	expression () {
		return this.assignment() // since an assignment can occur basically anywhere an expression can occur
	}

	lambdaExpression () {
		// const start = this.tokens[0].index
		let result = //this.addLoc(
			{
				type: AST.LambdaExpression,
				body: this.ternary(),
			}
		//, start)
		return result
	}

	assignment () { // parses bare expressions AND assignments!
		const start = this.tokens[0].index
		let result = this.ternary()
		if (this.expect("=")) {
			if (!isAssignable(result)) {
				throw new Error("Trying to assign a value to a non l-value")
			}

			result = this.addLoc({
				type: AST.AssignmentExpression,
				left: result,
				right: this.assignment(),
				operator: "="
			}, start)
		}
		return result
	}

	ternary () {
		const start = this.tokens[0].index
		const test = this.logicalOR()
		let consequent
		let alternate
		if (this.expect("?")) {
			consequent = this.expression()
			if (this.consume(":")) {
				alternate = this.expression()
				return this.addLoc({
					type: AST.ConditionalExpression,
					test: test,
					consequent: consequent,
					alternate: alternate,
				}, start)
			}
		}
		return test
	}

	logicalOR () {
		const start = this.tokens[0].index
		let left = this.logicalAND()
		while (this.expect("||")) {
			left = this.addLoc({
				type: AST.LogicalExpression,
				operator: "||",
				left: left,
				right: this.logicalAND()
			}, start)
		}
		return left
	}

	logicalAND () {
		const start = this.tokens[0].index
		let left = this.equality()
		while (this.expect("&&")) {
			left = this.addLoc({
				type: AST.LogicalExpression,
				operator: "&&",
				left: left,
				right: this.equality()
			}, start)
		}
		return left
	}

	equality () {
		const start = this.tokens[0].index
		let left = this.relational()
		let token
		while ((token = this.expect("==", "!=", "===", "!=="))) {
			left = this.addLoc({
				type: AST.BinaryExpression,
				operator: token.text,
				left: left,
				right: this.relational()
			}, start)
		}
		return left
	}

	relational () {
		let left = this.additive()
		let token
		while ((token = this.expect("<", ">", "<=", ">="))) {
			left = {
				type: AST.BinaryExpression,
				operator: token.text,
				left: left,
				right: this.additive()
			}
		}
		return left
	}

	additive () {
		let left = this.multiplicative()
		let token
		while ((token = this.expect("+", "-"))) {
			left = {
				type: AST.BinaryExpression,
				operator: token.text,
				left: left,
				right: this.multiplicative()
			}
		}
		return left
	}

	multiplicative () {
		let left = this.unary()
		let token;
		while ((token = this.expect("*", "/", "%"))) {
			left = {
				type: AST.BinaryExpression,
				operator: token.text,
				left: left,
				right: this.unary()
			}
		}
		return left
	}

	unary () {
		let token;
		if ((token = this.expect("+", "-", "!"))) {
			return {
				type: AST.UnaryExpression,
				operator: token.text,
				prefix: true,
				argument: this.unary()
			}
		} else {
			return this.primary()
		}
	}

	sortKey () {
		const token = this.expect("+", "-")
		return {
			type: AST.SortKeyExpression,
			key: this.primary(),
			descending: Boolean(token && token.text === "-"),
		}
	}

	selfRef () {
		const start = this.tokens[0].index
		const token = this.consume().text
		return this.addLoc({ ...this.selfReferential[token] }, start, start + token.length)
	}

	primary () {
		let primary
		if (this.expect("(")) {
			primary = this.filterChain()
			this.consume(")")
			if (primary.rtl) {
				primary.endGroup = true // the parentheses override this node's normal RTL behavior
			}
		} else if (this.expect("[")) {
			primary = this.arrayDeclaration()
		} else if (this.expect("{")) {
			primary = this.object()
		} else if (this.selfReferential.hasOwnProperty(this.peek().text)) {
			primary = this.selfRef()
		} else if (this.options.literals.hasOwnProperty(this.peek().text)) {
			primary = {
				type: AST.Literal,
				value: this.options.literals[this.consume().text]
			}
		} else if (this.peek().identifier) {
			primary = this.identifier()
		} else if (this.peek().constant) {
			primary = this.constant()
		} else {
			this.throwError("not a primary expression", this.peek())
		}

		let next
		while ((next = this.expect("(", "[", "."))) {
			if (next.text === "(") {
				primary = {
					type: AST.CallExpression,
					callee: primary,
					arguments: this.parseArguments()
				}
				this.consume(")")
			} else if (next.text === "[") {
				primary = {
					type: AST.MemberExpression,
					object: primary,
					property: this.expression(),
					computed: true
				}
				this.consume("]")
			} else if (next.text === ".") {
				primary = {
					type: AST.MemberExpression,
					object: primary,
					property: this.identifier(),
					computed: false
				}
			} else {
				this.throwError("IMPOSSIBLE")
			}
		}
		return primary
	}

	filter (baseExpression) {
		const filterIdent = this.identifier()
		let filterFunc = filters[filterIdent.name]
		if (!filterFunc) {
			filterFunc = filterAliases[filterIdent.name]
			if (filterFunc) {
				// filterIdent.origName = filterIdent.name // breaks some tests right now, but might be useful?
				filterIdent.name = filterFunc.name // aliases get normalized in AST
			}
		}
		const isListFilter = filterFunc && filterFunc.listFilter
		const isSort = isListFilter && filterFunc.keyFilter
		const isRTL = isListFilter && filterFunc.rtlFilter
		const newNode = {
			type: AST.FilterExpression,
			filter: filterIdent,
			input: baseExpression,
			lambda: Boolean(isListFilter),
			rtl: Boolean(isRTL),
		}
		const args = newNode.arguments = []
		let argNum = 0
		while (this.expect(":")) {
			args.push(
				isSort
					? this.sortKey()
					: isListFilter && argNum === 0
					  ? this.lambdaExpression()
						: this.expression()
			)
			argNum++
		}
		if (isRTL && baseExpression.rtl && !baseExpression.endGroup) {
			// modify filter chaining for adjacent filters with right-to-left preference
			let reparent = baseExpression
			while (reparent.arguments[0].body.rtl && !reparent.endGroup) {
				reparent = reparent.arguments[0].body
			}
			newNode.input = reparent.arguments[0].body
			reparent.arguments[0].body = newNode
			return baseExpression
		} // else
		return newNode
	}

	parseArguments () {
		const args = []
		if (this.peekToken().text !== ")") {
			do {
				args.push(this.filterChain())
			} while (this.expect(","))
		}
		return args
	}

	identifier () {
		const start = this.tokens[0].index
		const end = start + this.tokens[0].text.length
		const token = this.consume()
		if (!token.identifier) {
			this.throwError("is not a valid identifier", token)
		}
		return this.addLoc({ type: AST.Identifier, name: token.text }, start, end)
	}

	constant () {
		// TODO check that it is a constant
		return { type: AST.Literal, value: this.consume().value }
	}

	arrayDeclaration () {
		const elements = []
		if (this.peekToken().text !== "]") {
			do {
				if (this.peek("]")) {
					// Support trailing commas per ES5.1.
					break
				}
				elements.push(this.expression())
			} while (this.expect(","))
		}
		this.consume("]")

		return { type: AST.ArrayExpression, elements: elements }
	}

	object () {
		const properties = []
		let property
		if (this.peekToken().text !== "}") {
			do {
				if (this.peek("}")) {
					// Support trailing commas per ES5.1.
					break
				}
				property = { type: AST.Property, kind: "init" }
				if (this.peek().constant) {
					property.key = this.constant()
					property.computed = false
					this.consume(":")
					property.value = this.expression()
				} else if (this.peek().identifier) {
					property.key = this.identifier()
					property.computed = false
					if (this.peek(":")) {
						this.consume(":")
						property.value = this.expression()
					} else {
						property.value = property.key
					}
				} else if (this.peek("[")) {
					this.consume("[")
					property.key = this.expression()
					this.consume("]")
					property.computed = true
					this.consume(":")
					property.value = this.expression()
				} else {
					this.throwError("invalid key", this.peek())
				}
				properties.push(property)
			} while (this.expect(","))
		}
		this.consume("}")

		return { type: AST.ObjectExpression, properties: properties }
	}

	throwError (msg, token) {
		throw new Error(`Syntax Error: Token '${token.text}' ${msg} at column ${
      token.index + 1} of the expression [${this.text}] starting at [${
      this.text.substring(token.index)}].`)
	}

	consume (e1) {
		if (this.tokens.length === 0) {
			throw new Error(`Unexpected end of expression: ${this.text}`)
		}

		const token = this.expect(e1)
		if (!token) {
			this.throwError("is unexpected, expecting [" + e1 + "]", this.peek())
		}
		return token
	}

	peekToken () {
		if (this.tokens.length === 0) {
			throw new Error(`Unexpected end of expression: ${this.text}`)
		}
		return this.tokens[0]
	}

	peek (e1, e2, e3, e4) {
		return this.peekAhead(0, e1, e2, e3, e4)
	}

	peekAhead (i, e1, e2, e3, e4) {
		if (this.tokens.length > i) {
			const token = this.tokens[i]
			const t = token.text
			if (
				t === e1 ||
				t === e2 ||
				t === e3 ||
				t === e4 ||
				(!e1 && !e2 && !e3 && !e4)
			) {
				return token
			}
		}
		return false
	}

	expect (e1, e2, e3, e4) {
		const token = this.peek(e1, e2, e3, e4)
		if (token) {
			this.tokens.shift()
			return token
		}
		return false
	}
}

AST.Identifier = 'Identifier'
AST.Literal = 'Literal'
AST.Program = 'Program' // a template
AST.BlockStatement = 'BlockStatement' // a sequence of quasis and fields in a template
AST.QuasiStatement = 'QuasiStatement' // a chunk of boilerplate text in a template
AST.ExpressionStatement = 'ExpressionStatement' // a content field in a template
AST.EmptyStatement = 'EmptyStatement' // no-op statement in a template
AST.IfStatement = 'IfStatement' // an if/elseif/else/endif block in a template
AST.ForOfStatement = 'ForOfStatement' // a list/endlist block in a template
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
// also includes some custom/proprietary node types:
AST.LocalsExpression = 'LocalsExpression' // "$locals" keyword -- like 'ThisExpression', but for angular-expressions' local scope
AST.FilterExpression = 'FilterExpression' // properties: input (node), filter (ident), arguments (node array)
AST.LambdaExpression = 'LambdaExpression' // list filter argument -- properties: body (node)
AST.SortKeyExpression = 'SortKeyExpression' // sort filter argument -- properties: key (node), descending (bool)
// static methods
AST.serialize = serializeAstNode
AST.mutateInPlace = astMutateInPlace
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
  [AST.LocalsExpression]: 21,
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

function astMutateInPlace (node, mutator) {
  var nodeModified = mutator(node)
  switch (node.type) {
    case AST.Program:
      return nodeModified | node.body.reduce(
        (accumulator, statementObj) => (accumulator |= astMutateInPlace(statementObj, mutator)),
        false
      )
    case AST.ExpressionStatement:
      return nodeModified | astMutateInPlace(node.expression, mutator)
    case AST.Literal:
    case AST.Identifier:
    case AST.ThisExpression:
    case AST.LocalsExpression:
      return nodeModified
    case AST.MemberExpression:
      return nodeModified | astMutateInPlace(node.object, mutator) | astMutateInPlace(node.property, mutator)
    case AST.CallExpression:
      return nodeModified | astMutateInPlace(node.callee, mutator) | node.arguments.reduce(
        (accumulator, argObj) => (accumulator |= astMutateInPlace(argObj, mutator)),
        false
      )
    case AST.FilterExpression:
      return nodeModified | astMutateInPlace(node.filter, mutator)
        | astMutateInPlace(node.input, mutator) | node.arguments.reduce(
        (accumulator, argObj) => (accumulator |= astMutateInPlace(argObj, mutator)),
        false
      )
		case AST.LambdaExpression:
			return nodeModified | astMutateInPlace(node.body, mutator)
		case AST.SortKeyExpression:
			return nodeModified | astMutateInPlace(node.key, mutator)
		case AST.ArrayExpression:
      return nodeModified | node.elements.reduce(
        (accumulator, elem) => (accumulator |= astMutateInPlace(elem, mutator)),
        false
      )
    case AST.ObjectExpression:
      return nodeModified | node.properties.reduce(
        (accumulator, prop) => (accumulator |= astMutateInPlace(prop, mutator)),
        false
      )
    case AST.Property:
      return nodeModified | astMutateInPlace(node.key, mutator) | astMutateInPlace(node.value, mutator)
    case AST.BinaryExpression:
    case AST.LogicalExpression:
      return nodeModified | astMutateInPlace(node.left, mutator) | astMutateInPlace(node.right, mutator)
    case AST.UnaryExpression:
      return nodeModified | astMutateInPlace(node.argument, mutator)
    case AST.ConditionalExpression:
      return nodeModified | astMutateInPlace(node.test, mutator) | astMutateInPlace(node.consequent, mutator)
        | astMutateInPlace(node.alternate, mutator)
    default:
      return false
  }
}

function getExpressionPrecedence (node) {
	if (node.type === AST.LambdaExpression)
			return EXPRESSIONS_PRECEDENCE[node.body.type]
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
  switch (ast.type) {
    case AST.Program:
		case AST.BlockStatement:
      return ast.body.map(statement => serializeAstNode(statement, subs)).join(ast.joiner || '')
		case AST.QuasiStatement:
			return (ast.value && ast.value.raw) || ast.value
    case AST.ExpressionStatement:
      return '{[' + serializeAstNode(ast.expression, subs) + ']}'
		case AST.IfStatement: {
			return (isElseIf ? '{[elseif ' : '{[if ')
				+ serializeAstNode(ast.test, subs) + ']}'
			  + serializeAstNode(ast.consequent, subs)
				+ ast.alternate
				  ? ast.alternate.type === AST.IfStatement
					  ? '{[elseif ' + serializeAstNode(ast.alternate.test, subs) + ']}' + serializeAstNode(ast.alternate.consequent)
						: '{[else]}' + serializeAstNode(ast.alternate, subs) + '{[endif]}'
					: '{[endif]}'
		}
    case AST.Literal:
      if (typeof ast.value === 'string') { return '"' + ast.value + '"' }
      if (ast.value === null) { return 'null' }
      return ast.value.toString()
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
			return serializeAstNode(ast.body) // serializeOptionallyWrapped(ast.body, subs, EXPRESSIONS_PRECEDENCE.LambdaExpression)
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
    case AST.LocalsExpression:
      return /* subs ? '' : */ '$locals'
		case AST.AssignmentExpression:
			return serializeAstNode(ast.left) + '=' + serializeAstNode(ast.right)
    default:
      throw new Error(`Unsupported expression type '${ast.type}'`)
  }
}
