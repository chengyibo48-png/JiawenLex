import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { validateQuestionAnswers } from "@/lib/question-answers";

const CreateReport = z.object({
  materialId: z.string().uuid(),
  questionId: z.string().trim().min(1).max(160),
  expectedPrompt: z.string().min(1).max(4000),
  expectedAnswers: z.array(z.string().max(4000)).max(100),
  expectedExplanation: z.string().max(4000),
  materialRevision: z.number().int().positive().optional(),
  errorKind: z.enum(["answer", "spelling", "grammar", "missing", "other"]),
  comment: z.string().trim().max(2000).default(""),
  suggestedPrompt: z.string().trim().min(1).max(4000).optional(),
  suggestedAnswers: z.array(z.string().trim().min(1).max(4000)).max(100).optional(),
  suggestedExplanation: z.string().max(4000).optional(),
});

const ReviewReport = z.object({
  reportId: z.string().uuid(),
  action: z.enum(["apply", "reject"]),
  suggestedPrompt: z.string().trim().min(1).max(4000).nullable().optional(),
  suggestedAnswers: z.array(z.string().trim().min(1).max(4000)).max(100).nullable().optional(),
  suggestedExplanation: z.string().max(4000).nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const status = new URL(request.url).searchParams.get("status") ?? "open";
    if (status !== "open" && status !== "all") throw new HttpError(400, "Invalid report status");
    let query = admin.from("question_error_reports").select("id,material_id,question_id,reporter_id,error_kind,comment,original_question,suggested_prompt,suggested_answers,suggested_explanation,status,created_at,updated_at,applied_at")
      .eq("owner_id", userId).order("created_at", { ascending: false }).limit(300);
    if (status === "open") query = query.eq("status", "pending");
    const { data: reports, error } = await query;
    if (error) throw error;
    const materialIds = [...new Set((reports ?? []).map((item) => item.material_id))];
    let materials: { id: string; title: string; prompt: string; questions: unknown }[] = [];
    if (materialIds.length) {
      const result = await admin.from("materials").select("id,title,prompt,questions").eq("owner_id", userId).in("id", materialIds);
      if (result.error) throw result.error;
      materials = result.data ?? [];
    }
    const materialById = new Map(materials.map((item) => [item.id, item]));
    const items = (reports ?? []).map((report) => {
      const material = materialById.get(report.material_id);
      const questions = Array.isArray(material?.questions) ? material.questions as Record<string, unknown>[] : [];
      const question = questions.find((item) => item.id === report.question_id);
      return {
        ...report,
        material_title: material?.title ?? "（题目已删除）",
        current_prompt: report.question_id === "__material_prompt__"
          ? (typeof material?.prompt === "string" ? material.prompt : null)
          : typeof question?.prompt === "string" ? question.prompt : null,
      };
    });
    return NextResponse.json({ reports: items });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const { userId, profile, admin } = await requireUser(request);
    const input = CreateReport.parse(await request.json());
    const { data: material, error } = await admin.from("materials")
      .select("id,owner_id,visibility,approval,questions,prompt,revision")
      .eq("id", input.materialId).maybeSingle();
    if (error) throw error;
    if (!material) throw new HttpError(404, "Practice material unavailable");
    const { data: grant, error: grantError } = await admin.from("share_grants").select("id")
      .eq("target_type", "material").eq("target_id", material.id).eq("recipient_id", userId)
      .is("revoked_at", null).limit(1).maybeSingle();
    if (grantError) throw grantError;
    const canAccess = material.owner_id === userId ||
      (material.visibility === "shared" && material.approval === "approved") ||
      (profile.role === "admin" && material.visibility === "shared") || !!grant;
    if (!canAccess) throw new HttpError(403, "Practice material access denied");
    if (input.materialRevision !== undefined && input.materialRevision !== material.revision)
      throw new HttpError(409, "This prompt version has changed. Open the current prompt before suggesting an edit.");
    const questions = Array.isArray(material.questions) ? material.questions as Record<string, unknown>[] : [];
    const isMaterialPrompt = input.questionId === "__material_prompt__";
    const currentQuestion = isMaterialPrompt
      ? { prompt: material.prompt, answers: [] as string[], explanation: "" }
      : questions.find((question) => question.id === input.questionId);
    if (!currentQuestion) throw new HttpError(404, "Question unavailable");
    if (input.suggestedAnswers !== undefined) {
      try { validateQuestionAnswers(currentQuestion, input.suggestedAnswers); }
      catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Invalid corrected answer"); }
    }
    const currentAnswers = Array.isArray(currentQuestion.answers) ? currentQuestion.answers.filter((value): value is string => typeof value === "string") : [];
    if (currentQuestion.prompt !== input.expectedPrompt || JSON.stringify(currentAnswers) !== JSON.stringify(input.expectedAnswers) || String(currentQuestion.explanation ?? "") !== input.expectedExplanation)
      throw new HttpError(409, "This question changed. Reload the exercise and enter the correction again.");
    if (isMaterialPrompt && (input.suggestedAnswers !== undefined || input.suggestedExplanation !== undefined))
      throw new HttpError(400, "A writing or speaking prompt can only include a prompt correction");
    if (!input.comment && input.suggestedPrompt === undefined && input.suggestedAnswers === undefined && input.suggestedExplanation === undefined)
      throw new HttpError(400, "Add a note or a correction before submitting");

    const { data, error: submitError } = await admin.rpc("submit_question_error_report", {
      p_material_id: input.materialId,
      p_question_id: input.questionId,
      p_reporter_id: userId,
      p_error_kind: input.errorKind,
      p_comment: input.comment,
      p_expected_question: { prompt: input.expectedPrompt, answers: input.expectedAnswers, explanation: input.expectedExplanation },
      p_suggested_prompt: input.suggestedPrompt ?? null,
      p_suggested_answers: input.suggestedAnswers ?? null,
      p_suggested_explanation: input.suggestedExplanation ?? null,
    });
    if (submitError) {
      if (/question_changed_since_report/.test(submitError.message)) throw new HttpError(409, "This question changed. Reload the exercise and enter the correction again.");
      throw submitError;
    }
    const result = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ reportId: result.report_id, directEdit: result.direct_edit }, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const input = ReviewReport.parse(await request.json());
    if (input.action === "reject") {
      const { data, error } = await admin.from("question_error_reports").update({ status: "rejected", updated_at: new Date().toISOString() })
        .eq("id", input.reportId).eq("owner_id", userId).eq("status", "pending").select("id");
      if (error) throw error;
      if (!data?.length) throw new HttpError(409, "Report is unavailable or already closed");
      return NextResponse.json({ rejected: true });
    }
    const report = await admin.from("question_error_reports").select("material_id,question_id,suggested_answers").eq("id", input.reportId).eq("owner_id", userId).eq("status", "pending").maybeSingle();
    if (report.error) throw report.error;
    if (!report.data) throw new HttpError(409, "Report unavailable or already closed");
    const currentReport = report.data;
    const correctedAnswers = input.suggestedAnswers ?? currentReport.suggested_answers;
    if (Array.isArray(correctedAnswers)) {
      const material = await admin.from("materials").select("questions").eq("id", report.data.material_id).eq("owner_id", userId).maybeSingle();
      if (material.error) throw material.error;
      const question = (Array.isArray(material.data?.questions) ? material.data.questions : []).find((q) => q.id === currentReport.question_id);
      if (question) {
        try { validateQuestionAnswers(question, correctedAnswers); }
        catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Invalid corrected answer"); }
      }
    }
    const { error } = await admin.rpc("apply_question_error_report", {
      p_report_id: input.reportId,
      p_reviewer_id: userId,
      p_suggested_prompt: input.suggestedPrompt ?? null,
      p_suggested_answers: input.suggestedAnswers ?? null,
      p_suggested_explanation: input.suggestedExplanation ?? null,
    });
    if (error) {
      if (/question_changed_since_report|report_already_closed|report_unavailable|question_unavailable|material_unavailable|no_correction_provided/.test(error.message))
        throw new HttpError(409, "This report is stale or has no usable correction. Reload the question and review it again.");
      throw error;
    }
    return NextResponse.json({ applied: true });
  } catch (error) { return apiError(error); }
}
