import type { MicroUnit } from "./micro-training";
export const additionalMicroUnits: MicroUnit[] = [
  {
    "key": "builtin:academic-resources",
    "stamp": "original-1",
    "materialId": null,
    "kind": "paraphrase",
    "skill": "reading",
    "title": "学术语境：资源与政策",
    "description": "自编改编训练：在具体语境中判断替换表达，不把近义词当作任何语境都可互换。",
    "minutes": 5,
    "topics": [
      "paraphrase",
      "同义替换",
      "词汇"
    ],
    "source": "JiawenLex 自编训练；非官方考试题",
    "permission": "项目原创示例，供成员学习与练习。",
    "origin": "adapted",
    "items": [
      {
        "id": "academic-resources-1",
        "context": "The council allocated more funding to public transport.",
        "prompt": "Which phrase best replaces “allocated more funding”?",
        "choices": [
          "set aside more money",
          "collected less money",
          "cancelled all spending"
        ],
        "answers": [
          "set aside more money"
        ],
        "explanation": "allocate 表示分配；原句说增加分配给公共交通的资金。",
        "checklist": []
      },
      {
        "id": "academic-resources-2",
        "context": "The new policy aims to alleviate traffic congestion.",
        "prompt": "Which phrase preserves “alleviate traffic congestion”?",
        "choices": [
          "eliminate all vehicles",
          "make traffic congestion less severe",
          "increase journey times"
        ],
        "answers": [
          "make traffic congestion less severe"
        ],
        "explanation": "alleviate 是缓解，不保证彻底消除。",
        "checklist": []
      },
      {
        "id": "academic-resources-3",
        "context": "The evidence indicates a correlation between sleep and memory.",
        "prompt": "What does “a correlation” express?",
        "choices": [
          "an association",
          "proof that sleep is the only cause",
          "no connection"
        ],
        "answers": [
          "an association"
        ],
        "explanation": "correlation 表示相关，不能直接推出单一因果关系。",
        "checklist": []
      },
      {
        "id": "academic-resources-4",
        "context": "The report assesses the feasibility of the proposal.",
        "prompt": "What is the report evaluating?",
        "choices": [
          "whether the proposal can be carried out",
          "whether the proposal has already succeeded",
          "who first invented the proposal"
        ],
        "answers": [
          "whether the proposal can be carried out"
        ],
        "explanation": "feasibility 是可行性，评估能否实施。",
        "checklist": []
      }
    ]
  },
  {
    "key": "builtin:trend-precision",
    "stamp": "original-1",
    "materialId": null,
    "kind": "paraphrase",
    "skill": "reading",
    "title": "同义替换：趋势与程度",
    "description": "自编改编训练：在具体语境中判断替换表达，不把近义词当作任何语境都可互换。",
    "minutes": 5,
    "topics": [
      "paraphrase",
      "同义替换",
      "词汇"
    ],
    "source": "JiawenLex 自编训练；非官方考试题",
    "permission": "项目原创示例，供成员学习与练习。",
    "origin": "adapted",
    "items": [
      {
        "id": "trend-precision-1",
        "context": "Sales remained stable throughout the period.",
        "prompt": "Which description preserves the trend?",
        "choices": [
          "Sales changed dramatically.",
          "Sales showed little overall change.",
          "Sales doubled."
        ],
        "answers": [
          "Sales showed little overall change."
        ],
        "explanation": "stable 表示基本稳定，不能替换为大幅变化。",
        "checklist": []
      },
      {
        "id": "trend-precision-2",
        "context": "Only a minority of respondents supported the plan.",
        "prompt": "Which phrase preserves the quantity?",
        "choices": [
          "fewer than half of the respondents",
          "every respondent",
          "most respondents"
        ],
        "answers": [
          "fewer than half of the respondents"
        ],
        "explanation": "a minority 少于半数，不是大多数或全部。",
        "checklist": []
      },
      {
        "id": "trend-precision-3",
        "context": "Demand rose sharply before levelling off.",
        "prompt": "Which sequence matches the statement?",
        "choices": [
          "a rapid rise followed by stability",
          "a decline followed by a rise",
          "stability followed by a fall"
        ],
        "answers": [
          "a rapid rise followed by stability"
        ],
        "explanation": "rose sharply 为快速上升；level off 为趋于平稳。",
        "checklist": []
      },
      {
        "id": "trend-precision-4",
        "context": "The improvement was modest rather than dramatic.",
        "prompt": "Which description matches “modest”?",
        "choices": [
          "relatively small",
          "extremely large",
          "completely absent"
        ],
        "answers": [
          "relatively small"
        ],
        "explanation": "modest improvement 表示幅度较小的改善，不是没有改善。",
        "checklist": []
      }
    ]
  },
  {
    "key": "builtin:logic-causation",
    "stamp": "original-1",
    "materialId": null,
    "kind": "paraphrase",
    "skill": "reading",
    "title": "阅读定位：逻辑与范围",
    "description": "自编改编训练：在具体语境中判断替换表达，不把近义词当作任何语境都可互换。",
    "minutes": 5,
    "topics": [
      "paraphrase",
      "同义替换",
      "词汇"
    ],
    "source": "JiawenLex 自编训练；非官方考试题",
    "permission": "项目原创示例，供成员学习与练习。",
    "origin": "adapted",
    "items": [
      {
        "id": "logic-causation-1",
        "context": "The programme may reduce energy consumption.",
        "prompt": "Which statement has the same certainty?",
        "choices": [
          "It is possible that the programme will reduce energy use.",
          "The programme is guaranteed to eliminate energy use.",
          "The programme has already failed."
        ],
        "answers": [
          "It is possible that the programme will reduce energy use."
        ],
        "explanation": "may 表示可能，不是保证。",
        "checklist": []
      },
      {
        "id": "logic-causation-2",
        "context": "The results apply only to adults living in cities.",
        "prompt": "Which group is covered?",
        "choices": [
          "all children worldwide",
          "urban adults",
          "every rural resident"
        ],
        "answers": [
          "urban adults"
        ],
        "explanation": "only 限定范围：城市中的成年人。",
        "checklist": []
      },
      {
        "id": "logic-causation-3",
        "context": "Despite the higher cost, many customers chose the service.",
        "prompt": "Which relationship is expressed?",
        "choices": [
          "contrast",
          "cause and effect",
          "a sequence of dates"
        ],
        "answers": [
          "contrast"
        ],
        "explanation": "despite 引出让步：虽然价格更高，仍有很多人选择。",
        "checklist": []
      },
      {
        "id": "logic-causation-4",
        "context": "Participants must register unless they have already booked online.",
        "prompt": "Who is exempt from registering again?",
        "choices": [
          "those who booked online already",
          "all new visitors",
          "people who have never booked"
        ],
        "answers": [
          "those who booked online already"
        ],
        "explanation": "unless 引出例外条件：已在线预订者不用再次登记。",
        "checklist": []
      }
    ]
  },
  {
    "key": "builtin:agreement-structure",
    "stamp": "original-1",
    "materialId": null,
    "kind": "rewrite",
    "skill": "writing",
    "title": "句子改写：主谓与结构",
    "description": "自编改编短练习：先改写，再核对参考表达并自评。不同准确写法均可。",
    "minutes": 6,
    "topics": [
      "grammar",
      "语法",
      "coherence",
      "连贯"
    ],
    "source": "JiawenLex 自编训练；非官方考试题",
    "permission": "项目原创示例，供成员学习与练习。",
    "origin": "adapted",
    "items": [
      {
        "id": "agreement-structure-1",
        "context": "The quality of the courses depend on the teachers.",
        "prompt": "Correct the subject–verb agreement.",
        "choices": [],
        "answers": [
          "The quality of the courses depends on the teachers."
        ],
        "explanation": "主语中心词 quality 为单数，介词短语不改变主语数。",
        "checklist": [
          "按题干要求修改",
          "保留未要求修改的原意",
          "句子结构与语法完整"
        ]
      },
      {
        "id": "agreement-structure-2",
        "context": "Many student believes that technology saves time.",
        "prompt": "Correct the noun and verb forms.",
        "choices": [],
        "answers": [
          "Many students believe that technology saves time."
        ],
        "explanation": "many 后用复数名词，复数主语对应 believe。",
        "checklist": [
          "按题干要求修改",
          "保留未要求修改的原意",
          "句子结构与语法完整"
        ]
      },
      {
        "id": "agreement-structure-3",
        "context": "This method is more easier to use.",
        "prompt": "Correct the comparative form.",
        "choices": [],
        "answers": [
          "This method is easier to use."
        ],
        "explanation": "easier 已是比较级，不再加 more。",
        "checklist": [
          "按题干要求修改",
          "保留未要求修改的原意",
          "句子结构与语法完整"
        ]
      },
      {
        "id": "agreement-structure-4",
        "context": "Governments should invests in public transport.",
        "prompt": "Correct the verb form after the modal.",
        "choices": [],
        "answers": [
          "Governments should invest in public transport."
        ],
        "explanation": "情态动词 should 后接动词原形。",
        "checklist": [
          "按题干要求修改",
          "保留未要求修改的原意",
          "句子结构与语法完整"
        ]
      }
    ]
  },
  {
    "key": "builtin:cautious-claims",
    "stamp": "original-1",
    "materialId": null,
    "kind": "rewrite",
    "skill": "writing",
    "title": "写作改写：准确限定",
    "description": "自编改编短练习：先改写，再核对参考表达并自评。不同准确写法均可。",
    "minutes": 6,
    "topics": [
      "grammar",
      "语法",
      "coherence",
      "连贯"
    ],
    "source": "JiawenLex 自编训练；非官方考试题",
    "permission": "项目原创示例，供成员学习与练习。",
    "origin": "adapted",
    "items": [
      {
        "id": "cautious-claims-1",
        "context": "Online learning always improves educational outcomes.",
        "prompt": "Rewrite the claim to express possibility rather than certainty.",
        "choices": [],
        "answers": [
          "Online learning may improve educational outcomes."
        ],
        "explanation": "may 表示可能，避免无依据的 always。",
        "checklist": [
          "按题干要求修改",
          "保留未要求修改的原意",
          "句子结构与语法完整"
        ]
      },
      {
        "id": "cautious-claims-2",
        "context": "Every learner prefers studying alone.",
        "prompt": "Make the claim less absolute by referring to some learners.",
        "choices": [],
        "answers": [
          "Some learners prefer studying alone."
        ],
        "explanation": "任务要求减少绝对化，some 不代表全部。",
        "checklist": [
          "按题干要求修改",
          "保留未要求修改的原意",
          "句子结构与语法完整"
        ]
      },
      {
        "id": "cautious-claims-3",
        "context": "City residents use public transport more frequently.",
        "prompt": "Rewrite using “tend to” while preserving the proposed direction.",
        "choices": [],
        "answers": [
          "City residents tend to use public transport more frequently."
        ],
        "explanation": "tend to 表达趋势，不能改写成每个居民必然如此。",
        "checklist": [
          "按题干要求修改",
          "保留未要求修改的原意",
          "句子结构与语法完整"
        ]
      },
      {
        "id": "cautious-claims-4",
        "context": "Screen time and poor sleep are associated. This association does not prove causation.",
        "prompt": "Combine these ideas without claiming a causal link.",
        "choices": [],
        "answers": [
          "Screen time is associated with poor sleep, but this association does not prove causation."
        ],
        "explanation": "相关不等于因果，but 保留限制。",
        "checklist": [
          "按题干要求修改",
          "保留未要求修改的原意",
          "句子结构与语法完整"
        ]
      }
    ]
  },
  {
    "key": "builtin:cohesion-contrast",
    "stamp": "original-1",
    "materialId": null,
    "kind": "rewrite",
    "skill": "writing",
    "title": "句子改写：衔接与比较",
    "description": "自编改编短练习：先改写，再核对参考表达并自评。不同准确写法均可。",
    "minutes": 6,
    "topics": [
      "grammar",
      "语法",
      "coherence",
      "连贯"
    ],
    "source": "JiawenLex 自编训练；非官方考试题",
    "permission": "项目原创示例，供成员学习与练习。",
    "origin": "adapted",
    "items": [
      {
        "id": "cohesion-contrast-1",
        "context": "The scheme is expensive. It could benefit local residents.",
        "prompt": "Join the ideas with “although”.",
        "choices": [],
        "answers": [
          "Although the scheme is expensive, it could benefit local residents."
        ],
        "explanation": "although 表达让步，保留可能受益的 could。",
        "checklist": [
          "按题干要求修改",
          "保留未要求修改的原意",
          "句子结构与语法完整"
        ]
      },
      {
        "id": "cohesion-contrast-2",
        "context": "The first group preferred buses. The second group preferred trains.",
        "prompt": "Combine these sentences using “whereas”.",
        "choices": [],
        "answers": [
          "The first group preferred buses, whereas the second group preferred trains."
        ],
        "explanation": "whereas 清楚连接两组偏好的对比。",
        "checklist": [
          "按题干要求修改",
          "保留未要求修改的原意",
          "句子结构与语法完整"
        ]
      },
      {
        "id": "cohesion-contrast-3",
        "context": "Because public transport is reliable. More people use it.",
        "prompt": "Correct the sentence fragment.",
        "choices": [],
        "answers": [
          "Because public transport is reliable, more people use it."
        ],
        "explanation": "because 引导从句需要与主句组合。",
        "checklist": [
          "按题干要求修改",
          "保留未要求修改的原意",
          "句子结构与语法完整"
        ]
      },
      {
        "id": "cohesion-contrast-4",
        "context": "The city introduced a cycle scheme and a parking fee. It reduced traffic.",
        "prompt": "Replace “it” with “the parking fee”, which is the intended referent.",
        "choices": [],
        "answers": [
          "The city introduced a cycle scheme and a parking fee. The parking fee reduced traffic."
        ],
        "explanation": "题干已说明指代 parking fee；明确指代，保留两项措施。",
        "checklist": [
          "按题干要求修改",
          "保留未要求修改的原意",
          "句子结构与语法完整"
        ]
      }
    ]
  }
];
