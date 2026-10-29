import { describe, it } from 'mocha'
import { Tinq, AST } from '../src/index.mjs'
import assert from 'assert'

const tinq = new Tinq()

/*
{[if x]}
    {[list []]}
        {[test]}
    {[endlist]}
{[elseif y]}
    {[A]}
    {[list outer]}
        {[z?B:B2]}
        {[list inner]}
            {[C]}
        {[endlist]}
        {[D]}
    {[endlist]}
    {[E]}
{[else]}
    {[F]}
    {[list another]}
        {[G]}
    {[endlist]}
    {[H]}
{[endif]}
*/

describe('Extracting logic from text templates', function () {
  it('should retrieve a unified AST for the TestNest text template', function () {
    const template = '{[if x]}{[list []]}{[test]}{[endlist]}{[elseif y]}{[A]}{[list outer]}{[z?B:B2]}{[list inner]}{[C]}{[endlist]}{[D]}{[endlist]}{[E]}{[else]}{[F]}{[list another]}{[G]}{[endlist]}{[H]}{[endif]}'
    const logic = tinq.extractTemplateLogic(template)
    const expected = TestNestLogicTree
    assert.deepStrictEqual(logic, expected)
  })

  it('should retrieve a unified AST for the redundant_if text template', function () {
    const template = `Redundant Ifs
Well, all I can say is “{[if  x]}Something {[adjective]}{[else]}nothing{[endif]}.”
{[name]}, do you think {[if x]}about it much{[else]}anything{[endif]}?
        
The logic tree should include the if twice, but should call for the data only once.`
    const logic = tinq.extractTemplateLogic(template)
    const expected = redundant_if_logic_tree
    assert.deepStrictEqual(logic, expected)
  })

  it('should re-emit an expression used in content after the same expression appears in an If', function () {
    const template = '{[if x]}{[x]}{[endif]}'
    const logic = tinq.extractTemplateLogic(template)
    const expected = [
      {
        type: 'If',
        expr: 'x',
        id: '1',
        contentArray: [{
          type: 'Content',
          expr: 'x',
          id: '2'
        }]
      }
    ]
    assert.deepStrictEqual(logic, expected)
  })

  it('SHOULD filter out more-conditional usage that PRECEDES less-conditional (or unconditional) usage', function () {
    // either we need to do this (A), or we need to (B) change OpenDocx so it ignores the more-conditional usages as its outputting XML,
    // or we need to (C) change OpenDocx so the XPath query it sends to OXPT specifies to only take the first node that comes back ([1]).
    // Note: it's not possible, under the current approach (A), to completely optimize out redundant fields.  We will address this in a
    // rewrite.  In the meantime, we have a partial approach for A (that this case illustrates) and we are also doing (C).
    const template = '{[if a]}{[if b]}{[x]}{[endif]}{[x]}{[endif]}{[x]}'
    const logic = tinq.extractTemplateLogic(template)
    const expected = [
      {
        type: 'If',
        expr: 'a',
        id: '1',
        contentArray: [
          {
            type: 'If',
            expr: 'b',
            id: '2',
            contentArray: []
          }
        ]
      },
      {
        type: 'Content',
        expr: 'x',
        id: '7',
        idd: ['5', '3'],
      }
    ]
    assert.deepStrictEqual(logic, expected)
  })

  it('should filter out conditional usage that follows unconditional usage', function () {
    const template = '{[x]}{[if a]}{[x]}{[endif]}'
    const logic = tinq.extractTemplateLogic(template)
    const expected = [
      {
        type: 'Content',
        expr: 'x',
        id: '1',
        idd: ['3'],
      }, {
        type: 'If',
        expr: 'a',
        id: '2',
        contentArray: []
      }
    ]
    assert.deepStrictEqual(logic, expected)
  })

  it('should NOT filter out usage in an If field that follows unconditional usage in a Content field', function () {
    const template = '{[x]}{[if x]}{[y]}{[endif]}'
    const logic = tinq.extractTemplateLogic(template)
    const expected = [
      {
        type: 'Content',
        expr: 'x',
        id: '1',
      }, {
        type: 'If',
        expr: 'x',
        id: '2',
        contentArray: [{
          type: 'Content',
          expr: 'y',
          id: '3',
        }]
      }
    ]
    assert.deepStrictEqual(logic, expected)
  })

  it('should not omit a content node when the same expression was used earlier in a conditional!', function () {
    const template = '{[if x]}{[x]}{[elseif y]}{[y]}{[else]}{[z]}{[endif]}'
    const logic = tinq.extractTemplateLogic(template)
    const expected = XYZLogicTree
    assert.deepStrictEqual(logic, expected)
  })

  it('correctly parses & extracts logic from the ugly nested if/elseif template', function () {
    const result = tinq.extractTemplateLogic(ugly_nested_template)
    const expected = ugly_nested_contentArray
    assert.deepStrictEqual(result, expected)
  })
})

const TestNestLogicTree = [
  {
    type: 'If',
    expr: 'x',
    id: '1',
    contentArray: [
      {
        type: 'List',
        expr: '[]',
        id: '2',
        contentArray: [
          {
            type: 'Content',
            expr: 'test',
            id: '3'
          },
        ]
      },
      {
        type: 'ElseIf',
        expr: 'y',
        id: '5',
        contentArray: [
          {
            type: 'Content',
            expr: 'A',
            id: '6'
          },
          {
            type: 'List',
            expr: 'outer',
            id: '7',
            contentArray: [
              {
                type: 'Content',
                expr: 'z?B:B2',
                id: '8'
              },
              {
                type: 'List',
                expr: 'inner',
                id: '9',
                contentArray: [
                  {
                    type: 'Content',
                    expr: 'C',
                    id: '10'
                  },
                ]
              },
              {
                type: 'Content',
                expr: 'D',
                id: '12'
              },
            ]
          },
          {
            type: 'Content',
            expr: 'E',
            id: '14'
          },
          {
            type: 'Else',
            id: '15',
            contentArray: [
              {
                type: 'Content',
                expr: 'F',
                id: '16'
              },
              {
                type: 'List',
                expr: 'another',
                id: '17',
                contentArray: [
                  {
                    type: 'Content',
                    expr: 'G',
                    id: '18',
                  },
                ]
              },
              {
                type: 'Content',
                expr: 'H',
                id: '20',
              }
            ]
          }
        ]
      }
    ]
  }
]

// 1{[?x]}2{[adjective]}3{[:]}4{[/?]}5{[name]}6{[if x]}7{[else]}8{[endif]}
const redundant_if_logic_tree = [
  {
    type: 'If',
    expr: 'x',
    id: '1',
    contentArray: [{
      type: 'Content',
      expr: 'adjective',
      id: '2',
    }, {
      type: 'Else',
      id: '3',
      contentArray: []
    }
    ]
  }, {
    type: 'Content',
    expr: 'name',
    id: '5',
  }, {
    type: 'If',
    expr: 'x',
    id: '6',
    contentArray: [{
      type: 'Else',
      id: '7',
      contentArray: []
    }
    ]
  }
]

// 1{[if x]}2{[x]}3{[elseif y]}4{[y]}5{[else]}6{[z]}7{[endif]}
const XYZLogicTree = [
  {
    type: 'If',
    expr: 'x',
    id: '1',
    contentArray: [{
      type: 'Content',
      expr: 'x',
      id: '2',
    }, {
      type: 'ElseIf',
      expr: 'y',
      id: '3',
      contentArray: [{
        type: 'Content',
        expr: 'y',
        id: '4',
      }, {
        type: 'Else',
        id: '5',
        contentArray: [{
          type: 'Content',
          expr: 'z',
          id: '6',
        }]
      }
      ]
    }
    ]
  }
]

const ugly_nested_template = `{[if DocSelect == "SelectAllPlan"]}
  {[EngageLetter]}
  {[DPOA]}
  {[AdvCarePlan]}
  {[SimpleWill]}
  {[FinancialStatement]}
  {[CoverSheet]}
  {[if Married]}
    {[DPOASpouse]}
    {[AdvCarePlanSpouse]}
    {[SimpleWillSpouse]}
  {[endif]}
{[elseif DocSelect == "SelectAllLivingWill"]}
  {[EngageLetter]}
  {[DPOA]}
  {[LivingWill]}
  {[AdvHealthDirective]}
  {[SimpleWill]}
  {[FinancialStatement]}
  {[CoverSheet]}
  {[if Married]}
    {[DPOASpouse]}
    {[LivingWillSpouse]}
    {[AdvHCDirSpouse]}
    {[SimpleWillSpouse]}
  {[endif]}
{[elseif DocSelect == "SelectDocs"]}
  {[if Documents | contains: "Engagement Letter"]}
    {[EngageLetter]}
  {[endif]}
  {[if Documents | contains: "Living Will"]}
    {[LivingWill]}
    {[if Married]}
      {[LivingWillSpouse]}
    {[endif]}
  {[endif]}
  {[if Documents | contains: "Power of Attorney"]}
    {[DPOA]}
    {[if Married]}
      {[DPOASpouse]}
    {[endif]}
  {[endif]}
  {[if Documents | contains: "Advanced Care Plan"]}
    {[AdvCarePlan]}
    {[if Married]}
      {[AdvCarePlanSpouse]}
    {[endif]}
  {[endif]}
  {[if Documents | contains: "Advance Health Care Directive"]}
    {[AdvHealthDirective]}
    {[if Married]}
      {[AdvHCDirSpouse]}
    {[endif]}
  {[endif]}
  {[if Documents | contains: "Financial Statement"]}
    {[FinancialStatement]}
  {[endif]}
  {[if Documents | contains: "Will"]}
    {[SimpleWill]}
    {[if Married]}
      {[SimpleWillSpouse]}
    {[endif]}
  {[endif]}
  {[if Documents | contains: "Cover Sheet"]}
    {[CoverSheet]}
  {[endif]}
{[endif]}
`
const ugly_nested_contentArray = [
  {
    type: 'If',
    expr: 'DocSelect=="SelectAllPlan"',
    id: '1',
    contentArray: [
      {
        type: 'Content',
        expr: 'EngageLetter',
        id: '2',
      }, {
        type: 'Content',
        expr: 'DPOA',
        id: '3',
      }, {
        type: 'Content',
        expr: 'AdvCarePlan',
        id: '4',
      }, {
        type: 'Content',
        expr: 'SimpleWill',
        id: '5',
      }, {
        type: 'Content',
        expr: 'FinancialStatement',
        id: '6',
      }, {
        type: 'Content',
        expr: 'CoverSheet',
        id: '7',
      }, {
        type: 'If',
        expr: 'Married',
        id: '8',
        contentArray: [
          {
            type: 'Content',
            expr: 'DPOASpouse',
            id: '9',
          }, {
            type: 'Content',
            expr: 'AdvCarePlanSpouse',
            id: '10',
          }, {
            type: 'Content',
            expr: 'SimpleWillSpouse',
            id: '11',
          }
        ]
      }, {
        type: 'ElseIf',
        expr: 'DocSelect=="SelectAllLivingWill"',
        id: '13',
        contentArray: [
          {
            type: 'Content',
            expr: 'EngageLetter',
            id: '14',
          }, {
            type: 'Content',
            expr: 'DPOA',
            id: '15',
          }, {
            type: 'Content',
            expr: 'LivingWill',
            id: '16',
          }, {
            type: 'Content',
            expr: 'AdvHealthDirective',
            id: '17',
          }, {
            type: 'Content',
            expr: 'SimpleWill',
            id: '18',
          }, {
            type: 'Content',
            expr: 'FinancialStatement',
            id: '19',
          }, {
            type: 'Content',
            expr: 'CoverSheet',
            id: '20',
          }, {
            type: 'If',
            expr: 'Married',
            id: '21',
            contentArray: [
              {
                type: 'Content',
                expr: 'DPOASpouse',
                id: '22',
              }, {
                type: 'Content',
                expr: 'LivingWillSpouse',
                id: '23',
              }, {
                type: 'Content',
                expr: 'AdvHCDirSpouse',
                id: '24',
              }, {
                type: 'Content',
                expr: 'SimpleWillSpouse',
                id: '25',
              }
            ]
          }, {
            type: 'ElseIf',
            expr: 'DocSelect=="SelectDocs"',
            id: '27',
            contentArray: [
              {
                type: 'If',
                expr: 'Documents|contains:"Engagement Letter"',
                id: '28',
                contentArray: [{
                  type: 'Content',
                  expr: 'EngageLetter',
                  id: '29',
                }]
              }, {
                type: 'If',
                expr: 'Documents|contains:"Living Will"',
                id: '31',
                contentArray: [
                  {
                    type: 'Content',
                    expr: 'LivingWill',
                    id: '32',
                  }, {
                    type: 'If',
                    expr: 'Married',
                    id: '33',
                    contentArray: [
                      {
                        type: 'Content',
                        expr: 'LivingWillSpouse',
                        id: '34',
                      }
                    ]
                  }
                ]
              }, {
                type: 'If',
                expr: 'Documents|contains:"Power of Attorney"',
                id: '37',
                contentArray: [
                  {
                    type: 'Content',
                    expr: 'DPOA',
                    id: '38',
                  }, {
                    type: 'If',
                    expr: 'Married',
                    id: '39',
                    contentArray: [
                      {
                        type: 'Content',
                        expr: 'DPOASpouse',
                        id: '40',
                      }
                    ]
                  }
                ]
              }, {
                type: 'If',
                expr: 'Documents|contains:"Advanced Care Plan"',
                id: '43',
                contentArray: [
                  {
                    type: 'Content',
                    expr: 'AdvCarePlan',
                    id: '44',
                  }, {
                    type: 'If',
                    expr: 'Married',
                    id: '45',
                    contentArray: [
                      {
                        type: 'Content',
                        expr: 'AdvCarePlanSpouse',
                        id: '46',
                      }
                    ]
                  }
                ]
              }, {
                type: 'If',
                expr: 'Documents|contains:"Advance Health Care Directive"',
                id: '49',
                contentArray: [
                  {
                    type: 'Content',
                    expr: 'AdvHealthDirective',
                    id: '50',
                  }, {
                    type: 'If',
                    expr: 'Married',
                    id: '51',
                    contentArray: [
                      {
                        type: 'Content',
                        expr: 'AdvHCDirSpouse',
                        id: '52',
                      }
                    ]
                  }
                ]
              }, {
                type: 'If',
                expr: 'Documents|contains:"Financial Statement"',
                id: '55',
                contentArray: [{
                  type: 'Content',
                  expr: 'FinancialStatement',
                  id: '56',
                }]
              }, {
                type: 'If',
                expr: 'Documents|contains:"Will"',
                id: '58',
                contentArray: [
                  {
                    type: 'Content',
                    expr: 'SimpleWill',
                    id: '59',
                  }, {
                    type: 'If',
                    expr: 'Married',
                    id: '60',
                    contentArray: [
                      {
                        type: 'Content',
                        expr: 'SimpleWillSpouse',
                        id: '61',
                      }
                    ]
                  }
                ]
              }, {
                type: 'If',
                expr: 'Documents|contains:"Cover Sheet"',
                id: '64',
                contentArray: [{
                  type: 'Content',
                  expr: 'CoverSheet',
                  id: '65',
                }]
              }
            ]
          }
        ]
      }
    ]
  }
]
