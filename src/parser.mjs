import { AST } from "./ast.mjs"
import { Lexer } from './lexer.mjs'
import { isAssignable } from "./utils.mjs";

const defaultParserOptions = {
	includeLocation: false,
	literals: {
		true: true,
		false: false,
		null: null,
		undefined: undefined,
	}
}

export class ExpressionParser {
  constructor (getFilter, parserOptions = {}) {
		this.options = { ...defaultParserOptions }
		if (parserOptions) {
			for (const prop of Object.keys(parserOptions)) {
				this.options[prop] = parserOptions[prop]
			}
		}
    this.lexer = new Lexer()
		this.getFilter = getFilter
    this.selfReferential = {
      this: { type: AST.ThisExpression },
      $locals: { type: AST.ThisExpression } // continue parsing $locals for backcompat with Yatte, but it's same as this
    }
  }

	ast (text) {
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
				expression: this.ternary(),
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
			// A sort key is a normal expression evaluated against each list item.
			// The optional leading sign is the sort-direction marker, so it is
			// consumed separately from the expression itself.
			key: this.expression(),
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
		let filterFunc = this.getFilter(filterIdent.name)
		if (filterFunc) {
			// filterIdent.origName = filterIdent.name // breaks some tests right now, but might be useful?
			filterIdent.name = filterFunc.ident || filterFunc.name // aliases get normalized in AST
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
			while (reparent.arguments[0].expression.rtl && !reparent.endGroup) {
				reparent = reparent.arguments[0].expression
			}
			newNode.input = reparent.arguments[0].expression
			reparent.arguments[0].expression = newNode
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
