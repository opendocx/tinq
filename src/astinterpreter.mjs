import { isConstant, isDefined, isLiteral, isString, isNumber, getStringValue, ifDefined, plusFn, assignableAST, isAssignable, getInputs, findConstantExpressions, noop } from "./utils.mjs";
import { AST } from "./parser.mjs";

export class ASTInterpreter {
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
			findConstantExpressions(ast, self.$filter)
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
			args,
			lambda
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
				right = this.$filter(ast.filter.name)
				args = []
				args.push(self.recurse(ast.input))
				ast.arguments.forEach((expr, idx) => {
					if (ast.listFilter && idx === 0) { // list filter means treat first argument as a lambda!
						if (ast.filter.name === 'sort' && expr.type === AST.UnaryExpression && '+-'.includes(expr.operator)) {
							lambda = self.recurse(expr.argument)
							if (expr.operator === '-') {
								lambda.descending = true
							}
						} else {
							lambda = self.recurse(expr)
						}
						args.push(() => lambda)
					} else {
						args.push(self.recurse(expr))
					}
				})
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
