import { primitiveConstructors } from './utils.mjs'
import equal from 'fast-deep-equal'

export function useScope (valueOrScope) {
	return valueOrScope instanceof Scope ? valueOrScope : scopeFactory.createScope(valueOrScope)
}

export function isScope (obj) {
  return obj instanceof Scope
}

export class Scope {
  constructor (value, parentScope) {
    if (value instanceof Scope) {
      throw new Error('value is already an instance of Scope')
    }
    this.value = value
    let vt = typeof value
    if (value === null || vt === 'undefined') {
      vt = 'null'
    } else {
      this.typename = value.__typename // just in case?
      if (vt === 'object') {
        if (value.constructor && primitiveConstructors.includes(value.constructor)) {
          vt = value.constructor.name.toLowerCase()
        } else if (Array.isArray(value)) {
          vt = 'array'
          this.length = value.length
          this.punc = value.punc
        }
      }
    }
    this.type = vt
    this.isPrimitive = (vt !== 'object' && vt !== 'array')
    if (parentScope && !(parentScope instanceof Scope)) {
        throw new Error('parentScope is not an instance of scope!')
    }
    this._parent = parentScope || null
  }

  pushScope (value) {
    if (value instanceof Scope) {
      if (value._parent === this) {
        return value // looks okay, it's a no-op
      }
      throw new Error('Cannot reuse conflicting Scope. What are you trying to do?')
    }
    return scopeFactory.createScope(value, this)
  }
  
  lookupBase (ident, baseTypeName) {
    let base = this
    if (baseTypeName) { // use only type name to find correct scope
      while (base && (base.typename !== baseTypeName)) base = base._parent
    } else { // when not specified, just look for presence of ident (fall-back to top of stack if not found)
      while (base && !base.hasOwnValue(ident)) base = base._parent
      if (!base) base = this // if we are searching purely on name (no types), fall back to "this" (local scope)
    }
    return base // may be undefined if baseTypeName was provided but not found (== bug in caller's code)
  }

  lookupScope (ident, baseTypeName) { // this gets called at compile-time to resolve an identifier INCL CONTEXT
    const base = this.lookupBase(ident, baseTypeName)
    return base
      ? base.getOwnScope(ident)
      : scopeFactory.createScope(null) // identifier not found; return null scope (?)
  }

  lookupValue (ident, baseTypeName) { // this gets called at compile-time to resolve an identifier WITHOUT CONTEXT
    const base = this.lookupBase(ident, baseTypeName)
    return base && base.getOwnValue(ident)
  }

  getOwnScope (ident) { // == old lookupScope + getOwnValue + pushScope
    Scope.validateIdent(ident, this.type)
    if (!isNaN(ident)) { // ident is numeric -- array index
      return scopeFactory.createEnumScope(this._parent, this.value && this.value[ident], +ident, this.length, this.punc)
    }
    if (ident === '_parent') return this._parent // special case
    // else normal use case -- ident is alphanumeric identifier
    const result = scopeFactory.createScope(this.getOwnValue(ident), this)
    result.name = ident
    return result
  }

  forEachScope (enumScopeFunc) {
    if (this.type !== 'array') {
      throw new Error('forEachScope called on non-array')
    }
    let i = 0
    while (i < this.length) {
      enumScopeFunc(this.getOwnScope(i))
      i++
    }
  }

  hasOwnValue (ident) {
    if (ident && ident.startsWith('_')) {
      if (ident in this) return true // _parent, _index0 etc. are on this, but _key, _values (for grouping) are on this.value
    }
    if (this.type === 'null') return false
    if (!ident) return true
    if (typeof this.value === 'object') return (ident in this.value)
    return Boolean(this.value[ident])
  }

  getOwnValue (ident) {
    if (!ident) return this.value
    if (ident.startsWith('_') && (ident in this)) {
      return ident === '_parent'
        ? this._parent && this._parent.valueOf()
        : this[ident]
    }
    if (this.type === 'null') return undefined
    let result = this.value[ident]
    if (typeof result === 'function' && result.ast) {
      result = result.apply(undefined, [this])
      // the following would cause all text-based ExternalFiles to auto-compose, but we don't want this here.
      // if (result instanceof ExternalFile && typeof result.data !== 'object') {
      //   result = result.data
      // }
    }
    return result
  }

  setOwnValue (ident, value, ns) {
    this.value[ident] = value
  }

  root () {
    return this._parent ? this._parent.root() : this
  }

  isNull () {
    return this.value == null
  }

  [Symbol.toPrimitive] (hint) {
    switch (this.type) {
      case 'null':
        return this.value
      case 'string':
      case 'number':
      case 'boolean':
      case 'date':
        return this.value.valueOf()
      default:
        if (hint === 'string') return ''+this.value
        if (hint === 'number') return +this.value
        // else
        return Boolean(this.value)
    }
  }

	toString (...args) {
    if (this.value === null) return this.type
    if (this.value === undefined) return 'undefined'
		return this.value.toString.apply(this.value, args)
  }

  valueOf () {
    return this.value
  }

  static validateIdent (ident, type) {
    const t = typeof ident
    if (t !== 'string' && t !== 'number') throw new Error(`received a ${t} instead of an identifier`)
    if (isNaN(ident)) { // alphanumeric identifier
      if (!ident) throw new Error('Identifier required')
    } else { // ident is numeric -- array index
      if (type !== 'array' && type !== 'null') {
        throw new Error(`Requested numeric element of ${type} (non-array)`)
      }
    }
  }
}

export class EnumerationScope extends Scope {
	constructor (parent, item, index0, count, punc) {
    super(item, parent)
  	this._index0 = index0
    this.length = count
    this.punc = punc
	}

	get _index () {
		return this._index0 + 1
	}

	get _punc () {
    const index0 = this._index0
    const lastItem = this.length - 1
    const punc = this.punc
    return punc                     // if punctuation was specified
      ? (index0 === lastItem)       //   (then) if index0 is the last item
        ? punc.suffix               //     (then) get the list suffix (if any)
        : (index0 === lastItem - 1) //     (else) if index0 is 2nd to last
          ? index0 === 0            //       (then) if first (meaning there are only 2!)
            ? punc.only2            //         (then) get only2
            : punc.last2            //         (else) get last2
          : punc.between            //       (else) just get regular 'between' punctuation
      : ''                          //   (else) no punctuation
	}
}

export function parseListExample (example) {
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
      if (last2.startsWith(',') && last2.trimRight().length > 1 && between.trimRight() === ',') {
        // oxford comma: "1, 2, and 3". But if only 2 items in list, omit oxford comma: "1 and 2"
        only2 = last2.slice(1)
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

// An instance of ExternalFile represents an external file or BLOB that
// (1) TINQ does not know how to create (hence "External"... TINQ only does text)
// (2) CAN be created dynamically by some other, (again) external, code
// (3) needs data from inside TINQ's scope to produce this external file
// (4) (optionally) needs to composite this external output with other output ALSO being created by TINQ
export class ExternalFile {
  constructor (template, data) {
    this.template = template
    if (data || !('data' in this)) {
      this.data = data
    }
  }

  isEqualTo (that) {
    // compare based on enumeration of that's properties instead of this,
    // because we want to match if that has no "id" property even if this does!
    return equal(that.template, this.template) && equal(that.data, this.data)
  }

  toString () {
    // When an ExternalFile is encountered during (synchronous) text-based assembly,
    // it is converted to a string (by adding "") to retrieve a text representation.
    return this.data + ''
    // In (async) docx-based assembly, encountering an indirect causes a special
    // placeholder to be inserted so the resulting files can be composed later.
  }
}

class ScopeFactory {
  constructor() {
    this.ScopeClass = Scope
    this.EnumScopeClass = EnumerationScope
  }

  registerScopeClass (derivedScopeClass) {
    this.ScopeClass = derivedScopeClass
  }

  registerEnumScopeClass (derivedScopeClass) {
    this.EnumScopeClass = derivedScopeClass
  }

  createScope (value, parentScope) {
    const ScopeConstructor = this.ScopeClass
    return new ScopeConstructor(value, parentScope)
  }

  createEnumScope (parent, item, index0, count, punc) {
    const EnumScopeConstructor = this.EnumScopeClass
    return new EnumScopeConstructor(parent, item, index0, count, punc)
  }
}

export const scopeFactory = new ScopeFactory()
