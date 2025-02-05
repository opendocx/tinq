import { OD, toContentArray } from './legacy.mjs'

// this code is carried over from Yatte. Its original purpose was to do some low-hanging optimizations of parsed
// templates, for example removing redundant content fields to make the logical structure of the template more
// clear. As it turns out this probably doesn't do nearly as much as we were hoping, but it's something so I've
// brought it over to TINQ for now.

export function extractLogic (ast) {
  // returns a 'logic tree' for this template --
  // a filtered, optimized AST representing the logical structure of the template
  const legacyBody = toContentArray(ast)
  return buildLogicTree(legacyBody)
}

function buildLogicTree (astBody) {
  // return a copy of astBody with all (or at least some) logically insignificant nodes pruned out:
  // remove plain text nodes (non-dynamic)
  // remove EndIf and EndList nodes
  // remove Content nodes that are already defined in the same logical/list scope
  // always process down all if branches & lists
  // ~~~strip field ID metadata (for docx templates) since it no longer applies
  // ~~~ revised: leave it in so we know more about error location
  const copy = reduceContentArray(astBody)
  simplifyContentArray2(copy)
  simplifyContentArray3(copy)
  return copy
}

function reduceContentArray (astBody, newBody = null, scope = null, parentScope = null) {
  // prune plain text nodes (non-dynamic, so they don't affect logic)
  // prune EndIf and EndList nodes (only important insofar as we need to match up nodes to fields --
  //   which will not be the case with a reduced logic tree)
  // prune redundant Content nodes that are already defined in the same logical & list scope
  // always process down all if branches & lists
  //    but mark check whether each if expression is the first (in its scope) to refer to the expression,
  //    and if so, indicate it on the node
  // future: compare logical & list scopes of each item, and eliminate logical branches
  //    and list iterations that are redundant
  if (newBody === null) newBody = []
  if (scope === null) scope = {}
  for (const obj of astBody) {
    const newObj = reduceContentNode(obj, scope, parentScope)
    if (newObj !== null) {
      newBody.push(newObj)
    }
  }
  return newBody
}

function reduceContentNode (astNode, scope, parentScope = null) {
  if (typeof astNode === 'string') return null // plain text node -- boilerplate content in a text template
  if (astNode.type === OD.EndList) {
    // can we find the matching List field, to set its .endid = astNode.id before returning?
    return null
  }
  if (astNode.type === OD.EndIf) {
    // can we find the initial matching If field (not ElseIf or Else), to set its .endid = astNode.id before returning?
    return null
  }
  if (astNode.type === OD.Content) {
    if (!astNode.id && astNode.expr === '_punc') { // _punc nodes do not affect logic!
      return null
    }
    const existing = scope[astNode.expr]
    if (existing) { // expression already defined in this scope
      if (astNode.id && typeof existing === 'object') {
        const idd = existing.idd || (existing.idd = [])
        idd.push(astNode.id)
      }
      return null
    }
    const { /* id, */ ...copyOfNode } = astNode // stopped stripping field id
    scope[astNode.expr] = copyOfNode
    return copyOfNode
  }
  if (astNode.type === OD.List) {
    const existing = scope[astNode.expr]
    if (existing) {
      // this list has already been added to the parent scope; revisit it to add more content members if necessary
      reduceContentArray(astNode.contentArray, existing.contentArray, existing.scope)
      if (astNode.id) {
        const idd = existing.idd || (existing.idd = [])
        idd.push(astNode.id)
      }
      return null
    } else {
      const { /* id, */ contentArray, ...copyOfNode } = astNode // stopped stripping the id
      copyOfNode.scope = {} // fresh new wholly separate scope for lists
      copyOfNode.contentArray = reduceContentArray(contentArray, null, copyOfNode.scope)
      scope[astNode.expr] = copyOfNode // set BEFORE recursion for consistent results?  (or is it intentionally after?)
      return copyOfNode
    }
  }
  if (astNode.type === OD.If || astNode.type === OD.ElseIf || astNode.type === OD.Else) {
    // if's are always left in at this point (because of their importance to the logic;
    // a lot more work would be required to accurately optimize them out.)
    // HOWEVER, we can't add the expr to the parent scope by virtue of it having been referenced in a condition,
    // because it means something different for the same expression to be evaluated
    // in a Content node vs. an If/ElseIf node, and therefore an expression emitted/evaluated as part of a condition
    // still needs to be emitted/evaluated as part of a merge/content node.
    // AND VICE VERSA: an expression emitted as part of a content node STILL needs to be emitted as part of a condition,
    // too.

    const { /* id, */ contentArray, ...copyOfNode } = astNode // stopped stripping the id
    // this 'parentScope' thing is a bit tricky.  The parentScope argument is only supplied
    // when we're inside an If/ElseIf/Else block within the current scope.
    // If supplied, it INDIRECTLY refers to the actual scope -- basically, successive layers of "if" blocks
    // that each establish a new "mini" scope, that has the parent scope as its prototype.
    // This means, a reference to an identifier in a parent scope, will prevent that identifier from
    // subsequently appearing (redundantly) in a child; but a reference to an identifier in a child scope,
    // must NOT prevent that identifier from appearing subsequently in a parent scope.
    const pscope = (parentScope != null) ? parentScope : scope
    if (copyOfNode.type === OD.If || copyOfNode.type === OD.ElseIf) {
      if (!(('if$' + astNode.expr) in pscope)) {
        pscope['if$' + astNode.expr] = copyOfNode
      }
    }
    const childContext = Object.create(pscope)
    copyOfNode.contentArray = reduceContentArray(contentArray, null, childContext, pscope)
    return copyOfNode
  }
}

function simplifyContentArray2 (astBody) {
  // 2nd pass at simplifying logic
  // for now, just clean up scope helpers leftover from first pass
  for (const obj of astBody) {
    simplifyNode2(obj)
  }
}

function simplifyNode2 (astNode) {
  if (astNode.scope) { delete astNode.scope }
  if (Array.isArray(astNode.contentArray)) { simplifyContentArray2(astNode.contentArray) }
}

function simplifyContentArray3 (body, scope = {}) {
  // 3rd pass at simplifying scopes
  const initialScope = { ...scope } // shallow-clone the scope to start with
  // first go through content fields
  let i = 0
  while (i < body.length) {
    const field = body[i]
    let nodeRemoved = false
    if (field.type === OD.Content) {
      if (field.expr in scope) {
        if (field.id) {
          const existing = scope[field.expr]
          const idd = existing.idd || (existing.idd = [])
          idd.push(field.id)
        }
        body.splice(i, 1)
        nodeRemoved = true
      } else {
        scope[field.expr] = field
      }
    }
    if (!nodeRemoved) {
      i++
    }
  }
  // then recurse into ifs and lists
  for (const field of body) {
    if (field.type === OD.List) {
      if (!(field.expr in scope)) {
        scope[field.expr] = field
      }
      simplifyContentArray3(field.contentArray, {}) // new scope for lists
    } else if (field.type === OD.If) {
      // the content in an if block has everything in its parent scope
      simplifyContentArray3(field.contentArray, { ...scope }) // copy the parent scope
    } else if (field.type === OD.ElseIf || field.type === OD.Else) {
      // elseif and else fields are (in the logic tree) children of ifs,
      // but they do NOT have access to the parent scope, reset to initial scope for if
      simplifyContentArray3(field.contentArray, { ...initialScope })
    }
  }
  // note: although this will eliminate some redundant fields, it will not eliminate all of them.
  // A partial rewrite is planned to implement a new, more straight-forward approach.
}
