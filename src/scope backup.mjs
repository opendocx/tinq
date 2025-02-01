const primitiveConstructors = [String, Number, Boolean, Date]

export function PushFrame (parentFrame, item, index0 = undefined, count = undefined, punc = undefined) {
  if (typeof index0 === 'number') {
    return new EnumerationScope(parentFrame, item, index0, count, punc)
  }
  return parentFrame ? new Scope(parentFrame, item) : item
}

export class Scope {
  constructor (parent, item) {
		let itemType = typeof item
		if (itemType === 'object') {
			if (!item) {
				itemType = 'null'
      } else if (item.constructor && primitiveConstructors.includes(item.constructor)) {
        itemType = item.constructor.name.toLowerCase()
        if (['string', 'number', 'boolean'].includes(itemType)) { // unwrap the primitive
          Object.keys(item)
            .filter(key => isNaN(+key))
            .forEach(key => this[key] = item[key])
          item = item.valueOf()
        }
			} else {
				Object.assign(this, item)
			}
		}
		if (itemType !== 'object') {
			this.__value = item
			this.__type = itemType
		}
		if (parent) {
			this._parent = parent
		}
  }

  __lookup (ident, ns) {
    let result = this
    if (ns) { // only look at type name for lookup
      while (result && (result.__typename !== ns)) result = result._parent
      return result
    }
    // fall-back/default behavior: when ns not specified, just look for presence of ident
    while (result && !(ident in result)) result = result._parent
    return result || this
  }

  [Symbol.toPrimitive] (hint) {
		if ('__value' in this) {
			return this.__type === 'date' ? this.__value[Symbol.toPrimitive](hint) : this.__value
		}
		// otherwise
		return Object.prototype[Symbol.toPrimitive](hint)
  }

	toString (...args) {
		if ('__value' in this && !this.__value && ['null', 'undefined'].includes(this.__type)) {
				return this.__type
		} // else
		return this.__value.toString.apply(this.__value, args)
  }

  valueOf () {
		if ('__value' in this) {
			return this.__value
		}
		return this
  }
}

export class EnumerationScope extends Scope {
	constructor (parent, item, index0, count, punc) {
    super(parent, item)
  	this._index0 = index0
    this.__length = count
    this.__punc = punc
	}

	get _index () {
		return this._index0 + 1
	}

	get _punc () {
    const index0 = this._index0
    const lastItem = this.__length - 1
    const punc = this.__punc
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

export function ParseListExample (example) {
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
