import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import type { AttemptReview } from "@/lib/review";
const Note = z.object({
  action: z.literal("note"),
  id: z.string().uuid(),
  questionId: z.string().max(100),
  version: z.number().int().positive(),
  reason: z.enum([
    "",
    "locating",
    "paraphrase",
    "meaning",
    "spelling",
    "word_limit",
    "unanswered",
    "other",
  ]),
  note: z.string().max(2000),
});
const Word = z.object({
  action: z.literal("word"),
  id: z.string().uuid(),
  questionId: z.string().max(100),
  term: z.string().trim().min(1).max(160),
  definition: z.string().trim().min(1).max(2000),
  mergeId: z.string().uuid().nullable().default(null),
});
const Task = z.object({
  action: z.literal("schedule"),
  id: z.string().uuid(),
  questionId: z.string().max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minutes: z.number().int().min(5).max(60),
});
const Spelling = z
  .object({
    action: z.literal("spelling"),
    id: z.string().uuid(),
    total: z.number().int().min(1).max(20),
    correct: z.number().int().min(0).max(20),
    wrongWordIds: z.array(z.string().uuid()).max(20),
  })
  .refine(
    (x) =>
      x.correct <= x.total &&
      new Set(x.wrongWordIds).size === x.wrongWordIds.length &&
      x.wrongWordIds.length === x.total - x.correct,
  );
const Input = z.union([Note, Word, Task, Spelling]);
export async function POST(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const input = Input.parse(await request.json());
    if (input.action === "spelling") {
      if (input.wrongWordIds.length) {
        const owned = await admin
          .from("vocabulary")
          .select("id")
          .eq("owner_id", userId)
          .in("id", input.wrongWordIds);
        if (owned.error) throw owned.error;
        if (owned.data.length !== input.wrongWordIds.length)
          throw new HttpError(403, "Word unavailable");
      }
      const row = {
        id: input.id,
        owner_id: userId,
        total: input.total,
        correct: input.correct,
        wrong_word_ids: input.wrongWordIds,
      };
      const saved = await admin.from("spelling_sessions").insert(row);
      if (saved.error && saved.error.code !== "23505") throw saved.error;
      return NextResponse.json({ id: input.id });
    }
    const read = await admin
      .from("attempt_reviews")
      .select("*")
      .eq("id", input.id)
      .eq("owner_id", userId)
      .maybeSingle();
    if (read.error) throw read.error;
    const review = read.data as AttemptReview | null;
    if (
      !review ||
      !review.snapshot.questions.some((q) => q.id === input.questionId)
    )
      throw new HttpError(
        404,
        "复盘原始内容已清理或题目不存在 / Review unavailable",
      );
    if (input.action === "note") {
      if (review.version !== input.version)
        return NextResponse.json(
          {
            error:
              "另一台设备已修改复盘，请加载云端后重新保存；当前输入仍保留 / Review conflict; input retained",
            review,
          },
          { status: 409 },
        );
      const notes = {
        ...review.notes,
        [input.questionId]: { reason: input.reason, note: input.note },
      };
      const saved = await admin
        .from("attempt_reviews")
        .update({
          notes,
          version: input.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.id)
        .eq("owner_id", userId)
        .eq("version", input.version)
        .select("*")
        .maybeSingle();
      if (saved.error) throw saved.error;
      if (!saved.data)
        throw new HttpError(
          409,
          "Review conflict; reload and retry. Input retained.",
        );
      return NextResponse.json({ review: saved.data });
    }
    if (input.action === "word") {
      const result = await admin.rpc("add_review_word", {
        member: userId,
        review_id: input.id,
        qid: input.questionId,
        word: input.term.replace(/\s+/g, " "),
        meaning: input.definition,
        merge_id: input.mergeId,
      });
      if (result.error) throw new HttpError(409, result.error.message);
      return NextResponse.json({ id: result.data });
    }
    const date = new Date(input.date + "T12:00:00Z");
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.date
    )
      throw new HttpError(400, "Invalid date");
    const result = await admin.rpc("schedule_question_review", {
      member: userId,
      review_id: input.id,
      qid: input.questionId,
      planned: input.date,
      task_minutes: input.minutes,
    });
    if (result.error)
      throw new HttpError(
        409,
        result.error.message === "weekly_budget_exceeded"
          ? "这一周已达到学习时长预算，请改期或先调整未完成任务 / Weekly budget reached; reschedule or adjust pending tasks"
          : result.error.message,
      );
    return NextResponse.json({ id: result.data });
  } catch (error) {
    return apiError(error);
  }
}
