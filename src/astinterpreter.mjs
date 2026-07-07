import { isConstant, isDefined, isLiteral, plusFn, findConstantExpressions, noop } from "./utils.mjs";
import { GetFilter } from "./index.mjs"
import { useScope } from "./scope.mjs"
import { AST } from "./ast.mjs";

export class ASTInterpreterBase {
  constructor () {
    this.filters = GetFilter
  }

  compile (ast) {
    const self = this
    if (ast) {
      findConstantExpressions(ast, this.filters)
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
    let fn = this.recurse(ast)
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
    let left, right, args, expression, key
    // if (ast.winput) {
    // 	return this.inputs(ast.winput, ast.watchId)
    // }
    switch (ast.type) {
      case AST.Program:
      case AST.TemplateBlock:
        args = ast.body.map(elem => self.recurse(elem))
        return function template_block (scope, env, assign, inputs) {
          return self.templateBlock(args, scope, env, assign, inputs)
        }
      case AST.TemplateElement:
        return () => self.templateElement(ast.text)
      case AST.ContentField:
        key = this.fieldKey(ast)
        right = this.recurse(ast.expression)
        return function content_field (scope, env, assign, inputs) {
          return self.contentField(right, scope, key, ast.expression, env, assign, inputs)
        }
      case AST.ConditionalField:
        key = this.fieldKey(ast, 'b')
        expression = this.recurse(ast.test)
        left = this.recurse(ast.consequent)
        right = ast.alternate && this.recurse(ast.alternate)
        return function conditional_field (scope, env, assign, inputs) {
          return self.conditionalField(expression, left, right, scope, key, env, assign, inputs)
        }
      case AST.ListField:
        key = this.fieldKey(ast, 'i')
        expression = this.recurse(ast.expression, true)
        right = this.recurse(ast.content)
        return function list_field (scope, env, assign, inputs) {
          return self.listField(expression, right, scope, key, env, assign, inputs, ast.frame)
        }
      case AST.Literal:
        return () => ast.value
      case AST.UnaryExpression:
        right = this.recurse(ast.argument)
        return function unary_op (scope, env, assign, inputs) {
          let result = right(scope, env, assign, inputs)
          if (ast.operator === '!') return !result
          if (isDefined(result)) return ast.operator === '-' ? -result : +result
          return 0
        }
      case AST.BinaryExpression:
        left = this.recurse(ast.left)
        right = this.recurse(ast.right)
        return function binary_op (scope, env, assign, inputs) {
          const lhs = left(scope, env, assign, inputs)
          const rhs = right(scope, env, assign, inputs)
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
        return function logical_op (scope, env, assign, inputs) {
          const lhs = left(scope, env, assign, inputs)
          switch (ast.operator) {
            case '&&': return lhs && right(scope, env, assign, inputs)
            case '||': return lhs || right(scope, env, assign, inputs)
          }
        }
      case AST.ConditionalExpression:
        expression = this.recurse(ast.test)
        left = this.recurse(ast.consequent)
        right = this.recurse(ast.alternate)
        return function ternary_op (scope, env, assign, inputs) {
          return expression(scope, env, assign, inputs)
            ? left(scope, env, assign, inputs)
            : right(scope, env, assign, inputs)
        }
      case AST.Identifier:
        if (self.stage === 'inputs') throw "error: this has been broken for inputs"
        return function identifier_ (scope, env, assign, inputs) {
          if (isFrameIdentifier(ast.name)) {
            return wantScope || (create && create !== 1)
              ? useScope(env && env[ast.name])
              : env && env[ast.name]
          }
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
          return function member_computed (scope, env, assign, inputs) {
            const lhs = left(scope, env, assign, inputs)
            const rhs = right(scope, env, assign, inputs)
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
          return function member_named (scope, env, assign, inputs) {
            const lhs = left(scope, env, assign, inputs)
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
        right = this.recurse(ast.callee, true) // request scope because we need BOTH the callee function AND the object/context on which it is called, if any. (see .valueOf() and ._parent.valueOf() below)
        ast.arguments.forEach(expr => {
          args.push(self.recurse(expr))
        })
        return function call_expr (scope, env, assign, inputs) {
          const rhs = right(scope, env, assign, inputs)
          let value
          if (rhs != null) {
            const argValues = args.map(arg => arg(scope, env, assign, inputs))
            value = rhs.valueOf().apply(rhs._parent.valueOf(), argValues)
          }
          return wantScope
            ? useScope(scope).pushScope(value)
            : value
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
        return function filter_expr (scope, env, assign, inputs) {
          const argValues = args.map(arg => arg(scope, env, assign, inputs))
          const value = right.apply(undefined, argValues, inputs) // bug/question (inherited from angular-expressions): does 3rd argument to apply() actually DO anything?  (it's not documented anywhere I have found!)
          return wantScope
            ? useScope(scope).pushScope(value)
            : value
        }
      case AST.LambdaExpression:
        right = self.recurse(ast.expression)
        return function lambda_expr (scope, env, assign, inputs) {
          return function lambda_bound (lambdaScope) {
            return right(lambdaScope, extendEnv(env, ast.frame, lambdaScope), assign, inputs)
          }
        }
      case AST.SortKeyExpression:
        right = self.recurse(ast.key)
        return function sort_key (scope, env, assign, inputs) {
          const wrapped = function sort_key_bound (lambdaScope) {
            return right(lambdaScope, extendEnv(env, ast.frame, lambdaScope), assign, inputs)
          }
          if (ast.descending) {
            wrapped.descending = true
          }
          return wrapped
        }
      case AST.AssignmentExpression:
        left = this.recurse(ast.left, true, 1)
        right = this.recurse(ast.right)
        return function assign_expr (scope, env, assign, inputs) {
          const lhs = left(scope, env, assign, inputs) // need to call because this is what actually determines context!
          if (lhs._parent && lhs.name) {
            const rhs = right(scope, env, assign, inputs)
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
        return function array_expr (scope, env, assign, inputs) {
          const value = args.map(arg => arg(scope, env, assign, inputs))
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
        return function object_expr (scope, env, assign, inputs) {
          const value = {}
          for (const arg of args) {
            if (arg.computed) {
              value[arg.key(scope, env, assign, inputs)] = arg.value(scope, env, assign, inputs)
            } else {
              value[arg.key] = arg.value(scope, env, assign, inputs)
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
        return function (scope, env, assign) {
          return assign
        }
    }
  }

  fieldKey (ast, suffix) {}

  templateBlock (elemFns, scope, env, assign, inputs) {
    return elemFns.map(fn => fn(scope, env, assign, inputs))
  }

  templateElement (text) {
    return text
  }

  contentField (valueFn, scope, key, ast, env, assign, inputs) {
    return valueFn(scope, env, assign, inputs)
  }

  conditionalField (testFn, consequentFn, alternateFn, scope, key, env, assign, inputs) {
    if (testFn(scope, env, assign, inputs)) {
      return consequentFn(scope, env, assign, inputs)
    } else if (alternateFn) {
      return alternateFn(scope, env, assign, inputs)
    }
  }

  listField (listFn, lambdaContentFn, scope, key, env, assign, inputs, frameName) {
    const listValue = listFn(scope, env, assign, inputs)
    if (listValue && listValue.length) {
      const results = []
      listValue.forEachScope(enumScope => {
        results.push(lambdaContentFn.call(undefined, enumScope, extendEnv(env, frameName, enumScope), assign, inputs))
      })
      return results
    }
  }

  // inputs (input, watchId) {
  // 	return function (scope, env, value, inputs) {
  // 		if (inputs) return inputs[watchId]
  // 		return input(scope, env, value)
  // 	}
  // }
}

function isFrameIdentifier (name) {
  return typeof name === 'string' && name.startsWith('$')
}

function extendEnv (env, frameName, scope) {
  if (!frameName) return env
  return Object.assign({}, env, { [frameName]: useScope(scope).valueOf() })
}

export class ASTInterpreter extends ASTInterpreterBase {
  // just a few function overrides to ensure text templates are composited correctly:

  templateBlock (elemFns, scope, env, assign, inputs) {
    return super.templateBlock(elemFns, scope, env, assign, inputs).join('')
  }

	contentField (valueFn, scope, key, ast, env, assign, inputs) {
		return super.contentField(valueFn, scope, key, ast, env, assign, inputs) + '' // convert to string
	}

	listField (listFn, lambdaContentFn, scope, key, env, assign, inputs, frameName) {
    return super.listField(listFn, lambdaContentFn, scope, key, env, assign, inputs, frameName).join('')
	}
}
