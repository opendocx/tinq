import { isConstant, isDefined, isLiteral, isString, isNumber, getStringValue, ifDefined, plusFn, assignableAST, isAssignable, getInputs, findConstantExpressions, noop } from "./utils.mjs"
import { pushScope } from "./scope.mjs"
import { AST } from "./ast.mjs";

export class ASTCompiler {
  constructor (filters) {
    this.filters = filters
    this.USE = "use"
    this.STRICT = "strict"
    this.stringEscapeRegex = /[^ a-zA-Z0-9]/g
  }

	compile (ast) {
		const self = this
		this.state = {
			nextId: 0,
			filters: {},
			fn: { vars: [], body: [], own: {} },
			assign: { vars: [], body: [], own: {} },
			inputs: []
		}
		let extra = ""
		if (ast) {
			findConstantExpressions(ast, self.filters)
			this.stage = "lambdas"
			let index = 0
			for (const lnode of FindLambdas(ast)) {
				const lkey = 'lambda' + ++index
				lnode._lkey = lkey
				self.state[lkey] = { vars: [], body: [], own: {} }
				self.state.computing = lkey
				// pre-processing for each lambda
				let rnode, init
				if (lnode.type === AST.SortKeyExpression) rnode = lnode.key
				else if (lnode.type === AST.LambdaExpression) rnode = lnode.expression
				else { // it's a content block inside a list field
					rnode = lnode
					init = '[]'
				}
				const lid = self.nextId(false, init)
				const cinfo = {}
				self.recurse(rnode, lid, cinfo)
				lnode._ckey = cinfo.context
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
			const intoId = this.nextId(false, ast.type === AST.Program ? '[]' : undefined)
			this.recurse(ast, intoId)
			this.return_(ast.type === AST.Program ? intoId + '.join("")' : intoId)
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
			"flt",
			"gsv",
			"ifd",
			"pls",
			"ps",
			fns.join('\n') // last argument to Function() is function body; each prior is an argument name
		)(this.filters, getStringValue, ifDefined, plusFn, pushScope)

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
		const fns = this.state.inputs // currently always empty because inputs stage & watch finding is commented out
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
			parts.push(id + "=flt(" + self.escape(filter) + ")")
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

	/**
	 * transpiles the given ast node into JavaScript code that can execute in the browser or NodeJS
	 * 
	 * @param {object} ast node
	 * @param {string} intoId id of the variable (in the target code) in which the result of the current operation should
	 *                        be stored
	 * @param {object?} nameInfo if the current operation needs to return contextual (scope) information, nameInfo will
	 *                           be an object through which that contextual information can flow back up the call stack.
	 * @param {*} recursionFn for all expressions and sub-expressions that ultimately compile down to strings (containing
	 *                        JavaScript), this callback (if specified) is invoked as the last thing after that
	 *                        compilation is complete. Not currently called for template & field nodes.
	 * @param {*} create 
	 * @param {*} skipWatchIdCheck 
	 * @returns void. The recurse method alters the state of this ASTCompiler instance, such that after the call to
	 * recurse returns, the generateFunction() method can be used to finish the code generation.
	 */
	recurse (ast, intoId, nameInfo, recursionFn, create, skipWatchIdCheck) {
		if (!ast) return
		const self = this
		let left, right, args, obj, expression
		recursionFn = recursionFn || noop
		if (!skipWatchIdCheck && isDefined(ast.watchId)) {
			intoId = intoId || this.nextId()
			this.if_(
				"i",
				this.lazySetValue(intoId, this.computedMember("i", ast.watchId)),
				this.lazyRecurse(ast, intoId, nameInfo, recursionFn, create, true)
			)
			return
		}
		switch (ast.type) {
			case AST.Program:
			case AST.TemplateBlock:
				requireBlock(intoId)
				ast.body.forEach(elem => self.recurse(elem, intoId))
				break
			case AST.TemplateElement:
				self.pushElement(intoId, this.escape(ast.text))
				break
			case AST.ContentField:
				self.recurse(ast.expression, undefined, undefined, expr => right = expr)
				self.pushElement(intoId, right)
				break
			case AST.ConditionalField:
				requireBlock(intoId)
				expression = this.nextId() // right == var to hold test result
				self.recurse(ast.test, expression)
				self.if_(
					expression,
					self.lazyRecurse(ast.consequent, intoId),
					ast.alternate && self.lazyRecurse(ast.alternate, intoId),
				)
				break
			case AST.ListField:
				requireBlock(intoId)
				expression = self.nextId() // the list value itself
				obj = {} // to receive the list value's context info
				self.recurse(ast.expression, expression, obj) // get list value
				right = self.setValue(self.nextId(), self.generateFunction(ast.content._lkey, "s,l")) // list content lambda
				self.if_(
					expression + '&&' + expression + '.length',
					() => self.pushForEach(expression, right, obj.context, intoId)
				)
				break
			case AST.Literal:
				expression = this.escape(ast.value)
				this.setValue(intoId, expression)
				recursionFn(intoId || expression)
				break
			case AST.UnaryExpression:
				this.recurse(ast.argument, undefined, undefined, expr => right = expr)
				expression = ast.operator + "(" + this.ifDefined(right, 0) + ")" // TODO: I don't think these parens are necessary, are they?
				this.setValue(intoId, expression)
				recursionFn(expression)
				break
			case AST.BinaryExpression:
				this.recurse(ast.left, undefined, undefined, expr => left = expr)
				this.recurse(ast.right, undefined, undefined, expr => right = expr)
				if (ast.operator === "+") {
					expression = this.plus(left, right)
				} else if (ast.operator === "-") {
					expression = this.ifDefined(left, 0) + ast.operator + this.ifDefined(right, 0)
				} else {
					expression = "(" + left + ")" + ast.operator + "(" + right + ")" // todo: use OOP to determine when parens are needed
				}
				this.setValue(intoId, expression)
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
				intoId = intoId || self.nextId()
				if (nameInfo) {
					left = self.setValue(self.nextId(), self.getScopeOf(ast.name, ast.ns))
					nameInfo.context = self.stage === "inputs" ? "??" : left
					nameInfo.computed = false
					nameInfo.name = ast.name
					self.setValue(intoId, self.getOwnValue(left, ast.name))
				} else {
					self.setValue(intoId, self.getValue(ast.name, ast.ns))
				}
				recursionFn(intoId)
				break
			case AST.MemberExpression:
				left = this.nextId() // object will be stored here
				intoId = intoId || this.nextId() // whole member expression will be stored here
				obj = {} // we also want context info for the object 
				self.recurse(
					ast.object,
					left,
					obj,
					function () {
						let member = null
						if (ast.computed) {
							right = self.nextId()
							member = self.computedMember(left, right)
						} else {
							right = ast.property.name
							member = self.nonComputedMember(left, right)
						}
						self.if_(
							self.notNull(left),
							function () {
								if (nameInfo) {
									if (obj.context) {
										nameInfo.context = self.setValue(self.nextId(), `${obj.context}.po(${left})`)
									} else {
										nameInfo.context = left
									}
								}
								if (ast.computed) {
									self.recurse(ast.property, right)
									self.setStringValue(right)
									if (create && create !== 1) {
										self.if_(self.not(member), self.lazySetValue(member, "{}"))
									}
									self.setValue(intoId, member)
									if (nameInfo) {
										nameInfo.computed = true
										nameInfo.name = right
									}
								} else {
									if (create && create !== 1) {
										self.if_(
											self.isNull(member),
											self.lazySetValue(member, "{}")
										)
									}
									self.setValue(intoId, member)
									if (nameInfo) {
										nameInfo.computed = false
										nameInfo.name = ast.property.name
									}
								}
							},
							function () {
								self.setValue(intoId, "undefined")
							}
						)
						recursionFn(intoId)
					},
					!!create
				)
				break
			case AST.CallExpression:
				intoId = intoId || this.nextId()
				right = self.nextId() // callee value
				obj = {} // callee contextual info
				args = []
				self.recurse(ast.callee, right, obj, function () {
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
							if (obj.name) {
								expression =
									self.member(obj.context, obj.name, obj.computed) +
									"(" + args.join(",") + ")"
							} else {
								expression = right + "(" + args.join(",") + ")"
							}
							self.setValue(intoId, expression)
						},
						function () {
							self.setValue(intoId, "undefined")
						}
					)
					recursionFn(intoId)
				})
				break
			case AST.FilterExpression:
				intoId = intoId || this.nextId()
				right = self.filter(ast.filter.name)
				args = []
				obj = ast.lambda ? {} : undefined
				left = self.nextId()
				self.recurse(ast.input, left, obj)
				args.push(left)
				if (ast.lambda) {
					args.push(obj.context || 'undefined')
				}
				ast.arguments.forEach(expr => {
					const argId = self.nextId()
					if (expr.type === AST.LambdaExpression || expr.type === AST.SortKeyExpression) {
						self.setValue(argId, self.generateFunction(expr._lkey, "s,l"))
						if (expr.type === AST.SortKeyExpression && expr.descending) {
							self.setValue(argId + '.descending', 'true') // sets a "descending" property on the sort key lambda function
						}
					} else {
						self.recurse(expr, argId)
					}
					args.push(argId)
				})
				// call the filter function, passing in the arguments assembled above
				expression = `${right}.call(undefined,${args.join(',')})`
				self.setValue(intoId, expression)
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
								self.setValue(intoId, expression)
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
				this.setValue(intoId, expression)
				recursionFn(intoId || expression)
				break
			case AST.ObjectExpression:
				args = []
				if (ast.properties.some(property => property.computed)) {
					intoId = intoId || this.nextId()
					this.setValue(intoId, "{}")
					ast.properties.forEach(property => {
						if (property.computed) {
							left = self.nextId()
							self.recurse(property.key, left)
						} else {
							left = property.key.type === AST.Identifier ? property.key.name : "" + property.key.value
						}
						right = self.nextId()
						self.recurse(property.value, right)
						self.setValue(self.member(intoId, left, property.computed), right)
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
					this.setValue(intoId, expression)
				}
				recursionFn(intoId || expression)
				break
			case AST.ThisExpression:
			case AST.LocalsExpression:
				this.useScope()
				this.setValue(intoId, "c.go()")
				if (nameInfo) {
					nameInfo.context = this.setValue(this.nextId(), "c._parent")
					nameInfo.value = intoId
				}
				recursionFn(intoId || "c.go()")
				break
			case AST.NGValueParameter:
				this.setValue(intoId, "v")
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

	useScope (args = "s,l") {
		const own = this.current().own
		if (!own.hasOwnProperty('_scope_')) {
			this.current().vars.push(`c=ps(${args})`)
			own['_scope_'] = 'c'
		}
	}

	/**
	 * If a destination variable id is provided, assigns value to that variable id and returns
	 * the variable id. If no destination variable is provided, ignores the value and returns
	 * falsy.
	 * @param {string?} id the runtime identifier that will be assigned to value
	 * @param {string} value raw string that will be assigned to id
	 * @returns {string?} which identifier the value was stored to, if any
	 */
	setValue (id, value) {
		if (!id) return
		this.current().body.push(id, "=", value, ";")
		return id
	}

	pushElement (id, value) {
		if (!id) return
		this.current().body.push(id, ".push(", value, ");")
	}

	getValue (ident, ns) {
		this.useScope()
		return 'c.gv("' + ident + (ns ? '","' + ns : '') + '")'
	}

	getScopeOf (ident, ns) {
		this.useScope()
		return 'c.gs("' + ident + (ns ? '","' + ns : '') + '")'
	}

	getOwnValue (scope, ident) {
		this.useScope()
		return scope + '.go("' + ident + '")'
	}

	hasOwnValue (scope, ident) {
		this.useScope()
		return scope + '.ho("' + ident + '")'
	}

	filter (filterName) {
		if (!this.state.filters.hasOwnProperty(filterName)) {
			this.state.filters[filterName] = this.nextId(true)
		}
		return this.state.filters[filterName]
	}

	ifDefined (id, defaultValue) {
		return "ifd(" + id + "," + this.escape(defaultValue) + ")"
	}

	plus (left, right) {
		return "pls(" + left + "," + right + ")"
	}

	return_ (id) {
		this.current().body.push("return ", id, ";")
	}

	// if test === true AT COMPILE TIME, we will execute consequentFn and ignore alternateFn.
	// Otherwise it devolves into a test performed at runtime, where if test evaluates to truthy
	// consequentFn will be executed, otherwise (if specified) alternateFn will be executed.
	if_ (test, consequentFn, alternateFn) {
		if (test === true) {
			consequentFn()
		} else {
			const body = this.current().body
			body.push("if(", test, "){")
			consequentFn()
			body.push("}")
			if (alternateFn) {
				body.push("else{")
				alternateFn()
				body.push("}")
			}
		}
	}

	// "lazy" functions are just conveniences to curry calls to recurse and setValue,
	// used only in conjunction with _if() (which expects curried functions for its
	// consequentFn and alternateFn parameters).
	lazyRecurse (ast, intoId, nameId, recursionFn, create, skipWatchIdCheck) {
		const self = this
		return function () {
			self.recurse(ast, intoId, nameId, recursionFn, create, skipWatchIdCheck)
		}
	}

	lazySetValue (id, value) {
		const self = this;
		return function () {
			self.setValue(id, value)
		}
	}

	pushForEach (listId, lambdaId, baseId, intoId) {
		const self = this
		const body = self.current().body
		body.push(`${listId}.forEach((e,i)=>{`)
		body.push(`const flds=${lambdaId}.apply(undefined,[ps(${baseId},e,i,${listId}.length,${listId}.punc)]);`)
		self.pushElement(intoId, '...flds')
		body.push('});')
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

	setStringValue (item) {
		this.setValue(item, "gsv(" + item + ")")
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

function requireBlock(id) {
	if (!id)
		throw new Error('NOT YOUR FAULT, but blocks require a pre-existing array into which content will be pushed')
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
    case AST.ConditionalField:
			yield * FindLambdas(ast.test)
			yield * FindLambdas(ast.consequent)
			if (ast.alternate) yield * FindLambdas(ast.alternate)
			break
    case AST.ListField:
			yield * FindLambdas(ast.expression)
			yield * FindLambdas(ast.content)
			yield ast.content // list block (but not other blocks!) treated as a lambda by the compiler
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
