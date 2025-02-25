import { isConstant, isDefined, isLiteral, isTruthy, isString, isNumber, getStringValue, ifDefined, plusFn, findConstantExpressions, noop } from "./utils.mjs";
import { useScope, isScope, ExternalFile } from "./scope.mjs"
import { AST } from "./ast.mjs";
import { GetFilter } from "./index.mjs"
import { DataAggregator } from './dataaggregator.mjs'
import { v4 as uuidv4 } from 'uuid'

export class DataExtractor {
  constructor (externals = null) {
    this.filters = GetFilter
    this.externals = externals || [] // queue of ALL externals encountered in the extraction or its parents
    this.requires = [] // externals on which this extraction depends (directly)
    this.missing = {}
    this.errors = []
    this.data = new DataAggregator()
  }

  assembleData (ast, scope) {
    let evaluator = this.compile(ast)
    evaluator(useScope(scope))
    delete this.data.stack
    const wrapper = new ExternalFile(null, this.data)
    if (this.requires.length > 0) {
      wrapper.requires = this.requires.map(e => e.id)
    }
    return wrapper
  }

  compile (ast) {
    const self = this
    if (ast) {
      findConstantExpressions(ast, self.filters)
    }
    let fn = self.recurse(ast)
    fn.ast = ast
    if (ast) {
      fn.literal = isLiteral(ast)
      fn.constant = isConstant(ast)
    }
    return fn
  }

  recurse (ast, wantScope) {
    if (!ast) return noop
    const self = this
    let key, expr, left, right, args, expression
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
        return noop
      case AST.ContentField:
        expr = AST.serialize(ast.expression)
        key = ast.key || expr
        right = this.recurse(ast.expression)
        return function content_field (scope) {
          self._setContent(key, right(scope), expr, ast.expression)
        }
      case AST.ConditionalField:
        expr = AST.serialize(ast.test)
        key = ast.key ? ast.key + 'b' : expr + '_BOOL'
        expression = this.recurse(ast.test)
        left = this.recurse(ast.consequent)
        right = ast.alternate && this.recurse(ast.alternate)
        return function conditional_field (scope, assign, inputs) {
          const testValue = expression(scope, assign, inputs)
          if (self._setCondition(key, testValue)) {
            left(scope, assign, inputs)
          } else if (right) {
            right(scope, assign, inputs)
          }
        }
      case AST.ListField:
        expr = AST.serialize(ast.expression)
        expression = this.recurse(ast.expression, true)
        right = this.recurse(ast.content) // in essence a lambda
        return function list_field (scope) {
          const exprListScope = expression(scope)
          const listAtom = ast.key || expr
          self._startList(listAtom)
          if (exprListScope.type === 'array') {
            const itemAtom = ast.key ? ast.key + 'i' : expr + '_ITEM'
            const puncAtom = ast.key ? ast.key + 'p' : expr + '_PUNC'
            exprListScope.forEachScope(itemScope => {
              self._startListItem(itemAtom)
              right.call(undefined, itemScope)
              self._endListItem(puncAtom, itemScope._punc)
            })
          }
          self._endList(listAtom)
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
          return wantScope
            ? c.lookupScope(ast.name, ast.ns)
            : c.lookupValue(ast.name, ast.ns)
        }
      case AST.MemberExpression:
        left = this.recurse(ast.object, true)
        if (ast.computed) {
          right = this.recurse(ast.property)
          return function member_computed (scope, assign, inputs) {
            const lhs = left(scope, assign, inputs)
            const rhs = right(scope, assign, inputs)
            return wantScope
              ? lhs.getOwnScope(rhs)
              : lhs.getOwnValue(rhs)
          }
        } else { // !ast.computed
          const propName = ast.property.name
          return function member_named (scope, assign, inputs) {
            const lhs = left(scope, assign, inputs)
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
        args.push(self.recurse(ast.input, ast.lambda))
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
    }
  }

  _setContent (ident, value, expr, ast) {
    if (value === null || typeof value === 'undefined') {
      this.missing[expr] = true
      value = this._missingValuePlaceholder(expr, ast)
    } else if (typeof value === 'object') {
      if (value instanceof ExternalFile) {
        this.data.set(ident, this._registerExternal(value))
        return
      //} else if (Array.isArray(value) && value.length && value[0] instanceof ExternalFile) {
      //  value.forEach(v => this.data.set())
      } else if (value.errors || value.missing) {
        // value is a yatte EvaluationResult, probably because of nested template evaluation
        if (value.missing && value.missing.length > 0) {
          value.missing.forEach((expr) => { this.missing[expr] = true })
        }
        if (value.errors && value.errors.length > 0) {
          value.errors.forEach((errmsg) => { this.errors.push(errmsg) })
        }
        value = value.valueOf() // get the actual evaluated value
      }
    }
    if (value === '') {
      this.data.set(ident, undefined)
    } else if (typeof value === 'object') { // setContent should only be used to output simple scalar values
      this.data.set(ident, value.toString()) // probably bad input; convert to a string representation
    } else {
      this.data.set(ident, value)
    }
  }

  _lookupExternal (extFile) {
    // see if this externalFile+data has already been encountered/added
    return this.externals.find(ex => ex.isEqualTo(extFile))
  }

  _registerExternal (extFile) {
    // see if this externalFile+data has already been encountered/added
    let existing = this._lookupExternal(extFile)
    if (!existing) {
      extFile.id = uuidv4() // assign unique ID
      this.externals.push(extFile)
      existing = extFile
    }
    if (!this.requires.includes(existing)) {
      this.requires.push(existing)
    }
    return existing
  }

  _setCondition (ident, value) {
    const bValue = isTruthy(value)
    this.data.set(ident, bValue)
    return bValue
  }

  _startList (listIdent) {
    // begin list context:
    this.data.pushList(listIdent)
  }

  _startListItem (itemIdent) {
    // begin child object context -- individual item in a list context
    this.data.pushObject(itemIdent)
  }

  _endListItem (puncIdent, punc) {
    // set the list punctuation
    this._setContent(puncIdent, punc)
    // end object context
    this.data.popObject()
  }

  _endList (listIdent) {
    // end list context:
    this.data.popList()
  }

  _missingValuePlaceholder (expr, ast) {
    if (ast && ast.type === AST.FilterExpression && !ast.lambda) {
      return this._missingValuePlaceholder(AST.serialize(ast.input), ast.input)
    }
    return '[' + expr + ']'
  }
}
