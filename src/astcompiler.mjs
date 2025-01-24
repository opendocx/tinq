import { isConstant, isDefined, isLiteral, isString, isNumber, getStringValue, ifDefined, plusFn, assignableAST, isAssignable, getInputs, findConstantExpressions, noop } from "./utils.mjs";
import { AST } from "./ast.mjs";

export class ASTCompiler {
  constructor (astBuilder, $filter) {
    this.astBuilder = astBuilder
    this.$filter = $filter
    this.USE = "use"
    this.STRICT = "strict"
    this.stringEscapeRegex = /[^ a-zA-Z0-9]/g
  }

	compile (expression) {
		const self = this
		const ast = this.astBuilder.ast(expression)
		this.state = {
			nextId: 0,
			filters: {},
			fn: { vars: [], body: [], own: {} },
			assign: { vars: [], body: [], own: {} },
			inputs: []
		}
		let extra = ""
		if (ast) {
			findConstantExpressions(ast, self.$filter)
			this.stage = "lambdas"
			let l = 0
			for (const lnode of FindLambdas(ast)) {
				const lkey = 'lambda' + ++l
				lnode._lkey = lkey
				self.state[lkey] = { vars: [], body: [], own: {} }
				self.state.computing = lkey
				const lid = self.nextId()
				self.recurse(lnode.type === AST.SortKeyExpression ? lnode.key : lnode.expression, lid)
				self.return_(lid)
			}
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
				this.recurse({ type: AST.Program, body: [{ type: AST.ContentField, expression: ast }] })
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
			lambda,
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
					if (expr.type === AST.LambdaExpression || expr.type === AST.SortKeyExpression) {
						self.assign(argument, self.generateFunction(expr._lkey, "s,l"))
						if (expr.type === AST.SortKeyExpression && expr.descending) {
							self.assign(argument + '.descending', 'true')
						}
					} else {
						self.recurse(expr, argument)
					}
					args.push(argument)
				})
				// expression = right + "(" + args.join(",") + ")" // original
				expression = right + ".call(" + right + "," + args.join(",") + ")" // current in angular-expressions
				// or should the above also work with undefined passed as first arg into .call()?
				self.assign(intoId, expression)
				recursionFn(intoId)
				break
			case AST.LambdaExpression:
			case AST.SortKeyExpression:
				// currently no-op; already handled earlier in lambda pass
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

function append(builder, str) {
	if (str) {
		builder.push(str)
	}
}

function * FindLambdas (ast) {
  switch (ast.type) {
		case AST.Identifier:
		case AST.Literal:
		case AST.ThisExpression:
		case AST.LocalsExpression:
		case AST.NoOp:
			break
    case AST.Program:
		case AST.TemplateBlock:
			for (const elem of ast.body) yield * FindLambdas(elem)
		  break
    case AST.ContentField:
			yield * FindLambdas(ast.expression)
			break
    case AST.ConditionalBlock:
			yield * FindLambdas(ast.test)
			yield * FindLambdas(ast.consequent)
			if (ast.alternate) yield * FindLambdas(ast.alternate)
			break
    case AST.ListBlock:
			yield * FindLambdas(ast.expression)
			for (const elem of ast.body) yield * FindLambdas(elem)
			break
    case AST.MemberExpression:
			yield * FindLambdas(ast.object)
			yield * FindLambdas(ast.property)
      break
    case AST.CallExpression:
			yield * FindLambdas(ast.callee)
			for (const argument of ast.arguments) yield * FindLambdas(argument)
			break
    case AST.FilterExpression:
			yield * FindLambdas(ast.input)
			for (const argument of ast.arguments) yield * FindLambdas(argument)
			break
		case AST.LambdaExpression:
			yield * FindLambdas(ast.expression)
			yield ast
			break
		case AST.SortKeyExpression:
			yield * FindLambdas(ast.key)
			yield ast
			break
    case AST.ArrayExpression:
			for (const elem of ast.elements) yield * FindLambdas(elem)
			break
    case AST.ObjectExpression:
			for (const prop of ast.properties) yield * FindLambdas(prop)
			break
    case AST.Property:
			yield * FindLambdas(ast.value)
			break
    case AST.BinaryExpression:
    case AST.LogicalExpression:
			yield * FindLambdas(ast.left)
			yield * FindLambdas(ast.right)
			break
    case AST.UnaryExpression:
			yield * FindLambdas(ast.argument)
			break
    case AST.ConditionalExpression:
			yield * FindLambdas(ast.test)
			yield * FindLambdas(ast.consequent)
			yield * FindLambdas(ast.alternate)
			break
  }
	return
}
