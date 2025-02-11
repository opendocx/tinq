import { isConstant, isDefined, isLiteral, isString, isNumber, ifDefined, plusFn, assignableAST, isAssignable, getInputs, findConstantExpressions, noop } from "./utils.mjs"
import { useScope } from "./scope.mjs"
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
		let extra = ''
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
				self.recurse(rnode, lid)
				self.return_(lid)
			}
			// let assignable
			// this.stage = "assign"
			// if ((assignable = assignableAST(ast))) {
			// 	this.state.computing = "assign"
			// 	const result = this.nextId()
			// 	this.recurse(assignable, result)
			// 	this.return_(result)
			// 	extra = "fn.assign=" + this.generateFunction("assign", "s,v")
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
			this.recurse(ast, undefined, undefined, (intoId) => {
				this.return_(intoId)
			})
		}
		// The build and minification steps remove the string "use strict" from the code, but this is done using a regex.
		// This is a workaround for this until we do a better job at only removing the prefix only when we should.
		const fns = []
		append(fns, `"${this.USE} ${this.STRICT}"`)
		append(fns, this.filterPrefix())
		append(fns, `var fn=${this.generateFunction("fn", "s,a,i")}`)
		append(fns, extra)
		append(fns, this.watchFns())
		append(fns, 'return fn')
		// eslint-disable-next-line no-new-func
		const fn = new Function(
			'flt',
			'ifd',
			'pls',
			'use',
			fns.join('\n') // last argument to Function() is function body; each prior is an argument name
		)(this.filters, ifDefined, plusFn, useScope)

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
			result.push(`var ${name}=${self.generateFunction(name, 's')}`)
		})
		if (fns.length) {
			result.push(`fn.inputs=[${fns.join(',')}];`)
		}
		return result.join('')
	}

	generateFunction (name, params) {
		return `function(${params}){${this.varsPrefix(name)}${this.funcBody(name)}}`
	}

	filterPrefix () {
		const parts = []
		const self = this
		for (const [filter, id] of Object.entries(this.state.filters)) {
			parts.push(id + '=flt(' + self.escape(filter) + ')')
		}
		if (parts.length) return `var ${parts.join(',')};`
		return ''
	}

	varsPrefix (section) {
		return this.state[section].vars.length
			? `var ${this.state[section].vars.join(',')};`
			: ''
	}

	funcBody (section) {
		return this.state[section].body.join('')
	}

	/**
	 * transpiles the given ast node into JavaScript code that can execute in the browser or NodeJS
	 * 
	 * @param {object} ast node
	 * @param {string} intoId id of the variable (in the target code) in which the result of the current operation should
	 *                        be stored
	 * @param {object?} wantScope if the current operation needs to return a Scope object rather than a regular value
	 * @param {*} returnFn for all expressions and sub-expressions that ultimately compile down to strings (containing
	 *                        JavaScript), this callback (if specified) is invoked as the last thing after that
	 *                        compilation is complete. Not currently called for template & field nodes.
	 * @param {*} create 
	 * @param {*} skipWatchIdCheck 
	 * @returns void. The recurse method alters the state of this ASTCompiler instance, such that after the call to
	 * recurse returns, the generateFunction() method can be used to finish the code generation.
	 */
	recurse (ast, intoId, wantScope, returnFn, create, skipWatchIdCheck) {
		if (!ast) return // any need to call returnFn() here before returning, or will it always already be noop?
		const self = this
		let left, right, args, expression
		returnFn = returnFn || noop
		if (!skipWatchIdCheck && isDefined(ast.watchId)) {
			intoId = intoId || this.nextId()
			this.if_(
				'i',
				this.lazyAssignId(intoId, this.computedMember('i', ast.watchId)),
				this.lazyRecurse(ast, intoId, wantScope, returnFn, create, true)
			)
			return
		}
		switch (ast.type) {
			case AST.Program:
			case AST.TemplateBlock:
				intoId = intoId || this.nextId(false, '[]')
				ast.body.forEach(elem => self.recurse(elem, undefined, undefined, result => {
					this.current().body.push(intoId, '.push(', result, ');')
				}))
				returnFn(this.assignId(intoId, intoId + '.join("")'))
				break
			case AST.TemplateElement:
				returnFn(this.escape(ast.text))
				break
			case AST.ContentField:
				self.recurse(ast.expression, undefined, undefined, result => {
					right = result
				})
				right += '+""' // to string
				returnFn(right)
				break
			case AST.ConditionalField:
				intoId = intoId || this.nextId()
				self.recurse(ast.test, intoId)
				self.if_(
					intoId,
					() => { // consequent can be either a block node or a single
						if (ast.consequent.type === AST.TemplateBlock) {
							self.assignId(intoId, '[]')
							self.recurse(ast.consequent, intoId)
						} else {
							self.recurse(ast.consequent, undefined, undefined, result => {
								self.assignId(intoId, result)
							})
						}
					},
					ast.alternate && (() => { // alternate, if specified, can be either a block node or a single
						if (ast.alternate.type === AST.TemplateBlock) {
							self.assignId(intoId, '[]')
							self.recurse(ast.alternate, intoId)
						} else {
							self.recurse(ast.alternate, undefined, undefined, result => {
								self.assignId(intoId, result)
							})
						}
					}),
				)
				returnFn(intoId)
				break
			case AST.ListField:
				expression = self.nextId() // the list value itself
				self.recurse(ast.expression, expression, true) // get list value
				right = self.assignId(self.nextId(), self.generateFunction(ast.content._lkey, "s")) // list content lambda
				left = self.nextId(false, '') // var to hold result of list concatenation
				self.if_(
					expression + '&&' + expression + '.length',
					() => {
						self.assignId(left, '[]')
						self.forEachScope(expression, left, right)
						self.assignId(left, left + '.join("")')
					}
				)
				returnFn(left)
				break
			case AST.Literal:
				expression = this.escape(ast.value)
				this.assignId(intoId, expression)
				returnFn(intoId || expression)
				break
			case AST.UnaryExpression:
				this.recurse(ast.argument, undefined, undefined, expr => {
					right = expr
				})
				expression = ast.operator + "(" + this.ifDefined(right, 0) + ")" // TODO: I don't think these parens are necessary, are they?
				this.assignId(intoId, expression)
				returnFn(expression)
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
				this.assignId(intoId, expression)
				returnFn(expression)
				break
			case AST.LogicalExpression:
				intoId = intoId || this.nextId()
				self.recurse(ast.left, intoId)
				self.if_(
					ast.operator === "&&" ? intoId : self.not(intoId),
					self.lazyRecurse(ast.right, intoId)
				)
				returnFn(intoId)
				break
			case AST.ConditionalExpression:
				intoId = intoId || this.nextId()
				self.recurse(ast.test, intoId)
				self.if_(
					intoId,
					self.lazyRecurse(ast.consequent, intoId),
					self.lazyRecurse(ast.alternate, intoId),
				)
				returnFn(intoId)
				break
			case AST.Identifier:
				if (self.stage === 'inputs') throw "error: this has been broken for inputs"
				intoId = intoId || self.nextId()
				if (wantScope || (create && create !== 1)) {
					self.assignId(intoId, self.lookupScope(ast.name, ast.ns))
					if (create && create !== 1) {
						self.if_(
							self.and(self.scopeIsNull(intoId), intoId + '._parent'),
							() => {
								self.setOwnValue(intoId + '._parent', ast.name, '{}', ast.ns)
								self.assignId(intoId,
									wantScope
										? self.getOwnScope(intoId + '._parent', ast.name)
										: self.getOwnValue(intoId + '._parent', ast.name)
								)
							}
						)
					}
				} else {
					self.assignId(intoId, self.lookupValue(ast.name, ast.ns))
				}
				returnFn(intoId)
				break
			case AST.MemberExpression:
				left = this.nextId() // object scope will be stored here
				intoId = intoId || this.nextId() // whole member expression will be stored here
				self.recurse(ast.object, left, true, () => {
					if (ast.computed) {
						right = self.nextId()
						self.recurse(ast.property, right)
						if (create && create !== 1) {
							self.if_(
								self.isNull(self.getOwnValueDyn(left, right)),
								() => {
									self.setOwnValueDyn(left, right, '{}', ast.ns)
								},
							)
						}
						self.assignId(intoId, wantScope
							? self.getOwnScopeDyn(left, right)
							: self.getOwnValueDyn(left, right)
						)
					} else { // !ast.computed
						const propName = ast.property.name
						if (create && create !== 1) {
							self.if_(
								self.isNull(self.getOwnValue(left, propName)),
								() => {
									self.setOwnValue(left, propName, '{}')
								},
							)
						}
						self.assignId(intoId, wantScope
							? self.getOwnScope(left, propName)
							: self.getOwnValue(left, propName)
						)
					}
					returnFn(intoId)
				}, !!create)
				break
			case AST.CallExpression:
				intoId = intoId || this.nextId()
				right = self.nextId() // callee value -- the function to be called (ident for globals, member expr for methods)
				args = []
				self.recurse(ast.callee, right, true, function () {
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
							expression = right + '.valueOf().call(' + right + '._parent.valueOf(),'
								+ args.join(',') + ')'
							self.assignId(intoId, expression)
						},
						function () {
							self.assignId(intoId, "undefined")
						}
					)
					returnFn(intoId)
				})
				break
			case AST.FilterExpression:
				intoId = intoId || this.nextId() // holds the final result of the filter
				right = self.filter(ast.filter.name) // holds the filter function (to call)
				args = [] // strings (ids/source code) representing each argument to the filter function
				left = self.nextId() // to hold the evaluated input to the filter
				self.recurse(ast.input, left, ast.lambda) // get the input
				// add the INPUT to the filter function's argument list...
				args.push(left)
				// add the rest of the filter's arguments to the filter function'd argument list
				ast.arguments.forEach(expr => {
					const argId = self.nextId()
					if (expr.type === AST.LambdaExpression || expr.type === AST.SortKeyExpression) {
						self.assignId(argId, self.generateFunction(expr._lkey, "s"))
						if (expr.type === AST.SortKeyExpression && expr.descending) {
							self.assignId(argId + '.descending', 'true') // sets a "descending" property on the sort key lambda function
						}
					} else {
						self.recurse(expr, argId)
					}
					args.push(argId)
				})
				// call the filter function, passing in the arguments assembled above
				expression = `${right}.call(undefined,${args.join(',')})`
				self.assignId(intoId, wantScope
					? self.pushScope(expression)
					: expression
				)
				returnFn(intoId)
				break
			case AST.LambdaExpression:
			case AST.SortKeyExpression:
				// currently no-op; already handled earlier in lambda pass
				break
			case AST.AssignmentExpression:
				left = this.nextId()
				right = this.nextId()
				this.recurse(ast.left, left, true, () => {
					self.if_(
						self.and(left + '._parent', left + '.name'),
						() => {
							self.recurse(ast.right, right)
							self.setOwnValueDyn(left + '._parent', left + '.name', right, ast.ns)
							self.assignId(intoId, self.getOwnValueDyn(left + '._parent', left + '.name'))
						}
					)
					returnFn(intoId || right)
				}, 1)
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
				expression = '[' + args.join(',') + ']'
				if (wantScope) {
					expression = this.pushScope(expression)
				}
				this.assignId(intoId, expression)
				returnFn(intoId || expression)
				break
			case AST.ObjectExpression:
				args = []
				if (ast.properties.some(property => property.computed)) {
					intoId = intoId || this.nextId()
					this.assignId(intoId, "{}")
					ast.properties.forEach(property => {
						if (property.computed) {
							left = self.nextId()
							self.recurse(property.key, left)
						} else {
							left = property.key.type === AST.Identifier ? property.key.name : property.key.value + ''
						}
						right = self.nextId()
						self.recurse(property.value, right)
						self.assignId(self.member(intoId, left, property.computed), right)
					})
				} else {
					ast.properties.forEach(property => {
						self.recurse(
							property.value,
							ast.constant ? undefined : self.nextId(),
							undefined,
							function (expr) {
								args.push(
									self.escape(property.key.type === AST.Identifier ? property.key.name : property.key.value + '')
									  + ":" + expr
								)
							}
						)
					})
					expression = "{" + args.join(",") + "}"
					if (wantScope) {
						expression = this.pushScope(expression)
					}
					this.assignId(intoId, expression)
				}
				returnFn(intoId || expression)
				break
			case AST.ThisExpression:
				this.useScope()
				expression = wantScope
					? 'c'
					: 'c.valueOf()'
				this.assignId(intoId, expression)
				returnFn(intoId || expression)
				break
			case AST.NGValueParameter:
				this.assignId(intoId, "v")
				returnFn(intoId || "v")
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

	useScope () {
		const own = this.current().own
		if (!own.hasOwnProperty('_scope_')) {
			this.current().vars.push('c=use(s)')
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
	assignId (id, value) {
		if (!id) return
		this.current().body.push(id, "=", value, ";")
		return id
	}

	pushElement (id, value) {
		if (!id) return
		this.current().body.push(id, ".push(", value, ");")
	}

	pushScope (expression) {
		this.useScope()
		return 'c.pushScope(' + expression + ')'
	}

	lookupScope (name, ns) {
		this.useScope()
		return 'c.lookupScope("' + name + (ns ? '","' + ns : '') + '")'
	}

	lookupValue (name, ns) {
		this.useScope()
		return 'c.lookupValue("' + name + (ns ? '","' + ns : '') + '")'
	}

	getOwnScope (scopeId, name) {
		return this.getOwnScopeDyn(scopeId, '"' + name + '"')
	}

	getOwnScopeDyn (scopeId, id) {
		this.useScope()
		return scopeId + '.getOwnScope(' + id + ')'
	}

	forEachScope (scopeId, accumulatorId, lambdaId) {
		this.useScope()
		const result = scopeId + '.forEachScope(es=>'
			+ accumulatorId + '.push(' + lambdaId + '.call(undefined,es)))'
		this.current().body.push(result, ';')
	}

	hasOwnValue (scopeId, name) {
		return this.hasOwnValueDyn(scopeId, '"' + name + '"')
	}

	hasOwnValueDyn (scopeId, id) {
		this.useScope()
		return scopeId + '.hasOwnValue(' + id + ')'
	}

	getOwnValue (scopeId, name) {
		return this.getOwnValueDyn(scopeId, '"' + name + '"')
	}

	getOwnValueDyn (scopeId, id) {
		this.useScope()
		return scopeId + '.getOwnValue(' + id + ')'
	}

	setOwnValue (scopeId, name, value, ns) {
		return this.setOwnValueDyn(scopeId, '"' + name + '"', value, ns)
	}

	setOwnValueDyn (scopeId, id, value, ns) {
		this.useScope()
		this.current().body.push( // whoever actually pushes a command onto body is responsible for the ';':
			scopeId + '.setOwnValue(' + id + ',' + value + (ns ? ',"' + ns + '"' : '') + ');'
		)
	}

	isArray (id) {
		return 'Array.isArray(' + id + ')'
	}

	isNumber (id) {
		return '!isNaN(' + id + ')'
	}

	filter (filterName) {
		if (!this.state.filters.hasOwnProperty(filterName)) {
			this.state.filters[filterName] = this.nextId(true)
		}
		return this.state.filters[filterName]
	}

	ifDefined (id, defaultValue) {
		return 'ifd(' + id + ',' + this.escape(defaultValue) + ')'
	}

	plus (left, right) {
		return 'pls(' + left + ',' + right + ')'
	}

	return_ (id) {
		this.current().body.push('return ', id, ';')
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
	lazyRecurse (ast, intoId, wantScope, returnFn, create, skipWatchIdCheck) {
		const self = this
		return function () {
			self.recurse(ast, intoId, wantScope, returnFn, create, skipWatchIdCheck)
		}
	}

	lazyAssignId (id, value) {
		const self = this;
		return function () {
			self.assignId(id, value)
		}
	}

	not (expression) {
		return "!(" + expression + ")"
	}

	and (left, right, needParens = false) {
		return needParens
		  ? `(${left})&&(${right})`
		  : left + "&&" + right
	}

	scopeIsNull (scopeId) {
		return scopeId + '.isNull()'
	}

	isNull (expression) {
		return expression + "==null"
	}

	notNull (expression) {
		return expression + "!=null"
	}

	member (left, right, computed) {
		if (computed) return this.computedMember(left, right)
		return this.nonComputedMember(left, right)
	}

	computedMember (left, right) {
		return left + "[" + right + "]"
	}

	nonComputedMember (left, right) {
		const SAFE_IDENTIFIER = /^[$_a-zA-Z][$_a-zA-Z0-9]*$/
		const UNSAFE_CHARACTERS = /[^$_a-zA-Z0-9]/g
		let expr = ''
		if (SAFE_IDENTIFIER.test(right)) {
			expr = left + "." + right
		} else {
			right = right.replace(UNSAFE_CHARACTERS, this.stringEscapeFn)
			expr = left + '["' + right + '"]'
		}
		return expr
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
		const id = 'v' + this.state.nextId++
		if (!skip) {
			this.current().vars.push(id + (init ? '=' + init : ''))
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
