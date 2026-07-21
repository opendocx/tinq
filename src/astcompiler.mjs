import { isConstant, isDefined, isLiteral, isString, isNumber, ifDefined as ifd, plusFn as pls, assignableAST, isAssignable, getInputs, findConstantExpressions, noop } from "./utils.mjs"
import { useScope as use } from "./scope.mjs"
import { AST } from "./ast.mjs";

const stringEscapeRegex = /[^ a-zA-Z0-9]/g
const USE = "use"
const STRICT = "strict"

export class ASTCompiler {
  constructor (filters) {
    this.filters = filters
  }

  compile (ast) {
    this.state = {
      nextId: 0,
      filters: {},
      fn: { vars: [], body: [], own: {} },
      assign: { vars: [], body: [], own: {} },
      inputs: []
    }
    let extra = ''
    if (ast) {
      findConstantExpressions(ast, this.filters)
      this.stage = "lambdas"
      let index = 0
      for (const lnode of FindLambdas(ast)) {
        const lkey = 'lambda' + ++index
        lnode._lkey = lkey
        this.state[lkey] = { vars: [], body: [], own: {} }
        this.state.computing = lkey
        // pre-processing for each lambda
        let rnode, init
        if (lnode.type === AST.SortKeyExpression) rnode = lnode.key
        else if (lnode.type === AST.LambdaExpression) rnode = lnode.expression
        else { // it's a content block inside a list field
          rnode = lnode
          init = '[]'
        }
        const lid = this.nextId(false, init)
        this.recurse(rnode, lid)
        this.return_(lid)
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
    append(fns, `"${USE} ${STRICT}"`)
    append(fns, this.filterPrefix())
    append(fns, `var fn=${this.generateFunction("fn", "s,e,a,i")}`)
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
    )(this.filters, ifd, pls, use)

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
      result.push(`var ${name}=${self.generateFunction(name, 's,e,a,i')}`)
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
    for (const [filter, id] of Object.entries(this.state.filters)) {
      parts.push(id + '=flt(' + escape(filter) + ')')
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
  recurse (ast, intoId, wantScope, returnFn, ckPrefix, create, skipWatchIdCheck) {
    if (!ast) return // any need to call returnFn() here before returning, or will it always already be noop?
    const self = this
    let left, right, args, expression, key
    returnFn = returnFn || noop
    if (!skipWatchIdCheck && isDefined(ast.watchId)) {
      intoId = intoId || this.nextId()
      this.if_(
        'i',
        this.lazyAssignId(intoId, computedMember('i', ast.watchId)),
        this.lazyRecurse(ast, intoId, wantScope, returnFn, create, true)
      )
      return
    }
    switch (ast.type) {
      case AST.Program:
      case AST.TemplateBlock:
        intoId = intoId || this.nextId(false, '[]')
        ast.body.forEach(elem => self.recurse(elem, undefined, undefined, result => {
          self.pushElement(intoId, result)
        }))
        returnFn(this.assignId(intoId, intoId + '.join("")'))
        break
      case AST.TemplateElement:
        returnFn(escape(ast.text))
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
        self.recurse(ast.test, intoId, undefined, undefined, 'bool')
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
        expression = this.nextId() // the list value itself
        this.recurse(ast.expression, expression, true) // get list value
        right = this.assignId(this.nextId(), this.generateFunction(ast.content._lkey, 's,e,a,i')) // list content lambda
        left = this.nextId(false, '') // var to hold result of list concatenation
        this.if_(
          expression + '&&' + expression + '.length',
          () => {
            self.assignId(left, '[]')
            self.forEachScope(expression, left, right, ast.frame)
            self.assignId(left, left + '.join("")')
          }
        )
        returnFn(left)
        break
      case AST.Literal:
        expression = escape(ast.value)
        this.assignId(intoId, expression)
        returnFn(intoId || expression)
        break
      case AST.UnaryExpression:
        this.recurse(ast.argument, undefined, undefined, expr => {
          right = expr
        })
        expression = ast.operator + '(' + if_Defined(right, 0) + ')' // TODO: use precedence to determine whether parens are needed
        this.assignId(intoId, expression)
        returnFn(expression)
        break
      case AST.BinaryExpression:
        this.recurse(ast.left, undefined, undefined, expr => left = expr)
        this.recurse(ast.right, undefined, undefined, expr => right = expr)
        if (ast.operator === '+') {
          expression = plus_(left, right)
        } else if (ast.operator === '-') {
          expression = if_Defined(left, 0) + ast.operator + if_Defined(right, 0)
        } else {
          expression = '(' + left + ')' + ast.operator + '(' + right + ')' // todo: use precedence to determine when parens are needed
        }
        this.assignId(intoId, expression)
        returnFn(expression)
        break
      case AST.LogicalExpression:
        intoId = intoId || this.nextId()
        this.recurse(ast.left, intoId)
        this.if_(
          ast.operator === '&&' ? intoId : not_(intoId),
          this.lazyRecurse(ast.right, intoId)
        )
        returnFn(intoId)
        break
      case AST.ConditionalExpression:
        intoId = intoId || this.nextId()
        this.recurse(ast.test, intoId)
        this.if_(
          intoId,
          this.lazyRecurse(ast.consequent, intoId),
          this.lazyRecurse(ast.alternate, intoId),
        )
        returnFn(intoId)
        break
      case AST.Identifier:
        if (this.stage === 'inputs') throw 'error: this has been broken for inputs'
        // get cache key for identifier (incl. whether wantScope is true/false), see if there's an existing id for it, and only create a new one if not
        key = getCacheKey(ast, wantScope, ckPrefix)
        if (this.getCacheId(key)) {
          if (intoId) {
            this.assignId(intoId, this.getCacheId(key))
          } else {
            intoId = this.getCacheId(key)
          }
        } else {
          intoId = intoId || this.nextId()
          if (isFrameIdentifier(ast.name)) {
            this.assignId(intoId, wantScope || (create && create !== 1)
              ? this.externalFrameScope(ast.name)
              : this.externalFrameValue(ast.name)
            )
          } else if (wantScope || (create && create !== 1)) {
            this.assignId(intoId, this.lookupScope(ast.name, ast.ns))
            if (create && create !== 1) {
              this.if_(
                and_(scopeIsNull(intoId), getParentScope(intoId)),
                () => {
                  self.setOwnValue(getParentScope(intoId), ast.name, '{}', ast.ns)
                  self.assignId(intoId,
                    wantScope
                      ? getOwnScope(getParentScope(intoId), ast.name)
                      : getOwnValue(getParentScope(intoId), ast.name)
                  )
                }
              )
            }
          } else {
            this.assignId(intoId, self.lookupValue(ast.name, ast.ns))
          }
          this.setCacheId(key, intoId)
        }
        returnFn(intoId)
        break
      case AST.MemberExpression:
        // get cache key for entire member expression (incl. whether wantScope is true/false), see if there's an existing id for it, and only create a new one if not
        key = getCacheKey(ast, wantScope, ckPrefix)
        if (this.getCacheId(key)) {
          if (intoId) {
            this.assignId(intoId, this.getCacheId(key))
          } else {
            intoId = this.getCacheId(key)
          }
        } else {
          intoId = intoId || this.nextId() // whole member expression will be stored here
          // once the object (left) side is handled (see below), this will handle the property (right) side:
          const memberContinuation = () => {
            if (ast.computed) {
              right = self.nextId()
              self.recurse(ast.property, right)
              if (create && create !== 1) {
                self.if_(
                  isNull(getOwnValueDyn(left, right)),
                  () => {
                    self.setOwnValueDyn(left, right, '{}', ast.ns)
                  },
                )
              }
              self.assignId(intoId, wantScope
                ? getOwnScopeDyn(left, right)
                : getOwnValueDyn(left, right)
              )
            } else { // !ast.computed
              const propName = ast.property.name
              if (create && create !== 1) {
                self.if_(
                  isNull(getOwnValue(left, propName)),
                  () => {
                    self.setOwnValue(left, propName, '{}')
                  },
                )
              }
              self.assignId(intoId, wantScope
                ? getOwnScope(left, propName)
                : getOwnValue(left, propName)
              )
            }
            self.setCacheId(key, intoId)
            returnFn(intoId)
          }
          // handle left side, THEN invoke right side handler
          left = getCacheKey(ast.object, true)
          if (this.getCacheId(left)) {
            left = this.getCacheId(left)
            memberContinuation()
          } else {
            left = this.nextId() // object scope will be stored here
            this.recurse(ast.object, left, true, memberContinuation, undefined, !!create)
          }
        }
        break
      case AST.CallExpression:
        intoId = intoId || this.nextId()
        right = self.nextId() // callee value -- the function to be called (ident for globals, member expr for methods)
        args = []
        self.recurse(ast.callee, right, true, function () {
          self.if_(
            notNull(right),
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
              expression = right + '.valueOf().call(' + getParentScope(right) + '.valueOf(),'
                + args.join(',') + ')'
              self.assignId(intoId, wantScope
                ? self.pushScope(expression)
                : expression
              )
            },
            function () {
              self.assignId(intoId, wantScope
                ? self.pushScope('null')
                : 'undefined'
              )
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
            self.assignId(argId, self.bindEnv(self.generateFunction(expr._lkey, 's,e,a,i'), expr.frame))
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
            and_(getParentScope(left), left + '.name'),
            () => {
              self.recurse(ast.right, right)
              self.setOwnValueDyn(getParentScope(left), left + '.name', right, ast.ns)
              self.assignId(intoId, getOwnValueDyn(getParentScope(left), left + '.name'))
            }
          )
          returnFn(intoId || right)
        }, undefined, 1)
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
          this.assignId(intoId, '{}')
          ast.properties.forEach(property => {
            if (property.computed) {
              left = self.nextId()
              self.recurse(property.key, left)
            } else {
              left = property.key.type === AST.Identifier ? property.key.name : property.key.value + ''
            }
            right = self.nextId()
            self.recurse(property.value, right)
            self.assignId(member(intoId, left, property.computed), right)
          })
        } else {
          ast.properties.forEach(property => {
            self.recurse(
              property.value,
              ast.constant ? undefined : self.nextId(),
              undefined,
              function (expr) {
                args.push(
                  escape(property.key.type === AST.Identifier ? property.key.name : property.key.value + '')
                    + ':' + expr
                )
              }
            )
          })
          expression = '{' + args.join(',') + '}'
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
        this.assignId(intoId, 'v')
        returnFn(intoId || 'v')
        break
    }
  }

  // getHasOwnProperty (element, property) {
  // 	const key = element + "." + property
  // 	const own = this.current().own
  // 	if (!own.hasOwnProperty(key)) {
  // 		own[key] = this.nextId(
  // 			false,
  // 			element + "&&(" + escape(property) + " in " + element + ")"
  // 		)
  // 	}
  // 	return own[key]
  // }

  hasCachedExpr (cacheKey) {
    return this.current().own.hasOwnProperty(cacheKey)
  }

  getCacheId (cacheKey) {
    const own = this.current().own
    return own[cacheKey]
  }

  setCacheId (cacheKey, id) {
    const own = this.current().own
    if (own[cacheKey]) throw new Error('cache key already has value set')
    own[cacheKey] = id
  }

  useScope () {
    const own = this.current().own
    if (!own.hasOwnProperty('_scope_')) {
      this.current().vars.unshift('c=use(s)')
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
    this.current().body.push(id, '=', value, ';')
    return id
  }

  pushElement (id, value) {
    if (!id) return
    this.current().body.push(id, '.push(', value, ');')
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

  externalFrameScope (name) {
    return 'use(e&&e[' + escape(name) + '])'
  }

  externalFrameValue (name) {
    return 'e&&e[' + escape(name) + ']'
  }

  bindEnv (funcExpr, frameName) {
    const env = frameName ? extendEnv(frameName, 's') : 'e'
    return 'function(s){return (' + funcExpr + ').call(undefined,s,' + env + ',a,i)}'
  }

  forEachScope (scopeId, accumulatorId, lambdaId, frameName) {
    const env = frameName ? extendEnv(frameName, 'es') : 'e'
    const result = scopeId + '.forEachScope(es=>'
      + accumulatorId + '.push(' + lambdaId + '.call(undefined,es,' + env + ',a,i)))'
    this.current().body.push(result, ';')
  }

  setOwnValue (scopeId, name, value, ns) {
    return this.setOwnValueDyn(scopeId, '"' + name + '"', value, ns)
  }

  setOwnValueDyn (scopeId, id, value, ns) {
    this.current().body.push( // whoever actually pushes a command onto body is responsible for the ';':
      scopeId + '.setOwnValue(' + id + ',' + value + (ns ? ',"' + ns + '"' : '') + ');'
    )
  }

  filter (filterName) {
    if (!this.state.filters.hasOwnProperty(filterName)) {
      this.state.filters[filterName] = this.nextId(true)
    }
    return this.state.filters[filterName]
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
      body.push('if(', test, '){')
      consequentFn()
      body.push('}')
      if (alternateFn) {
        body.push('else{')
        alternateFn()
        body.push('}')
      }
    }
  }

  // "lazy" functions are just conveniences to curry calls to recurse and setValue,
  // used only in conjunction with _if() (which expects curried functions for its
  // consequentFn and alternateFn parameters).
  lazyRecurse (ast, intoId, wantScope, returnFn, ckPrefix, create, skipWatchIdCheck) {
    const self = this
    return function () {
      self.recurse(ast, intoId, wantScope, returnFn, ckPrefix, create, skipWatchIdCheck)
    }
  }

  lazyAssignId (id, value) {
    const self = this;
    return function () {
      self.assignId(id, value)
    }
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

class Register { // instances of this class are what get accumulated in a state's vars array

}

function getCacheKey (ast, isScope, prefix) {
  return (prefix ? prefix + '::' : '') + (isScope ? 'scope::' : '') + AST.serialize(ast)
}

function isFrameIdentifier (name) {
  return typeof name === 'string' && name.startsWith('$')
}

function extendEnv (frameName, scopeId) {
  // Preserve the Scope wrapper so lowered named list frames retain runtime
  // metadata such as _index and _parent, not just their underlying value.
  // This supports frame infrastructure.
  return 'Object.assign({},e,{' + escape(frameName) + ':use(' + scopeId + ')})'
}

function getOwnScope (scopeId, name) {
  return getOwnScopeDyn(scopeId, '"' + name + '"')
}

function getOwnScopeDyn (scopeId, id) {
  return scopeId + '.getOwnScope(' + id + ')'
}

function getParentScope (scopeId) {
  return scopeId + '._parent'
}

function getOwnValue (scopeId, name) {
  return getOwnValueDyn(scopeId, '"' + name + '"')
}

function getOwnValueDyn (scopeId, id) {
  return scopeId + '.getOwnValue(' + id + ')'
}

function if_Defined (id, defaultValue) {
  return 'ifd(' + id + ',' + escape(defaultValue) + ')'
}

function plus_ (left, right) {
  return 'pls(' + left + ',' + right + ')'
}

function not_ (expression) {
  return '!(' + expression + ')'
}

function and_ (left, right, needParens = false) {
  return needParens
    ? `(${left})&&(${right})`
    : left + '&&' + right
}

function scopeIsNull (scopeId) {
  return scopeId + '.isNull()'
}

function isNull (expression) {
  return expression + '==null'
}

function notNull (expression) {
  return expression + '!=null'
}

function member (left, right, computed) {
  if (computed) return computedMember(left, right)
  return nonComputedMember(left, right)
}

function computedMember (left, right) {
  return left + '[' + right + ']'
}

function nonComputedMember (left, right) {
  const SAFE_IDENTIFIER = /^[$_a-zA-Z][$_a-zA-Z0-9]*$/
  const UNSAFE_CHARACTERS = /[^$_a-zA-Z0-9]/g
  let expr = ''
  if (SAFE_IDENTIFIER.test(right)) {
    expr = left + '.' + right
  } else {
    right = right.replace(UNSAFE_CHARACTERS, stringEscapeFn)
    expr = left + '["' + right + '"]'
  }
  return expr
}

function escape (value) {
  if (isString(value))
    return "'" + value.replace(stringEscapeRegex, stringEscapeFn) + "'"
  if (isNumber(value)) return value.toString()
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (value === null) return 'null'
  if (typeof value === 'undefined') return 'undefined'
  throw new Error('IMPOSSIBLE')
}

function stringEscapeFn (c) {
  return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)
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
