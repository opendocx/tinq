import { isConstant, isDefined, isLiteral, isString, isNumber, getStringValue, ifDefined, plusFn, assignableAST, isAssignable, getInputs, findConstantExpressions, noop } from "./utils.mjs";
import { pushScope } from "./scope.mjs"
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
		// 	fn = function (scope, locals) {
		// 		let results = expressions.map(exp => exp(scope, locals))
		// 		return results.join()
		// 	}
		// } else { // it's just an expression AST, so compile the expression
		// 	fn = self.recurse(ast)
		// }
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
		if (!ast) return noop
		const self = this
		let left,
			right,
			args,
			expression
		// if (ast.winput) {
		// 	return this.inputs(ast.winput, ast.watchId)
		// }
		switch (ast.type) {
			case AST.Program:
			case AST.TemplateBlock:
				args = ast.body.map(elem => self.recurse(elem))
				return this.templateBlock(args)
			case AST.TemplateElement:
				return () => ast.text //this.staticText(ast.text)
			case AST.ContentField:
				return this.contentField(this.recurse(ast.expression))
			case AST.ConditionalField:
			case AST.ConditionalExpression:
				expression = this.recurse(ast.test)
				left = this.recurse(ast.consequent)
				right = ast.alternate && this.recurse(ast.alternate)
				return function conditional_ (scope, locals, assign, inputs) {
					const value = expression(scope, locals, assign, inputs)
						? left(scope, locals, assign, inputs)
						: (right ? right(scope, locals, assign, inputs) : '')
					return context ? { value: value } : value
				}
			case AST.ListField:
				expression = this.recurse(ast.expression, true)
				right = this.recurse(ast.content) // in essence a lambda
				return function listfield_ (scope, locals) {
					const list = expression(scope, locals)
					if (list.value && list.value.length) {
						const c = pushScope(list.context)
						const results = list.value.map(
							(item, index) => right.apply(undefined, [
								c.pi(item, index, list.value.length, list.value.punc)
							])
						)
						return results.join('')
					}
					return ''
				}
			case AST.Literal:
				return this.value(ast.value, context)
			case AST.UnaryExpression:
				right = this.recurse(ast.argument)
				return this["unary" + ast.operator](right, context)
			case AST.BinaryExpression:
			case AST.LogicalExpression:
				left = this.recurse(ast.left)
				right = this.recurse(ast.right)
				return this["binary" + ast.operator](left, right, context)
			case AST.Identifier:
				return function identifier_ (scope, locals, assign, inputs) {
					const c = pushScope(scope, locals)
					let base, value
					if (context || (create && create !== 1)) {
						base = c.gs(ast.name, ast.ns)
						value = base.go(ast.name)
					} else {
						value = c.gv(ast.name, ast.ns)
					}
					if (create && create !== 1 && base && base.go(ast.name) == null) {
						base.sv(ast.name, {}, ast.ns)
					}
					if (context) {
						return { context: base, name: ast.name, value: value }
					} else {
						return value
					}
				}
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
				right = this.recurse(ast.callee, true) // context==true means we are returned both the value (the
					// ...function to be called) AND its context (the object ON WHICH that function should be called).
					// Knackly uses this ALL THE TIME, whenever (e.g.) someone calls prototype methods on text strings, numbers, etc.
					// This is so the function can ultimately be invoked with "this" referring to the right thing
					// (see `rhs.value.apply(rhs.context, values)` below)
				return function call_ (scope, locals, assign, inputs) {
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
				right = this.filters(ast.filter.name)
				args = [] // for regular filters, input is first arg, then any other filter args
				args.push(self.recurse(ast.input, ast.lambda))
				ast.arguments.forEach(expr => {
					args.push(self.recurse(expr))
				})
				return function filter_ (scope, locals, assign, inputs) {
					const argValues = []
					for (let i = 0; i < args.length; ++i) {
						const result = args[i](scope, locals, assign, inputs)
						if (i === 0 && ast.lambda && result.context) {
							argValues.push(result.value)
							argValues.push(result.context)
						} else {
							argValues.push(result)
						}
					}
					const value = right.apply(undefined, argValues, inputs) // bug/question (inherited from angular-expressions): does 3rd argument to apply() actually DO anything?  (it's not documented anywhere I have found!)
					return context
						? { context: ast.lambda ? argValues[1] : pushScope(scope), name: undefined, value: value }
						: value
				}
			case AST.LambdaExpression:
				right = self.recurse(ast.expression)
				return function lambda_ () { return right }
			case AST.SortKeyExpression:
				right = self.recurse(ast.key)
				if (ast.descending) {
					right.descending = true
				}
				return function sortkey_ () { return right }
			case AST.AssignmentExpression:
				left = this.recurse(ast.left, true, 1) // context==true means we are returned both the value (the
				// ...value that is being re-assigned) AND its context (the object ON WHICH that value exists)
				// This is so the value reassignment can happen on the correct object
				// (see `lhs.context[lhs.name] = rhs` below)
				right = this.recurse(ast.right)
				return function assign_ (scope, locals, assign, inputs) {
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
				return function array_ (scope, locals, assign, inputs) {
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
				return function object_ (scope, locals, assign, inputs) {
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
			case AST.LocalsExpression:
				return function this_ (scope, locals) {
					const c = pushScope(scope, locals)
					return context ? { value: c.go(), context: c._parent } : c.go()
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

	conditional (test, consequent, alternate, context) {
		return function (scope, locals, assign, inputs) {
			const arg = test(scope, locals, assign, inputs)
				? consequent(scope, locals, assign, inputs)
				: (alternate ? alternate(scope, locals, assign, inputs) : '')
			return context ? { value: arg } : arg
		}
	}

	// staticText (text) {
	// 	return function () {
	// 		return text
	// 	}
	// }

	contentField (argument) {
		return function (scope, locals) {
			let arg = argument(scope, locals)
			if (typeof arg !== 'string') {
				arg = arg + ""
			}
			return arg
		}
	}

	templateBlock(fns) {
		return function (scope, locals) {
			let results = fns.map(fn => fn(scope, locals))
			return results.join('')
		}
	}

	value (value, context) {
		return function () {
			return context
				? { context: undefined, name: undefined, value: value }
				: value
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

	// inputs (input, watchId) {
	// 	return function (scope, value, locals, inputs) {
	// 		if (inputs) return inputs[watchId]
	// 		return input(scope, value, locals)
	// 	}
	// }
}
