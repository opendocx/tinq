const primitiveConstructors = [String, Number, Boolean, Date]

export function pushScope (scope, locals, index0 = undefined, count = undefined, punc = undefined) {
  const isList = typeof index0 === 'number' && count > 0
	let result = scope instanceof Scope ? scope : new Scope(scope)
  if (isList) {
    result = result.pi(locals, index0, count, punc)
  } else if (locals) {
    result = result.po(locals)
  }
	return result
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
          // if (['string', 'number', 'boolean'].includes(vt)) { // unwrap the primitive
          //   Object.keys(value)
          //     .filter(key => isNaN(+key))
          //     .forEach(key => this[key] = value[key])
          //   value = value.valueOf()
          // }
        } // else {
        // 	Object.assign(this, value)
        // }
      }
    }
    this.type = vt
    this.isPrimitive = (vt !== 'object')
    if (parentScope && !(parentScope instanceof Scope)) {
        throw new Error('parentScope is not an instance of scope!')
    }
    this._parent = parentScope || null
  }

  po (childValue) { // push object
    return new Scope(childValue, this)
  }

  pi (value, index0, count, punc) { // push iteration/element of list
    return new EnumerationScope(this, value, index0, count, punc)
  }

  gv (ident, ns) { // get value
    if (ns) {
      // look up scope chain until you find a frame of the expected typename, then look up ident on that frame (or return whole frame's value if no ident given)
      const frame = this.gs(null, ns)
      return frame && frame.go(ident)
    }
    if (ident) {
      // look up scope chain until you find one that "has" a member by the name of ident, and return that ident's value
      const frame = this.gs(ident)
      return frame && frame.go(ident)
    }
    // else: return the whole value for this frame
    return this.value
  }

  sv (ident, value, ns) { // set value
    // not implemented
    throw new error('not implemented')
    this.value[ident] = value
  }

  ho (ident) { // has OWN value
    if (ident && ident.startsWith('_')) return (ident in this)
    if (this.type === 'null') return false
    if (!ident) return true
    if (typeof this.value === 'object') return (ident in this.value)
    return Boolean(this.value[ident])
  }

  go (ident) { // get OWN value
    if (!ident) return this.value
    if (ident.startsWith('_')) return this[ident]
    if (this.type === 'null') return undefined
    let result = this.value[ident]
    if (typeof result === 'function' && result.ast) {
      result = result.apply(undefined, [this])
    }
    return result
  }

  gs (ident, ns) { // get scope
    let result = this
    if (ns) { // only look at type name for lookup
      while (result && (result.typename !== ns)) result = result._parent
      return result
    }
    if (ident) {
      // when ns not specified, just look for presence of ident (fall-back to top of stack if not found)
      while (result && !result.ho(ident)) result = result._parent
      return result || this
    }
    // if no ident specified, just return this frame
    return result
  }

  [Symbol.toPrimitive] (hint) {
    if (this.type === 'null') return this.value
		return this.value[Symbol.toPrimitive](hint)
  }

	toString (...args) {
    if (this.value === null) return this.type
    if (this.value === undefined) return 'undefined'
		return this.value.toString.apply(this.value, args)
  }

  valueOf () {
    return this.value
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
