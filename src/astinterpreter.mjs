import { isConstant, isDefined, isLiteral, isString, isNumber, getStringValue, ifDefined, plusFn, assignableAST, isAssignable, getInputs, findConstantExpressions, noop } from "./utils.mjs";
import { useScope } from "./scope.mjs"
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

	recurse (ast, wantScope, create) {
		if (!ast) return noop
		const self = this
		let left, right, args, expression
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
				expression = this.recurse(ast.expression, true)
				right = this.recurse(ast.content) // in essence a lambda
				return function list_field (scope) {
					const exprListScope = expression(scope)
					if (exprListScope && exprListScope.length) {
						const results = []
						exprListScope.forEachScope(enumScope => {
							results.push(right.call(undefined, enumScope))
						})
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
					const c = useScope(scope)
					let value
					if (wantScope || (create && create !== 1)) {
						value = c.lookupScope(ast.name, ast.ns)
						if (create && create !== 1) {
							if (value.isNull() && value._parent) {
								value._parent.setOwnValue(ast.name, {}, ast.ns)
								value = wantScope
								  ? value._parent.getOwnScope(ast.name)
									: value._parent.getOwnValue(ast.name)
							}
						}
					} else {
						value = c.lookupValue(ast.name, ast.ns)
					}
					return value
				}
			case AST.MemberExpression:
				left = this.recurse(ast.object, true, !!create)
				if (ast.computed) {
					right = this.recurse(ast.property)
					return function member_computed (scope, assign, inputs) {
						const lhs = left(scope, assign, inputs)
						const rhs = right(scope, assign, inputs)
						if (create && create !== 1) {
							if (lhs.getOwnValue(rhs) == null) {
								lhs.setOwnValue(rhs, {})
							}
						}
						return wantScope
							? lhs.getOwnScope(rhs)
							: lhs.getOwnValue(rhs)
					}
				} else { // !ast.computed
					const propName = ast.property.name
					return function member_named (scope, assign, inputs) {
						const lhs = left(scope, assign, inputs)
						if (create && create !== 1) { // when create===1 that means we're called by an assignment so no need to create
							if (lhs.getOwnValue(propName) == null) {
								lhs.setOwnValue(propName, {})
							}
						}
						return wantScope
							? lhs.getOwnScope(propName)
							: lhs.getOwnValue(propName)
					}
				}
			case AST.CallExpression:
				args = []
				right = this.recurse(ast.callee, true)
				ast.arguments.forEach(expr => {
					args.push(self.recurse(expr))
				})
				return function call_expr (scope, assign, inputs) {
					const rhs = right(scope, assign, inputs)
					let value
					if (rhs != null) {
						const argValues = args.map(arg => arg(scope, assign, inputs))
						value = rhs.valueOf().apply(rhs._parent.valueOf(), argValues)
					}
					return value
				}
			case AST.FilterExpression:
				right = this.filters(ast.filter.name)
				// Filters are implemented as functions, retrieved from this.filters().
				// These functions expect the first argument to be the INPUT to the filter.
				// ARGUMENTS to the filter (if any) are passed as SUBSEQUENT arguments to this function. 
				args = [] // (for the filter function to be called)
				args.push(self.recurse(ast.input, ast.lambda)) // for list filters, we need the filter input's context!
				ast.arguments.forEach(expr => {
					args.push(self.recurse(expr))
				})
				return function filter_expr (scope, assign, inputs) {
					const argValues = args.map(arg => arg(scope, assign, inputs))
					const value = right.apply(undefined, argValues, inputs) // bug/question (inherited from angular-expressions): does 3rd argument to apply() actually DO anything?  (it's not documented anywhere I have found!)
					return wantScope
						? useScope(scope).pushScope(value)
						: value
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
				left = this.recurse(ast.left, true, 1)
				right = this.recurse(ast.right)
				return function assign_expr (scope, assign, inputs) {
					const lhs = left(scope, assign, inputs) // need to call because this is what actually determines context!
					if (lhs._parent && lhs.name) {
						const rhs = right(scope, assign, inputs)
						lhs._parent.setOwnValue(lhs.name, rhs, ast.ns)
						// todo: shouldn't we be checking contextOut here and returning a scope if requested?
						return lhs._parent.getOwnValue(lhs.name) // should === rhs but just to be sure
					}
				}
			case AST.ArrayExpression:
				args = []
				ast.elements.forEach(expr => {
					args.push(self.recurse(expr))
				})
				return function array_expr (scope, assign, inputs) {
					const value = args.map(arg => arg(scope, assign, inputs))
					return wantScope
					  ? useScope(scope).pushScope(value)
						: value
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
							key: property.key.type === AST.Identifier ? property.key.name : property.key.value + '',
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
					return wantScope
						? scope.pushScope(value)
					 	: value
				}
			case AST.ThisExpression:
				return function this_expr (scope) {
					const c = useScope(scope)
					return wantScope
					  ? c
						: c.valueOf()
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
