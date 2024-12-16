'use strict'

export class Yvalue {
  constructor (value, typeDef = undefined) {
    // value can be:
    //   (frameType === Yvalue.PRIMITIVE)
    //     - null
    //     - a string or String object
    //     - a number or Number object
    //     - a boolean or Boolean object
    //     - a Date object
    //   (frameType === Yvalue.OBJECT)
    //     - any other single object
    //   (frameType === YObject.LIST)
    //     - an array of any of the above
    if (value && (value instanceof Yvalue)) throw new Error('Cannot nest a Yvalue inside another')
    this.frameType = (isPrimitive(value) || value === null)
      ? Yvalue.PRIMITIVE
      : Yvalue.isArray(value) || isObjectIterable(value)
        ? Yvalue.LIST
        : Yvalue.OBJECT
    this.valueType = typeof value
    switch (this.valueType) {
      case 'object':
        if (!value) {
          this.value = null
          this.valueType = 'null'
        } else {
          if (this.frameType === Yvalue.PRIMITIVE) {
            this.valueType = value.constructor.name.toLowerCase() // handles "date" as well as wrapped primitives
            this.value = value
          } else if (this.frameType === Yvalue.LIST) {
            this.valueType = 'array'
            if (Yvalue.isArray(value)) {
              this.value = value
            } else {
              this.value = Array.from(value)
            }
          } else {
            // valueType is already correct
            this.value = value
          }
        }
        break
      case 'string':
        this.value = new String(value) // eslint-disable-line no-new-wrappers
        break
      case 'number':
        this.value = new Number(value) // eslint-disable-line no-new-wrappers
        break
      case 'boolean':
        this.value = new Boolean(value) // eslint-disable-line no-new-wrappers
        break
      default:
        this.value = value
    }
    this.items = {}
  }

  hasProperty (name) {
    return this.value && (typeof this.value === 'object') && (
      ( this.typeDef && this.typeDef.propDict && (name in this.typeDef.propDict))
      || (name in this.value)
    )
  }

  getProperty (property, curriedParent = undefined) {
    // a caller is fetching some property value of the YObject, typically during evaluation.
    if (this.value) {
      // first check for child YObjects
      const yobj = this.getChildYObject(property, curriedParent)
      if (yobj) {
        return /* (yobj instanceof YList) ? yobj.scopeProxy : */ yobj.proxy
      }
      // else get the value
      const val = this.value[property]
      // check if it's a virtual, and if so, evaluate it
      if (typeof val === 'function' && (val.ast || val.logic)) {
        let newVal = this.evaluate(val)
        if (newVal instanceof EvaluationResult) {
          newVal = newVal.value
        }
        // newVal, at this point, may be either a primitive or an object proxy -- may also be an "indirect virtual"
        return newVal
      }
      // else just return it
      return val
    }
  }

  getChildYObject (property, curriedParent = undefined) {
    // a caller is fetching the YObject for a child scope
    let val = this.items[property]
    if (val) { // we already have a cached YObject; return it
      return val
    }
    // else get the value
    val = this.value && this.value[property]
    // if it's empty, a raw primitive or a function, return nothing
    if (!val || isPrimitive(val, false) || (typeof val === 'function')) {
      return
    }
    // if it's already a proxy, return its underlying YObject
    let yobj = val.__yobj
    if (yobj) {
      return yobj
    }
    // create a YObject wrapper for the item, and cache it in items
    // (original item still availabe in value/__value)
    yobj = Yvalue.isIterable(val)
      ? new YList(val, curriedParent || this)
      : new Yvalue(val, curriedParent || this)
    this.items[property] = yobj
    return yobj
  }

  evaluate (compiledVirtual) {
    if (typeof compiledVirtual === 'function') {
      if (compiledVirtual.ast) {
        // appears to be a compiled angular expression; it expects a scope object (proxy)
        increment(compiledVirtual)
        try {
          const result = compiledVirtual(this.scopeProxy, this.proxy)
          const yobj = result  && result.__yobj
          const frameType = yobj && yobj.frameType
          if (frameType === Yvalue.LIST) {
            // it's an array proxy of scope proxies; just return it
            return result
          }
          // check for array return values, wrap them in a YList, and return a proxy
          if (Array.isArray(result) && !(this instanceof YReducerItem)) {
            return (new YList(result, this)).proxy // scopeProxy
          }
          // else check for proxied primitives we may need to unwrap
          if (frameType === Yvalue.PRIMITIVE) {
            return yobj.valueType === 'null'
              ? yobj.bareValue // nothing else can be done with a null
              : yobj.proxy // but we may still need to look up properties of other "hybrid" objects!
          }
          // else just return the value
          return result
        } catch (e) {
          if (e instanceof RecursionError) {
            throw e // need the error to bubble all the way up/out of the recursion!
          } else {
            console.error(`Evaluation error: ${e.toString()}`)
          }
          return undefined
        } finally {
          decrement(compiledVirtual)
        }
      } // else
      if (compiledVirtual.logic) {
        // appears to be a compiled template; it expects a scope frame (not a proxy)
        increment(compiledVirtual)
        const result = compiledVirtual(this)
        decrement(compiledVirtual)
        return result && result.valueOf()
      } // else
      increment(compiledVirtual)
      const result = compiledVirtual(this.scopeProxy, this.proxy)
      decrement(compiledVirtual)
      return result
    }
    throw new Error('YObject.evaluate invoked against a non-function')
  }

  deferEvaluate (compiledVirtual) {
    if (typeof compiledVirtual === 'function') {
      if (compiledVirtual.ast) {
        const evalStack = []
        // evalStack.unshift(compiledVirtual.normalized)
        let frame = this
        while (frame.parent) {
          if ('__index' in frame) {
            evalStack.unshift(frame.__index)
          } else if ('__expr' in frame) {
            evalStack.unshift(frame.__expr)
          }
          frame = frame.parent
        }
        return {
          type: AST.ExpressionStatement,
          expression: compiledVirtual.ast,
          text: compiledVirtual.normalized,
          data: this,
          context: evalStack,
        }
      }
    }
    throw new Error('Cannot defer evaluation of virtual')
  }

  static isTruthy (value) {
    let bValue
    if (value && Yvalue.isIterable(value)) {
      // checking if a list is empty or not
      if (!Yvalue.isArray(value)) {
        value = Array.from(value)
      }
      bValue = (value.length > 0) // for purposes of evaluation in yatte, we consider empty lists falsy!
      // (unlike typical JavaScript, where any non-null array, even empty ones, are considered truthy)
    } else {
      bValue = Boolean(value)
    }
    return bValue
  }

  static isArray (obj) {
    return Array.isArray(obj)
  }

  static isIterable (obj) {
    // checks for null and undefined; also strings (though iterable) should not be iterable *contexts*
    if (obj == null || isPrimitive(obj)) {
      return false
    }
    return typeof obj[Symbol.iterator] === 'function'
  }

  // [Symbol.toPrimitive] (hint) {
  //   if (!this.value) return undefined
  //   switch (this.valueType) {
  //     case 'string':
  //     case 'number':
  //     case 'boolean':
  //     case 'date':
  //       return this.value.valueOf()
  //     default:
  //       if (hint === 'string') return this.value.toString()
  //       if (hint === 'number') return Number(this.value)
  //       // else
  //       return Boolean(this.value)
  //   }
  // }

  // /* get [Symbol.isConcatSpreadable] () {
  //   return (this.valueType === 'array' || YObject.isArray(this.value))
  // } */

  toString (...args) {
    return this.value.toString.apply(this.value, args)
  }

  valueOf () {
    return this.value && this.value.valueOf()
  }

  get bareValue () { // for "unwrapping" wrapped primitives. Differs from valueOf in handling of dates.
    switch (this.valueType) {
      case 'string':
      case 'number':
      case 'boolean':
        return this.value && this.value.valueOf()
    }
    return this.value
  }

  get _parent () {
    const parent = this.getParentEffective()
    return parent && parent.proxy // scopeProxy
    // note: _parent needs to return a scopeProxy (rather than a regular proxy) so _index will be available on it
  }

  static empty (thatScope) {
    return !thatScope || !(thatScope instanceof Yvalue)
  }

  static pop (thatScope) {
    if (Yvalue.empty(thatScope)) return null
    return thatScope.getParent()
  }

  static pushContext (contextArray, parent) {
    let context = parent
    if (contextArray) {
      for (const expr of contextArray) {
        if (typeof expr === 'string') {
          const evaluator = base.compileExpr(expr)
          const lst = context.evaluate(evaluator)
          context = Yvalue.pushList(lst, context)
        } else if (typeof expr === 'number') {
          if (!(context instanceof YList)) {
            throw new Error('Invalid contextArray passed to pushContext')
          }
          context = Yvalue.pushListItem(expr, context)
        }
      }
    }
    return context
  }

  static pushObject (value, parent = null) {
    let yobj
    if (parent) { // replace value's evaluation context (if it has any) with explicitly-supplied parent
      if (parent.__yobj) {
        throw new Error('parent must not be a proxy')
      }
      let obj = value && value.__value // in case it's a proxy
      if (!obj) {
        obj = (value instanceof Yvalue) ? value.value : value
      }
      yobj = new Yvalue(obj, parent)
    } else { // no parent passed in... so preserve value's parents (evaluation context) if available
      yobj = value && value.__yobj
      if (!yobj) {
        yobj = (value instanceof Yvalue) ? value : new Yvalue(value)
      }
    }
    return yobj
  }

  static pushList (iterable, parent) {
    if (parent && parent.__yobj) {
      throw new Error('parent must be a YObject, not a proxy')
    }
    let array
    const parentObj = (typeof parent === 'function') ? parent() : parent
    const yobj = iterable && iterable.__yobj
    if (yobj) { // it's a list proxy (result of evaluating an expression)
      if (yobj.getParent() === parentObj) { // it already has the correct/desired context
        return yobj // just go with what we've already got
      }
      // else
      console.log('pushList called with out-of-context proxy')
      array = iterable.__yobj.value
    }
    if (!array) {
      if (iterable instanceof YList) {
        if (iterable.getParent() === parentObj) {
          return iterable
        }
        console.log('pushList called with out-of-context list')
        array = iterable.value
      }
    }
    return new YList(array || iterable, parent)
  }

  static pushListItem (index0, parentList) {
    // YListItems have already been created, we just return the existing ones
    if (typeof parentList === 'function') {
      const parentObj = parentList()
      if (parentObj.__yobj) {
        throw new Error('parentList must be a YList, not a proxy')
      }
      const item = parentObj.items[index0]
      // however, we fix up the parent reference if necessary
      if (item.parent !== parentList) {
        item.parent = parentList
      }
      return item
    } // else
    if (parentList.__yobj) {
      throw new Error('parentList must be a YList, not a proxy')
    }
    return parentList.items[index0]
  }

  static pushReducerItem (index0, parentList, result) {
    return new YReducerItem(index0, parentList, result)
  }

  static parseListExample (example) {
    const p1 = example.indexOf('1')
    const p2 = example.indexOf('2')
    const p3 = example.indexOf('3')
    if (p1 >= 0 && p2 > p1) { // at least 1 & 2 are present and in the right order (minimum for valid example)
      // const prefix = example.slice(0, p1)
      // you may wonder why we don't bother remembering the stuff prior to the "1" token (if any)
      // It's because right now, this stuff only gets merged into assembled content at the location where
      // the template compiler has placed a {[_punc]} field, and no _punc field gets added at the beginning
      // of a list item.  In fact, it kinda raises the question of how appropriate it is to support the suffix,
      // as we do, because if there are NO items in the list, you might expect the suffix to be merged anyway,
      // but it's not -- it only gets merged as a suffix to the last item in the list.  If we wanted to add a
      // prefix, but still be consistent, we'd need the prefix to only be merged as a prefix to the first item,
      // and if there were no items, you'd get neither prefix nor suffix.
      const between = example.slice(p1 + 1, p2)
      if (p3 > p2) { // 3 is also present and in the expected order
        const last2 = example.slice(p2 + 1, p3)
        let only2
        if (last2 !== between && last2.startsWith(between)) { // as with an oxford comma: "1, 2, and 3"
          only2 = last2.slice(between.trimRight().length)
        } else {
          only2 = last2
        }
        const suffix = example.slice(p3 + 1)
        return { between, last2, only2, suffix }
      } else { // 3 is not present or is not in the valid order
        const suffix = example.slice(p2 + 1)
        return { between, last2: between, only2: between, suffix }
      }
    }
  }
}
Yvalue.PRIMITIVE = 'primitive'
Yvalue.OBJECT = 'object'
Yvalue.LIST = 'list'

export function isIterable (obj) {
  // checks for null and undefined; also strings (though iterable) should not be iterable *contexts*
  if (obj == null || isPrimitive(obj)) {
    return false
  }
  return isObjectIterable(obj)
}

export function isObjectIterable (obj) {
  return obj && (typeof obj[Symbol.iterator] === 'function')
}

const primitiveConstructors = [String, Number, Boolean, Date]

export function isPrimitive (value, includeWrapped = true) {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return true
    case 'object':
      if (includeWrapped) {
        if (value && value.constructor && primitiveConstructors.includes(value.constructor)) {
          return true
        }
      } else if (value && (value instanceof Date)) {
        return true
      }
  }
  return false
}
