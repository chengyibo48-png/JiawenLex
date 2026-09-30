/** Used before publishing or applying an answer correction. Legacy text variants remain valid. */
export function validateQuestionAnswers(question: Record<string, unknown>, answers: string[]) {
  const name = String(question.id ?? "");
  const choices = Array.isArray(question.choices) ? question.choices : [];
  if (question.answer_mode === "open" && answers.length) throw new Error(`开放回答 ${name} 不应设置唯一正确答案`);
  if (question.answer_mode === "single_choice" && answers.length && (answers.length !== 1 || !choices.includes(answers[0]))) throw new Error(`题目 ${name} 单选答案与选项不匹配`);
  if (question.answer_mode === "multi_choice" && (new Set(answers).size !== answers.length || answers.some((answer) => !choices.includes(answer)))) throw new Error(`题目 ${name} 多选答案重复或与选项不匹配`);
}
