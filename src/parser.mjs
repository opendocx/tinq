import { isDefined, isString, isNumber, getStringValue, noop } from "./utils.mjs";
import filters from "./filters.mjs"

export class Parser {
	constructor (lexer, options) {
		this.lexer = lexer
		this.options = options
		this.$filter = function getFilter (name) {
			return filters[name]
		}
		this.ast = new AST(lexer, options)
		this.astCompiler = options.csp
			? new ASTInterpreter(this.ast, this.$filter)
			: new ASTCompiler(this.ast, this.$filter)
	}

	parse (text) {
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
		return this.assignment()
	}

	assignment () {
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

	primary () {
		let primary
		if (this.expect("(")) {
			primary = this.filterChain()
			this.consume(")")
		} else if (this.expect("[")) {
			primary = this.arrayDeclaration()
		} else if (this.expect("{")) {
			primary = this.object()
		} else if (this.selfReferential.hasOwnProperty(this.peek().text)) {
			primary = { ...this.selfReferential[this.consume().text] }
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
		const filterFunc = filters[filterIdent.name]
		const args = []
		const result = {
			type: filterFunc && filterFunc.listFilter ? AST.ListFilterExpression : AST.FilterExpression,
			filter: filterIdent,
			input: baseExpression,
			arguments: args
		}
		if (filterFunc && filterFunc.rtlFilter) result.rtl = true
		while (this.expect(":")) {
			args.push(this.expression())
		}
		return result
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

AST.Program = "Program" // a template
AST.ExpressionStatement = "ExpressionStatement" // a content field in a template
AST.IfStatement = 'IfStatement' // an if/elseif/else/endif block in a template
AST.ForOfStatement = 'ForOfStatement' // a list/endlist block in a template
AST.BlockStatement = 'BlockStatement' // a sequence of fields in a template
AST.EmptyStatement = 'EmptyStatement' // no-op statement in a template
AST.AssignmentExpression = "AssignmentExpression"
AST.ConditionalExpression = "ConditionalExpression"
AST.LogicalExpression = "LogicalExpression"
AST.BinaryExpression = "BinaryExpression"
AST.UnaryExpression = "UnaryExpression"
AST.CallExpression = "CallExpression"
AST.MemberExpression = "MemberExpression"
AST.Identifier = "Identifier"
AST.Literal = "Literal"
AST.ArrayExpression = "ArrayExpression"
AST.Property = "Property"
AST.ObjectExpression = "ObjectExpression"
AST.ThisExpression = "ThisExpression"
// Non-standard
AST.LocalsExpression = "LocalsExpression"
AST.FilterExpression = "FilterExpression"
AST.ListFilterExpression = "ListFilterExpression"

// Internal use only
AST.NGValueParameter = "NGValueParameter"

function ifDefined (v, d) {
	return typeof v !== "undefined" ? v : d
}

function plusFn (l, r) {
	if (typeof l === "undefined") return r
	if (typeof r === "undefined") return l
	return l + r
}

function isStateless ($filter, filterName) {
	const fn = $filter(filterName)
	return !fn.$stateful
}

function findConstantAndWatchExpressions (ast, $filter) {
	let allConstants
	let argsToWatch
	switch (ast.type) {
		case AST.Program:
			allConstants = true
      ast.body.forEach(expr => {
				findConstantAndWatchExpressions(expr.expression, $filter)
				allConstants = allConstants && expr.expression.constant
			})
			ast.constant = allConstants
			break
		case AST.Literal:
			ast.constant = true
			ast.toWatch = []
			break
		case AST.UnaryExpression:
			findConstantAndWatchExpressions(ast.argument, $filter)
			ast.constant = ast.argument.constant
			ast.toWatch = ast.argument.toWatch
			break
		case AST.BinaryExpression:
			findConstantAndWatchExpressions(ast.left, $filter)
			findConstantAndWatchExpressions(ast.right, $filter)
			ast.constant = ast.left.constant && ast.right.constant
			ast.toWatch = ast.left.toWatch.concat(ast.right.toWatch)
			break
		case AST.LogicalExpression:
			findConstantAndWatchExpressions(ast.left, $filter)
			findConstantAndWatchExpressions(ast.right, $filter)
			ast.constant = ast.left.constant && ast.right.constant
			ast.toWatch = ast.constant ? [] : [ast]
			break
		case AST.ConditionalExpression:
			findConstantAndWatchExpressions(ast.test, $filter)
			findConstantAndWatchExpressions(ast.consequent, $filter)
			findConstantAndWatchExpressions(ast.alternate, $filter)
			ast.constant = ast.test.constant && ast.consequent.constant && ast.alternate.constant
			ast.toWatch = ast.constant ? [] : [ast]
			break
		case AST.Identifier:
			ast.constant = false
			ast.toWatch = [ast]
			break
		case AST.MemberExpression:
			findConstantAndWatchExpressions(ast.object, $filter)
			if (ast.computed) {
				findConstantAndWatchExpressions(ast.property, $filter)
			}
			ast.constant = ast.object.constant && (!ast.computed || ast.property.constant)
			ast.toWatch = [ast]
			break
		case AST.CallExpression:
			ast.arguments.forEach(expr => {
				findConstantAndWatchExpressions(expr, $filter)
			})
			ast.constant = false
			ast.toWatch = [ast]
			break
		case AST.FilterExpression:
		case AST.ListFilterExpression:
			argsToWatch = []
			findConstantAndWatchExpressions(ast.input, $filter)
			if (!ast.input.constant) {
				argsToWatch.push.apply(argsToWatch, ast.input.toWatch)
			}
			allConstants = true
			ast.arguments.forEach(expr => {
				findConstantAndWatchExpressions(expr, $filter)
				allConstants = allConstants && expr.constant
				if (!expr.constant) {
					argsToWatch.push.apply(argsToWatch, expr.toWatch)
				}
			})
			ast.constant = allConstants
			ast.toWatch = argsToWatch
			break
		case AST.AssignmentExpression:
			findConstantAndWatchExpressions(ast.left, $filter)
			findConstantAndWatchExpressions(ast.right, $filter)
			ast.constant = ast.left.constant && ast.right.constant
			ast.toWatch = [ast]
			break
		case AST.ArrayExpression:
			allConstants = true
			argsToWatch = []
      ast.elements.forEach(expr => {
				findConstantAndWatchExpressions(expr, $filter)
				allConstants = allConstants && expr.constant
				if (!expr.constant) {
					argsToWatch.push.apply(argsToWatch, expr.toWatch)
				}
			})
			ast.constant = allConstants
			ast.toWatch = argsToWatch
			break
		case AST.ObjectExpression:
			allConstants = true
			argsToWatch = []
      ast.properties.forEach(property => {
				findConstantAndWatchExpressions(property.value, $filter)
				allConstants = allConstants && property.value.constant && !property.computed
				if (!property.value.constant) {
					argsToWatch.push.apply(argsToWatch, property.value.toWatch)
				}
			})
			ast.constant = allConstants
			ast.toWatch = argsToWatch
			break
		case AST.ThisExpression:
			ast.constant = false
			ast.toWatch = []
			break
		case AST.LocalsExpression:
			ast.constant = false
			ast.toWatch = []
			break
	}
}

function getInputs (body) {
	if (body.length !== 1) return
	const lastExpression = body[0].expression
	const candidate = lastExpression.toWatch
	if (candidate.length !== 1) return candidate
	return candidate[0] !== lastExpression ? candidate : undefined
}

function isAssignable (ast) {
	return ast.type === AST.Identifier || ast.type === AST.MemberExpression
}

function assignableAST (ast) {
	const exprAst = ast && ast.type === AST.Program && ast.body.length === 1
		? ast.body[0].expression
		: ast
	if (exprAst && isAssignable(exprAst)) {
		return {
			type: AST.AssignmentExpression,
			left: exprAst,
			right: { type: AST.NGValueParameter },
			operator: "="
		}
	}
}

function isLiteral (ast) {
	return ast.type === AST.Program
		? (
			ast.body.length === 0 ||
			(ast.body.length === 1 &&
				(ast.body[0].expression.type === AST.Literal ||
					ast.body[0].expression.type === AST.ArrayExpression ||
					ast.body[0].expression.type === AST.ObjectExpression))
		)
		: (
			ast.type === AST.Literal ||
			ast.type === AST.ArrayExpression ||
			ast.type === AST.ObjectExpression
		)
}

function isConstant (ast) {
	return ast.constant
}

function append(builder, str) {
	if (str) {
		builder.push(str)
	}
}

class ASTCompiler {
  constructor (astBuilder, $filter) {
    this.astBuilder = astBuilder
    this.$filter = $filter
    this.USE = "use"
    this.STRICT = "strict"
    this.stringEscapeRegex = /[^ a-zA-Z0-9]/g
  }

	compile (expression) {
		const self = this
		const ast = this.astBuilder.ast_expr(expression)
		this.state = {
			nextId: 0,
			filters: {},
			fn: { vars: [], body: [], own: {} },
			assign: { vars: [], body: [], own: {} },
			inputs: []
		}
		let extra = ""
		if (ast) {
			findConstantAndWatchExpressions(ast, self.$filter)
			// let assignable
			// this.stage = "assign"
			// if ((assignable = assignableAST(ast))) {
			// 	this.state.computing = "assign"
			// 	const result = this.nextId()
			// 	this.recurse(assignable, result)
			// 	this.return_(result)
			// 	extra = "fn.assign=" + this.generateFunction("assign", "s,v,l")
			// }
			// const toWatch = getInputs(ast.body)
			// self.stage = "inputs"
			// if (toWatch) {
			// 	toWatch.forEach((watch, key) => {
			// 		const fnKey = "fn" + key
			// 		self.state[fnKey] = { vars: [], body: [], own: {} }
			// 		self.state.computing = fnKey
			// 		const intoId = self.nextId()
			// 		self.recurse(watch, intoId)
			// 		self.return_(intoId)
			// 		self.state.inputs.push(fnKey)
			// 		watch.watchId = key
			// 	})
			// }
		}
		this.state.computing = "fn"
		this.stage = "main"
		if (ast) {
			// wrap AST in program body (if necessary) because that's what the compiler expects
			if (ast.type === AST.Program) {
				this.recurse(ast)
			} else {
				this.recurse({ type: AST.Program, body: [{ type: AST.ExpressionStatement, expression: ast }] })
			}
		}
		// The build and minification steps remove the string "use strict" from the code, but this is done using a regex.
		// This is a workaround for this until we do a better job at only removing the prefix only when we should.
		const fns = []
		append(fns, `"${this.USE} ${this.STRICT}"`)
		append(fns, this.filterPrefix())
		append(fns, `var fn=${this.generateFunction("fn", "s,l,a,i")}`)
		append(fns, extra)
		append(fns, this.watchFns())
		append(fns, 'return fn')
		// eslint-disable-next-line no-new-func
		const fn = new Function(
			"$filter",
			"getStringValue",
			"ifDefined",
			"plus",
			fns.join('\n')
		)(this.$filter, getStringValue, ifDefined, plusFn)

		this.state = this.stage = undefined
		fn.ast = ast
		if (ast) {
			fn.literal = isLiteral(ast)
			fn.constant = isConstant(ast)
		}
		return fn
	}

	watchFns () {
		const result = []
		const fns = this.state.inputs
		const self = this
		fns.forEach(name => {
			result.push(`var ${name}=${self.generateFunction(name, "s")}`)
		})
		if (fns.length) {
			result.push(`fn.inputs=[${fns.join(",")}];`)
		}
		return result.join("")
	}

	generateFunction (name, params) {
		return `function(${params}){${this.varsPrefix(name)}${this.body(name)}};`
	}

	filterPrefix () {
		const parts = []
		const self = this
		for (const [filter, id] of Object.entries(this.state.filters)) {
			parts.push(id + "=$filter(" + self.escape(filter) + ")")
		}
		if (parts.length) return `var ${parts.join(",")};`
		return ""
	}

	varsPrefix (section) {
		return this.state[section].vars.length
			? `var ${this.state[section].vars.join(",")};`
			: ""
	}

	body (section) {
		return this.state[section].body.join("")
	}

	recurse (
		ast,
		intoId,
		nameId,
		recursionFn,
		create,
		skipWatchIdCheck
	) {
		const self = this
		let left,
			right,
			args,
			expression
		recursionFn = recursionFn || noop
		if (!skipWatchIdCheck && isDefined(ast.watchId)) {
			intoId = intoId || this.nextId()
			this.if_(
				"i",
				this.lazyAssign(intoId, this.computedMember("i", ast.watchId)),
				this.lazyRecurse(ast, intoId, nameId, recursionFn, create, true)
			)
			return
		}
		switch (ast.type) {
			case AST.Program:
				ast.body.forEach((expression, pos) => {
					self.recurse(expression.expression, undefined, undefined, function (expr) {
						right = expr
					})
					if (pos !== ast.body.length - 1) {
						self.current().body.push(right, ";")
					} else {
						self.return_(right)
					}
				})
				break
			case AST.Literal:
				expression = this.escape(ast.value)
				this.assign(intoId, expression)
				recursionFn(intoId || expression)
				break
			case AST.UnaryExpression:
				this.recurse(ast.argument, undefined, undefined, function(expr) {
					right = expr
				})
				expression = ast.operator + "(" + this.ifDefined(right, 0) + ")"
				this.assign(intoId, expression)
				recursionFn(expression)
				break
			case AST.BinaryExpression:
				this.recurse(ast.left, undefined, undefined, function(expr) {
					left = expr
				})
				this.recurse(ast.right, undefined, undefined, function(expr) {
					right = expr
				})
				if (ast.operator === "+") {
					expression = this.plus(left, right)
				} else if (ast.operator === "-") {
					expression = this.ifDefined(left, 0) + ast.operator + this.ifDefined(right, 0)
				} else {
					expression = "(" + left + ")" + ast.operator + "(" + right + ")"
				}
				this.assign(intoId, expression)
				recursionFn(expression)
				break
			case AST.LogicalExpression:
				intoId = intoId || this.nextId()
				self.recurse(ast.left, intoId)
				self.if_(
					ast.operator === "&&" ? intoId : self.not(intoId),
					self.lazyRecurse(ast.right, intoId)
				)
				recursionFn(intoId)
				break
			case AST.ConditionalExpression:
				intoId = intoId || this.nextId()
				self.recurse(ast.test, intoId)
				self.if_(
					intoId,
					self.lazyRecurse(ast.consequent, intoId),
					self.lazyRecurse(ast.alternate, intoId),
				)
				recursionFn(intoId)
				break
			case AST.Identifier:
				intoId = intoId || this.nextId()
				if (nameId) {
					nameId.context =
						self.stage === "inputs"
							? "s"
							: this.assign(
									this.nextId(),
									this.getHasOwnProperty("l", ast.name) + "?l:s"
							  )
					nameId.computed = false
					nameId.name = ast.name
				}
				self.if_(
					self.stage === "inputs" ||
						self.not(self.getHasOwnProperty("l", ast.name)),
					function () {
						self.if_(
							self.stage === "inputs" ||
								"s",
							function() {
								if (create && create !== 1) {
									self.if_(
										self.isNull(self.nonComputedMember("s", ast.name)),
										self.lazyAssign(self.nonComputedMember("s", ast.name), "{}")
									)
								}
								self.assign(intoId, self.nonComputedMember("s", ast.name))
							}
						)
					},
					intoId &&
						self.lazyAssign(intoId, self.nonComputedMember("l", ast.name))
				)
				recursionFn(intoId)
				break
			case AST.MemberExpression:
				left = (nameId && (nameId.context = this.nextId())) || this.nextId()
				intoId = intoId || this.nextId()
				self.recurse(
					ast.object,
					left,
					undefined,
					function () {
						let member = null
						if (ast.computed) {
							right = self.nextId()
							member = self.computedMember(left, right)
						} else {
							member = self.nonComputedMember(left, ast.property.name)
							right = ast.property.name
						}
						self.if_(
							self.notNull(left),
							function () {
								if (ast.computed) {
									self.recurse(ast.property, right)
									self.getStringValue(right)
									if (create && create !== 1) {
										self.if_(self.not(member), self.lazyAssign(member, "{}"))
									}
									self.assign(intoId, member)
									if (nameId) {
										nameId.computed = true
										nameId.name = right
									}
								} else {
									if (create && create !== 1) {
										self.if_(
											self.isNull(member),
											self.lazyAssign(member, "{}")
										)
									}
									self.assign(intoId, member)
									if (nameId) {
										nameId.computed = false
										nameId.name = ast.property.name
									}
								}
							},
							function () {
								self.assign(intoId, "undefined")
							}
						)
						recursionFn(intoId)
					},
					!!create
				)
				break
			case AST.CallExpression:
				intoId = intoId || this.nextId()
				right = self.nextId()
				left = {}
				args = []
				self.recurse(ast.callee, right, left, function () {
					self.if_(
						self.notNull(right),
						function () {
							ast.arguments.forEach(expr => {
								self.recurse(
									expr,
									ast.constant ? undefined : self.nextId(),
									undefined,
									function (argument) {
										args.push(argument)
									}
								)
							})
							if (left.name) {
								expression =
									self.member(left.context, left.name, left.computed) +
									"(" + args.join(",") + ")"
							} else {
								expression = right + "(" + args.join(",") + ")"
							}
							self.assign(intoId, expression)
						},
						function () {
							self.assign(intoId, "undefined")
						}
					)
					recursionFn(intoId)
				})
				break
			case AST.FilterExpression:
				intoId = intoId || this.nextId()
				right = self.filter(ast.filter.name)
				args = []
				left = self.nextId()
				self.recurse(ast.input, left)
				args.push(left)
				ast.arguments.forEach(expr => {
					const argument = self.nextId()
					self.recurse(expr, argument)
					args.push(argument)
				})
				expression = right + "(" + args.join(",") + ")"
				self.assign(intoId, expression)
				recursionFn(intoId)
				break
			case AST.ListFilterExpression:
				throw new Error("Not Implemented")
				break
			case AST.AssignmentExpression:
				right = this.nextId()
				left = {}
				this.recurse(
					ast.left,
					undefined,
					left,
					function () {
						self.if_(
							self.notNull(left.context),
							function () {
								self.recurse(ast.right, right)
								expression =
									self.member(left.context, left.name, left.computed) +
									ast.operator +
									right
								self.assign(intoId, expression)
								recursionFn(intoId || expression)
							}
						)
					},
					1
				)
				break
			case AST.ArrayExpression:
				args = []
				ast.elements.forEach(expr => {
					self.recurse(
						expr,
						ast.constant ? undefined : self.nextId(),
						undefined,
						function (argument) {
							args.push(argument)
						}
					)
				})
				expression = "[" + args.join(",") + "]"
				this.assign(intoId, expression)
				recursionFn(intoId || expression)
				break
			case AST.ObjectExpression:
				args = []
				if (ast.properties.some(property => property.computed)) {
					intoId = intoId || this.nextId()
					this.assign(intoId, "{}")
					ast.properties.forEach(property => {
						if (property.computed) {
							left = self.nextId()
							self.recurse(property.key, left)
						} else {
							left = property.key.type === AST.Identifier ? property.key.name : "" + property.key.value
						}
						right = self.nextId()
						self.recurse(property.value, right)
						self.assign(self.member(intoId, left, property.computed), right)
					})
				} else {
					ast.properties.forEach(property => {
						self.recurse(
							property.value,
							ast.constant ? undefined : self.nextId(),
							undefined,
							function (expr) {
								args.push(
									self.escape(property.key.type === AST.Identifier ? property.key.name : "" + property.key.value )
									  + ":" + expr
								)
							}
						)
					})
					expression = "{" + args.join(",") + "}"
					this.assign(intoId, expression)
				}
				recursionFn(intoId || expression)
				break
			case AST.ThisExpression:
				this.assign(intoId, "s")
				recursionFn(intoId || "s")
				break
			case AST.LocalsExpression:
				this.assign(intoId, "l")
				recursionFn(intoId || "l")
				break
			case AST.NGValueParameter:
				this.assign(intoId, "v")
				recursionFn(intoId || "v")
				break
		}
	}

	getHasOwnProperty (element, property) {
		const key = element + "." + property
		const own = this.current().own
		if (!own.hasOwnProperty(key)) {
			own[key] = this.nextId(
				false,
				element + "&&(" + this.escape(property) + " in " + element + ")"
			)
		}
		return own[key]
	}

	assign (id, value) {
		if (!id) return
		this.current().body.push(id, "=", value, ";")
		return id
	}

	filter (filterName) {
		if (!this.state.filters.hasOwnProperty(filterName)) {
			this.state.filters[filterName] = this.nextId(true)
		}
		return this.state.filters[filterName]
	}

	ifDefined (id, defaultValue) {
		return "ifDefined(" + id + "," + this.escape(defaultValue) + ")"
	}

	plus (left, right) {
		return "plus(" + left + "," + right + ")"
	}

	return_ (id) {
		this.current().body.push("return ", id, ";")
	}

	if_ (test, consequent, alternate) {
		if (test === true) {
			consequent()
		} else {
			const body = this.current().body
			body.push("if(", test, "){")
			consequent()
			body.push("}")
			if (alternate) {
				body.push("else{")
				alternate()
				body.push("}")
			}
		}
	}

	not (expression) {
		return "!(" + expression + ")"
	}

	isNull (expression) {
		return expression + "==null"
	}

	notNull (expression) {
		return expression + "!=null"
	}

	nonComputedMember (left, right) {
		const SAFE_IDENTIFIER = /^[$_a-zA-Z][$_a-zA-Z0-9]*$/
		const UNSAFE_CHARACTERS = /[^$_a-zA-Z0-9]/g
		let expr = ""
		if (SAFE_IDENTIFIER.test(right)) {
			expr = left + "." + right
		} else {
			right = right.replace(UNSAFE_CHARACTERS, this.stringEscapeFn)
			expr = left + '["' + right + '"]'
		}
		return expr
	}

	computedMember (left, right) {
		return left + "[" + right + "]"
	}

	member (left, right, computed) {
		if (computed) return this.computedMember(left, right)
		return this.nonComputedMember(left, right)
	}

	getStringValue (item) {
		this.assign(item, "getStringValue(" + item + ")")
	}

	lazyRecurse (ast, intoId, nameId, recursionFn, create, skipWatchIdCheck) {
		const self = this
		return function () {
			self.recurse(ast, intoId, nameId, recursionFn, create, skipWatchIdCheck)
		}
	}

	lazyAssign (id, value) {
		const self = this;
		return function () {
			self.assign(id, value)
		}
	}

	stringEscapeFn (c) {
		return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4)
	}

	escape (value) {
		if (isString(value))
			return "'" + value.replace(this.stringEscapeRegex, this.stringEscapeFn) + "'"
		if (isNumber(value)) return value.toString()
		if (value === true) return "true"
		if (value === false) return "false"
		if (value === null) return "null"
		if (typeof value === "undefined") return "undefined"
		throw new Error("IMPOSSIBLE")
	}

	nextId (skip, init) {
		const id = "v" + this.state.nextId++
		if (!skip) {
			this.current().vars.push(id + (init ? "=" + init : ""))
		}
		return id
	}

	current () {
		return this.state[this.state.computing]
	}
}

class ASTInterpreter {
	constructor (astBuilder, $filter) {
		this.astBuilder = astBuilder
		this.$filter = $filter
	}

	compile (expression) {
		const self = this
		const ast = this.astBuilder.ast_expr(expression)
		const expressions = []
		const astProg = ast && ast.type === AST.Program
		  ? ast
			: { type: AST.Program, body: (
				ast
					? [{ type: AST.ExpressionStatement, expression: ast }]
					: []
			) }
		if (ast) {
			findConstantAndWatchExpressions(ast, self.$filter)
			// let assignable
			// let assign
			// if ((assignable = assignableAST(ast))) {
			// 	assign = this.recurse(assignable)
			// }
		}
		// const toWatch = getInputs(astProg.body)
		// let inputs
		// if (toWatch) {
		// 	inputs = []
		// 	toWatch.forEach((watch, key) => {
		// 		const input = self.recurse(watch)
		// 		watch.winput = input
		// 		inputs.push(input)
		// 		watch.watchId = key
		// 	})
		// }
		astProg.body.forEach(expression => {
			expressions.push(self.recurse(expression.expression))
		})
		const fn = astProg.body.length === 0
			? noop
			: astProg.body.length === 1
				? expressions[0]
				: function (scope, locals) {
					let lastValue;
					expressions.forEach(exp => {
						lastValue = exp(scope, locals)
					})
					return lastValue
				}
		// if (assign) {
		// 	fn.assign = function (scope, value, locals) {
		// 		return assign(scope, locals, value)
		// 	}
		// }
		// if (inputs) {
		// 	fn.inputs = inputs
		// }
		fn.ast = ast
		if (ast) {
			fn.literal = isLiteral(ast)
			fn.constant = isConstant(ast)
		}
		return fn
	}

	recurse (ast, context, create) {
		const self = this
		let left,
			right,
			args
		if (ast.winput) {
			return this.inputs(ast.winput, ast.watchId)
		}
		switch (ast.type) {
			case AST.Literal:
				return this.value(ast.value, context)
			case AST.UnaryExpression:
				right = this.recurse(ast.argument)
				return this["unary" + ast.operator](right, context)
			case AST.BinaryExpression:
				left = this.recurse(ast.left)
				right = this.recurse(ast.right)
				return this["binary" + ast.operator](left, right, context)
			case AST.LogicalExpression:
				left = this.recurse(ast.left)
				right = this.recurse(ast.right)
				return this["binary" + ast.operator](left, right, context)
			case AST.ConditionalExpression:
				return this["ternary?:"](
					this.recurse(ast.test),
					this.recurse(ast.consequent),
					this.recurse(ast.alternate),
					context
				)
			case AST.Identifier:
				return self.identifier(ast.name, context, create)
			case AST.MemberExpression:
				left = this.recurse(ast.object, false, !!create)
				if (!ast.computed) {
					right = ast.property.name
				}
				if (ast.computed) right = this.recurse(ast.property)
				return ast.computed
					? this.computedMember(left, right, context, create)
					: this.nonComputedMember(left, right, context, create)
			case AST.CallExpression:
				args = []
				ast.arguments.forEach(expr => {
					args.push(self.recurse(expr))
				})
				right = this.recurse(ast.callee, true)
				return function (scope, locals, assign, inputs) {
					const rhs = right(scope, locals, assign, inputs)
					let value
					if (rhs.value != null) {
						const values = []
						for (let i = 0; i < args.length; ++i) {
							values.push(args[i](scope, locals, assign, inputs))
						}
						value = rhs.value.apply(rhs.context, values)
					}
					return context ? { value: value } : value
				}
			case AST.FilterExpression:
				args = []
				args.push(self.recurse(ast.input))
				ast.arguments.forEach(expr => {
					args.push(self.recurse(expr))
				})
				right = this.$filter(ast.filter.name)
				return function (scope, locals, assign, inputs) {
					const values = []
					for (let i = 0; i < args.length; ++i) {
						values.push(args[i](scope, locals, assign, inputs))
					}
					const value = right.apply(undefined, values, inputs)
					return context
						? { context: undefined, name: undefined, value: value }
						: value
				}
			case AST.ListFilterExpression:
				throw new Error("Not Implemented")
			case AST.AssignmentExpression:
				left = this.recurse(ast.left, true, 1)
				right = this.recurse(ast.right)
				return function (scope, locals, assign, inputs) {
					const lhs = left(scope, locals, assign, inputs)
					const rhs = right(scope, locals, assign, inputs)
					lhs.context[lhs.name] = rhs
					return context ? { value: rhs } : rhs
				}
			case AST.ArrayExpression:
				args = []
				ast.elements.forEach(expr => {
					args.push(self.recurse(expr))
				})
				return function (scope, locals, assign, inputs) {
					const value = []
					for (let i = 0; i < args.length; ++i) {
						value.push(args[i](scope, locals, assign, inputs))
					}
					return context ? { value: value } : value
				}
			case AST.ObjectExpression:
				args = []
				ast.properties.forEach(property => {
					if (property.computed) {
						args.push({
							key: self.recurse(property.key),
							computed: true,
							value: self.recurse(property.value)
						})
					} else {
						args.push({
							key: property.key.type === AST.Identifier ? property.key.name : "" + property.key.value,
							computed: false,
							value: self.recurse(property.value)
						})
					}
				})
				return function (scope, locals, assign, inputs) {
					const value = {}
					for (let i = 0; i < args.length; ++i) {
						if (args[i].computed) {
							value[args[i].key(scope, locals, assign, inputs)] = args[i].value(scope, locals, assign, inputs)
						} else {
							value[args[i].key] = args[i].value(scope, locals, assign, inputs)
						}
					}
					return context ? { value: value } : value
				}
			case AST.ThisExpression:
				return function (scope) {
					return context ? { value: scope } : scope
				}
			case AST.LocalsExpression:
				return function (scope, locals) {
					return context ? { value: locals } : locals
				}
			case AST.NGValueParameter:
				return function (scope, locals, assign) {
					return context ? { value: assign } : assign
				}
		}
	}

	"unary+" (argument, context) {
		return function (scope, locals, assign, inputs) {
			let arg = argument(scope, locals, assign, inputs)
			if (isDefined(arg)) {
				arg = +arg
			} else {
				arg = 0
			}
			return context ? { value: arg } : arg
		}
	}

	"unary-" (argument, context) {
		return function (scope, locals, assign, inputs) {
			let arg = argument(scope, locals, assign, inputs)
			if (isDefined(arg)) {
				arg = -arg
			} else {
				arg = -0
			}
			return context ? { value: arg } : arg
		}
	}

	"unary!" (argument, context) {
		return function (scope, locals, assign, inputs) {
			const arg = !argument(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	"binary+" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			const lhs = left(scope, locals, assign, inputs)
			const rhs = right(scope, locals, assign, inputs)
			const arg = plusFn(lhs, rhs)
			return context ? { value: arg } : arg
		}
	}

	"binary-" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			const lhs = left(scope, locals, assign, inputs)
			const rhs = right(scope, locals, assign, inputs)
			const arg = (isDefined(lhs) ? lhs : 0) - (isDefined(rhs) ? rhs : 0);
			return context ? { value: arg } : arg
		}
	}

	"binary*" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			const arg = left(scope, locals, assign, inputs) * right(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	"binary/" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			const arg = left(scope, locals, assign, inputs) / right(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	"binary%" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			const arg = left(scope, locals, assign, inputs) % right(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	"binary===" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			const arg = left(scope, locals, assign, inputs) === right(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	"binary!==" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			const arg = left(scope, locals, assign, inputs) !== right(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	"binary==" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			// eslint-disable-next-line eqeqeq
			const arg = left(scope, locals, assign, inputs) == right(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	"binary!=" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			// eslint-disable-next-line eqeqeq
			const arg = left(scope, locals, assign, inputs) != right(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	"binary<" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			const arg = left(scope, locals, assign, inputs) < right(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	"binary>" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			const arg = left(scope, locals, assign, inputs) > right(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	"binary<=" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			const arg = left(scope, locals, assign, inputs) <= right(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	"binary>=" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			const arg = left(scope, locals, assign, inputs) >= right(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	"binary&&" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			const arg = left(scope, locals, assign, inputs) && right(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	"binary||" (left, right, context) {
		return function (scope, locals, assign, inputs) {
			const arg = left(scope, locals, assign, inputs) || right(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	"ternary?:" (test, consequent, alternate, context) {
		return function (scope, locals, assign, inputs) {
			const arg = test(scope, locals, assign, inputs)
				? consequent(scope, locals, assign, inputs)
				: alternate(scope, locals, assign, inputs)
			return context ? { value: arg } : arg
		}
	}

	value (value, context) {
		return function () {
			return context
				? { context: undefined, name: undefined, value: value }
				: value
		}
	}

	identifier (name, context, create) {
		return function (scope, locals, assign, inputs) {
			const base = locals && name in locals ? locals : scope
			if (create && create !== 1 && base && base[name] == null) {
				base[name] = {}
			}
			const value = base ? base[name] : undefined
			if (context) {
				return { context: base, name: name, value: value }
			} else {
				return value
			}
		}
	}

	computedMember (left, right, context, create) {
		return function (scope, locals, assign, inputs) {
			const lhs = left(scope, locals, assign, inputs)
			let rhs
			let value
			if (lhs != null) {
				rhs = right(scope, locals, assign, inputs)
				rhs = getStringValue(rhs)
				if (create && create !== 1) {
					if (lhs && !lhs[rhs]) {
						lhs[rhs] = {}
					}
				}
				value = lhs[rhs]
			}
			if (context) {
				return { context: lhs, name: rhs, value: value }
			} else {
				return value
			}
		}
	}

	nonComputedMember (left, right, context, create) {
		return function (scope, locals, assign, inputs) {
			const lhs = left(scope, locals, assign, inputs)
			if (create && create !== 1) {
				if (lhs && lhs[right] == null) {
					lhs[right] = {}
				}
			}
			const value = lhs != null ? lhs[right] : undefined
			if (context) {
				return { context: lhs, name: right, value: value }
			} else {
				return value
			}
		}
	}

	inputs (input, watchId) {
		return function (scope, value, locals, inputs) {
			if (inputs) return inputs[watchId]
			return input(scope, value, locals)
		}
	}
}
