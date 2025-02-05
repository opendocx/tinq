import { isConstant, isDefined, isLiteral, isString, isNumber, getStringValue, ifDefined, plusFn, assignableAST, isAssignable, getInputs, findConstantExpressions, noop } from "./utils.mjs";
import { pushScope, isScope } from "./scope.mjs"
import { AST } from "./ast.mjs";

export class ASTInterpreter {
	constructor (filters) {
		this.filters = filters
	}

	compile (ast) {
		const self = this
		if (ast) {
			findConstantExpressions(ast, self.filters)
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
		let fn = self.recurse(ast)
		// if (!ast || (ast.type === AST.Program && !ast.body.length)) { // special case
		// 	fn = noop
		// } else if (ast.type === AST.Program) { // it's a template AST, so compile the template
		// 	const expressions = []
		// 	ast.body.forEach(elem => {
		// 		expressions.push(elem.type === AST.TemplateElement ? elem : self.recurse(elem.expression))
		// 	})
		// 	fn = function (scope) {
		// 		let results = expressions.map(exp => exp(scope))
		// 		return results.join()
		// 	}
		// } else { // it's just an expression AST, so compile the expression
		// 	fn = self.recurse(ast)
		// }
		// if (assign) {
		// 	fn.assign = function (scope, value) {
		// 		return assign(scope, value)
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

	recurse (ast, contextOut, create) {
		if (!ast) return noop
		const self = this
		let left, right, args, obj, expression
		// if (ast.winput) {
		// 	return this.inputs(ast.winput, ast.watchId)
		// }
		switch (ast.type) {
			case AST.Program:
			case AST.TemplateBlock:
				args = ast.body.map(elem => self.recurse(elem))
				return function template_block (scope) {
					return args
						.map(fn => fn(scope))
						.join('')
				}
			case AST.TemplateElement:
				return () => ast.text //this.staticText(ast.text)
			case AST.ContentField:
				right = this.recurse(ast.expression)
				return function content_field (scope) {
					return right(scope) + ""
				}
			case AST.ConditionalField:
				expression = this.recurse(ast.test)
				left = this.recurse(ast.consequent)
				right = ast.alternate && this.recurse(ast.alternate)
				return function conditional_field (scope, assign, inputs) {
					const value = expression(scope, assign, inputs)
						? left(scope, assign, inputs)
						: (right ? right(scope, assign, inputs) : '')
					return value
				}
			case AST.ListField:
				obj = {}
				expression = this.recurse(ast.expression, obj)
				right = this.recurse(ast.content) // in essence a lambda
				return function list_field (scope) {
					const exprListValue = expression(scope)
					if (exprListValue && exprListValue.length) {
						const results = exprListValue.map(
							(item, index) => right.call(undefined,
								obj.context.ps(item, index, exprListValue.length, exprListValue.punc)
							)
						)
						return results.join('')
					}
					return ''
				}
			case AST.Literal:
				return () => ast.value
			case AST.UnaryExpression:
				right = this.recurse(ast.argument)
				return function unary_op (scope, assign, inputs) {
					let result = right(scope, assign, inputs)
					if (ast.operator === '!') return !result
					if (isDefined(result)) return ast.operator === '-' ? -result : +result
					return 0
				}
			case AST.BinaryExpression:
				left = this.recurse(ast.left)
				right = this.recurse(ast.right)
				return function binary_op (scope, assign, inputs) {
					const lhs = left(scope, assign, inputs)
					const rhs = right(scope, assign, inputs)
					switch (ast.operator) {
						case '+': return plusFn(lhs, rhs)
						case '-': return (isDefined(lhs) ? lhs : 0) - (isDefined(rhs) ? rhs : 0)
						case '*': return lhs * rhs
						case '/': return lhs / rhs
						case '%': return lhs % rhs
						case '===': return lhs === rhs
						case '!==': return lhs !== rhs
						case '==': return lhs == rhs
						case '!=': return lhs != rhs
						case '<': return lhs < rhs
						case '>': return lhs > rhs
						case '<=': return lhs <= rhs
						case '>=': return lhs >= rhs
					}
				}
			case AST.LogicalExpression:
				left = this.recurse(ast.left)
				right = this.recurse(ast.right)
				return function logical_op (scope, assign, inputs) {
					const lhs = left(scope, assign, inputs)
					switch (ast.operator) {
						case '&&': return lhs && right(scope, assign, inputs)
						case '||': return lhs || right(scope, assign, inputs)
					}
				}
			case AST.ConditionalExpression:
				expression = this.recurse(ast.test)
				left = this.recurse(ast.consequent)
				right = this.recurse(ast.alternate)
				return function ternary_op (scope, assign, inputs) {
					return expression(scope, assign, inputs)
						? left(scope, assign, inputs)
						: right(scope, assign, inputs)
				}
			case AST.Identifier:
				if (self.stage === 'inputs') throw "error: this has been broken for inputs"
				return function identifier_ (scope, assign, inputs) {
					const c = pushScope(scope)
					let base, value
					if (contextOut || (create && create !== 1)) {
						base = c.lookupScope(ast.name, ast.ns)
						if (create && create !== 1
							&& base.getOwnVal(ast.name) == null
						) {
							base.setOwnVal(ast.name, {}, ast.ns)
						}
						value = base.getOwnVal(ast.name)
					} else {
						value = c.lookupVal(ast.name, ast.ns)
					}
					if (contextOut) {
						contextOut.context = base
						contextOut.name = ast.name
					}
					return value
				}
			case AST.MemberExpression:
				obj = {} // we need context info for the object
				left = this.recurse(ast.object, obj, !!create)
				if (ast.computed) {
					right = this.recurse(ast.property)
					return function member_computed (scope, assign, inputs) {
						const lhs = left(scope, assign, inputs)
						let rhs, value
						if (lhs) {
							rhs = right(scope, assign, inputs)
							rhs = getStringValue(rhs)
							if (contextOut) {
								contextOut.context = obj.context
								contextOut.name = rhs
								contextOut.computed = true
							}
							if (isScope(lhs)) {
								value = lhs.getOwnVal(rhs)
								if (create && create !== 1) {
									if (!value) {
										lhs.setOwnVal(rhs, {})
										value = lhs.getOwnVal(rhs)
									}
								}
								if (contextOut) {
									contextOut.object = value
								}
							} else { // should be primitive or array
								value = lhs[rhs]
								if (create && create !== 1) {
									if (!value) {
										value = lhs.value[rhs] = {}
									}
								}
								if (contextOut) {
									contextOut.object = lhs
									if (Array.isArray(lhs) && !isNaN(rhs)) { // numeric index into array
										value = pushScope(obj.context).ps(value, rhs, lhs.length, lhs.punc) // avoid losing scope chain
									}
								}
							}
						}
						return value
					}
				} else { // !ast.computed
					const propName = ast.property.name
					return function member_named (scope, assign, inputs) {
						const lhs = left(scope, assign, inputs)
						if (!obj.context) throw "what to do?" // maybe base = pushScope(lhs)??
						// handle special case for _parent identifier, whose value is already a scope!
						const base = obj.name === '_parent' ? lhs : obj.context.ps(lhs)
						if (create && create !== 1) { // when create===1 that means we're called by an assignment so no need to create
							if (base.getOwnVal(propName) == null) {
								base.setOwnVal(propName, {})
							}
						}
						const value = base.getOwnVal(propName)
						if (contextOut) {
							contextOut.object = lhs //?  this should not be a context, so do we need to call getOwnVal()??
							contextOut.context = base
							contextOut.computed = false
							contextOut.name = propName
						}
						return value
					}
				}
			case AST.CallExpression:
				obj = {} // callee contextual info
				args = []
				right = this.recurse(ast.callee, obj) // 2nd arg=={} means we are requesting the result's context
					// as well as its value. If the result is a function to be called, its context is the object ON WHICH
					// that function should be called)... and Knackly uses this ALL THE TIME, whenever (e.g.)
					// someone calls prototype methods on text strings, numbers, etc.
					// This is so the function can ultimately be invoked with "this" referring to the right thing
					// (see `rhs.value.apply(rhs.context, values)` below)
				ast.arguments.forEach(expr => {
					args.push(self.recurse(expr))
				})
				return function call_expr (scope, assign, inputs) {
					const rhs = right(scope, assign, inputs)
					let value
					if (rhs != null) {
						const argValues = args.map(arg => arg(scope, assign, inputs))
						value = rhs.apply(obj.context.valueOf(), argValues)
					}
					return value
				}
			case AST.FilterExpression:
				right = this.filters(ast.filter.name)
				// Filters are implemented as functions, retrieved from this.filters().
				// These functions expect the first argument to be the INPUT to the filter.
				// ARGUMENTS to the filter (if any) are passed as SUBSEQUENT arguments to this function. 
				args = [] // (for the filter function to be called)
				obj = ast.lambda ? {} : undefined // for list filters, we need the filter input's context!
				args.push(self.recurse(ast.input, obj))
				ast.arguments.forEach(expr => {
					args.push(self.recurse(expr))
				})
				return function filter_expr (scope, assign, inputs) {
					const argValues = []
					args.forEach((arg, i) => {
						const result = arg(scope, assign, inputs)
						argValues.push(result)
						if (i === 0 && obj) { // list filter functions get the parent context as the 2nd argument!
							argValues.push(obj.context || pushScope(null)) // must have a context, even if null
						}
					})
					const value = right.apply(undefined, argValues, inputs) // bug/question (inherited from angular-expressions): does 3rd argument to apply() actually DO anything?  (it's not documented anywhere I have found!)
					if (contextOut) {
						contextOut.context = pushScope(scope)
					}
					return value
				}
			case AST.LambdaExpression:
				right = self.recurse(ast.expression)
				return function lambda_expr () { return right }
			case AST.SortKeyExpression:
				right = self.recurse(ast.key)
				if (ast.descending) {
					right.descending = true
				}
				return function sort_key () { return right }
			case AST.AssignmentExpression:
				obj = {}
				left = this.recurse(ast.left, obj, 1) // 2nd arg=={} means we are requesting both the value (the
				// ...value that is being re-assigned) AND its context (the object ON WHICH that value exists)
				// This is so the value reassignment can happen on the correct object
				// (see `lhs.context[lhs.name] = rhs` below)
				right = this.recurse(ast.right)
				return function assign_expr (scope, assign, inputs) {
					left(scope, assign, inputs) // need to call because this is what actually populates obj!
					const rhs = right(scope, assign, inputs)
					obj.context.setOwnVal(obj.name, rhs, ast.ns)
					return obj.context.getOwnVal(obj.name) // should === rhs but just to be sure
				}
			case AST.ArrayExpression:
				args = []
				ast.elements.forEach(expr => {
					args.push(self.recurse(expr))
				})
				return function array_expr (scope, assign, inputs) {
					return args.map(arg => arg(scope, assign, inputs))
				}
			case AST.ObjectExpression:
				args = []
				ast.properties.forEach(property => {
					if (property.computed) {
						args.push({
							key: self.recurse(property.key),
							computed: true,
							value: self.recurse(property.value),
						})
					} else {
						args.push({
							key: property.key.type === AST.Identifier ? property.key.name : "" + property.key.value,
							computed: false,
							value: self.recurse(property.value),
						})
					}
				})
				return function object_expr (scope, assign, inputs) {
					const value = {}
					for (const arg of args) {
						if (arg.computed) {
							value[arg.key(scope, assign, inputs)] = arg.value(scope, assign, inputs)
						} else {
							value[arg.key] = arg.value(scope, assign, inputs)
						}
					}
					return value
				}
			case AST.ThisExpression:
				return function this_expr (scope) {
					const c = pushScope(scope)
					if (contextOut) {
						contextOut.context = c._parent
					}
					return c.getOwnVal()
				}
			case AST.NGValueParameter:
				return function (scope, assign) {
					return assign
				}
		}
	}

	// inputs (input, watchId) {
	// 	return function (scope, value, inputs) {
	// 		if (inputs) return inputs[watchId]
	// 		return input(scope, value)
	// 	}
	// }
}
