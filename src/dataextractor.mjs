import { isConstant, isDefined, isLiteral, isTruthy, isString, isNumber, getStringValue, ifDefined, plusFn, findConstantExpressions, noop } from "./utils.mjs";
import { useScope, isScope, ExternalBinary } from "./scope.mjs"
import { AST } from "./ast.mjs";
import { GetFilter } from "./index.mjs"
import { DataAggregator } from './dataaggregator.mjs'
import { v4 as uuidv4 } from 'uuid'

export class DataExtractor {
  constructor () {
    this.filters = GetFilter
    this.indirects = []
    this.missing = {}
    this.errors = []
    this.data = new DataAggregator()
  }

  assembleData (ast, scope) {
    let evaluator = this.compile(ast)
    evaluator(useScope(scope))
    return this.data
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

  recurse (ast, contextOut) {
    if (!ast) return noop
    const self = this
    let key, expr, left, right, args, obj, expression
    switch (ast.type) {
      case AST.Program:
      case AST.TemplateBlock:
        args = ast.body.map(elem => self.recurse(elem))
        return function template_block (scope) {
          return args
            .map(fn => fn(scope))
            .join('')
        }
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
        obj = {}
        expression = this.recurse(ast.expression, obj)
        right = this.recurse(ast.content) // in essence a lambda
        return function list_field (scope) {
          const exprListValue = expression(scope)
          const listAtom = ast.key || expr
          self._startList(listAtom)
          if (exprListValue) {
            const itemAtom = ast.key ? ast.key + 'i' : expr + '_ITEM'
            const puncAtom = ast.key ? ast.key + 'p' : expr + '_PUNC'
            exprListValue.forEach((item, index) => {
              const itemScope = obj.context.ps(item, index, exprListValue.length, exprListValue.punc)
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
          let base, value
          if (contextOut) {
            base = c.lookupScope(ast.name, ast.ns)
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
        left = this.recurse(ast.object, obj)
        if (ast.computed) {
          right = this.recurse(ast.property)
          return function member_computed (scope, assign, inputs) {
            const lhs = left(scope, assign, inputs)
            let value
            let rhs = right(scope, assign, inputs)
            rhs = getStringValue(rhs)
            if (contextOut) {
              contextOut.context = obj.context
              contextOut.name = rhs
              contextOut.computed = true
            }
            if (isScope(lhs)) {
              value = lhs.getOwnVal(rhs)
              if (contextOut) {
                contextOut.object = value
              }
            } else { // should be primitive or array
              value = lhs && lhs[rhs]
              if (contextOut) {
                contextOut.object = isScope(lhs) ? lhs.getOwnVal() : lhs
                if (!isNaN(rhs)) { // numeric index into array; avoid losing scope chain!
                  if (Array.isArray(lhs)) {
                    value = useScope(obj.context).ps(value, rhs, lhs.length, lhs.punc)
                  } else {
                    value = useScope(obj.context).ps(value, rhs, 0)
                  }
                }
              }
            }
            return value
          }
        } else { // !ast.computed
          const propName = ast.property.name
          return function member_named (scope, assign, inputs) {
            const lhs = left(scope, assign, inputs) // alert: lhs can be a Scope IF left is a computed member expression!
            if (!obj.context) throw "what to do?" // maybe base = pushScope(lhs)??
            // handle special case for _parent identifier, whose value is already a scope!
            const base = obj.name === '_parent' ? lhs : obj.context.ps(lhs)
            const value = base.getOwnVal(propName)
            if (contextOut) {
              contextOut.object = isScope(lhs) ? lhs.getOwnVal() : lhs // contextOut.object should not be a Scope
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
              argValues.push(obj.context || useScope(null)) // must have a context, even if null
            }
          })
          const value = right.apply(undefined, argValues, inputs) // bug/question (inherited from angular-expressions): does 3rd argument to apply() actually DO anything?  (it's not documented anywhere I have found!)
          if (contextOut) {
            contextOut.context = useScope(scope)
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
          const c = useScope(scope)
          if (contextOut) {
            contextOut.context = c._parent
          }
          return c.getOwnVal()
        }
    }
  }

  _setContent (ident, value, expr, ast) {
    if (value === null || typeof value === 'undefined') {
      this.missing[expr] = true
      value = this._missingValuePlaceholder(expr, ast)
    } else if (typeof value === 'object') {
      if (value instanceof ExternalBinary) {
        this.data.set(ident, this._indirectLookup(value))
        return
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

  _indirectLookup (indirObj) {
    // see if this indirect has already been encountered/added
    let indirect = this.indirects.find(ex => ex.isEqualTo(indirObj))
    if (!indirect) {
      indirect = new ExternalBinary(indirObj) // { ...indirObj, id: uuidv4() }
      indirect.id = uuidv4()
      this.indirects.push(indirect)
    }
    return indirect
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
