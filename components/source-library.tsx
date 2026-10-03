"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Check, FileText, Pause, RefreshCw, Upload, Users, X } from "lucide-react";
import { apiFetch } from "@/lib/supabase";
import type { Language } from "@/lib/types";
import { t } from "./workspace";

type SourceDocument = {
  id: string; title: string; original_name: string; byte_size: number; sha256: string;
  page_count: number | null; source_title: string; author: string; source_year: number | null;
  skill: string | null; skill_tags?: string[]; content_kind: string; license_name: string; rights_attestation?: string; parse_status: string;
  parsed_pages: number; status: string; created_at: string; members_visible: boolean; canManageSharing: boolean;
};
type UploadItem = { id: string; name: string; size: number; state: "queued" | "hashing" | "uploading" | "paused" | "done" | "error"; progress: number; error?: string };
type ReviewCandidate = {
  id: string; document_id: string; physical_page: number; printed_page: string;
  section_title: string; content_kind: string; status: string; payload: Record<string, unknown>;
};
type ReviewDocument = { id: string; title: string; original_name: string; page_count: number | null };
type Props = { mode: "originals" | "review"; client: SupabaseClient | null; lang: Language; notify: (message: string) => void; isAdmin?: boolean };
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const sourceLabels: Record<string, string> = {
  reading: "阅读", listening: "听力", writing: "写作", speaking: "口语",
  questions: "练习题目", question: "练习题目", vocabulary: "词汇", reference: "参考与方法", plan: "学习计划", mixed: "综合资料", unknown: "待分类",
  open: "待处理", pending: "待审核", edited: "已修改", published: "已发布", rejected: "已退回", all: "全部状态",
  page_text: "原页文字", note: "方法笔记", reference_answer: "参考答案", figure: "图表",
};
const sourceLabel = (lang: Language, value: string) => t(lang, sourceLabels[value] ?? value, value);

const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

async function stableImportKey(documentId: string, parser: string, parserVersion: string, totalPages: number, parsedPages: number, items: unknown[]) {
  const bytes = new TextEncoder().encode(JSON.stringify([documentId, parser, parserVersion, totalPages, parsedPages, items]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  digest[6] = (digest[6] & 15) | 0x50;
  digest[8] = (digest[8] & 63) | 0x80;
  const hex = Array.from(digest.slice(0, 16), (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function PageAuditControls({ client, lang, documentId, physicalPage, notify }: { client: SupabaseClient; lang: Language; documentId: string; physicalPage: number; notify: (message: string) => void }) {
  const [summary, setSummary] = useState<{ totalPages: number; extracted: number; nonExercise: number; pending: number; current: { status: string; note: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const auditSequence = useRef(0);
  const refresh = useCallback(() => {
    const sequence = ++auditSequence.current;
    setSummary(null);
    void apiFetch(client, `/api/source-review?pageAuditDocumentId=${documentId}&pageAuditPhysicalPage=${physicalPage}`)
      .then(value => { if (sequence === auditSequence.current) setSummary(value as typeof summary); })
      .catch(() => { if (sequence === auditSequence.current) setSummary(null); });
  }, [client, documentId, physicalPage]);
  useEffect(() => { refresh(); return () => { auditSequence.current++; }; }, [refresh]);
  async function mark(status: "extracted" | "non_exercise" | "pending") {
    setBusy(true);
    try {
      await apiFetch(client, "/api/source-review", { method: "POST", body: JSON.stringify({ documentId, physicalPage, status,
        note: status === "extracted" ? "人工核对完成" : status === "non_exercise" ? "人工确认本页无练习内容" : "需要继续核验" }) });
      refresh();
      notify(t(lang, "页面处理状态已更新", "Page status updated"));
    } catch (error) { notify(error instanceof Error ? error.message : t(lang, "更新页面状态失败", "Could not update page status")); }
    finally { setBusy(false); }
  }
  return <section className="card"><strong>{t(lang, `第 ${physicalPage} 页处理状态`, `Page ${physicalPage} review status`)}</strong>
    {summary && <p className="muted small">{t(lang, "本页", "This page")}：{summary.current.status === "extracted" ? t(lang, "已核对", "Reviewed") : summary.current.status === "non_exercise" ? t(lang, "非练习", "Non exercise") : t(lang, "待处理", "Pending")} · {t(lang, "已提取", "Extracted")} {summary.extracted} · {t(lang, "非练习", "Non exercise")} {summary.nonExercise} · {t(lang, "待处理", "Pending")} {summary.pending} / {summary.totalPages}</p>}
    <div className="button-row"><button className="button secondary small" disabled={busy} onClick={() => void mark("extracted")}>{t(lang, "标记已核对", "Mark reviewed")}</button><button className="button secondary small" disabled={busy} onClick={() => void mark("non_exercise")}>{t(lang, "本页非练习", "No exercise on page")}</button><button className="button secondary small" disabled={busy} onClick={() => void mark("pending")}>{t(lang, "留待处理", "Keep pending")}</button></div></section>;
}

export function SourceLibraryPanel({ mode, client, lang, notify, isAdmin = false }: Props) {
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [capacity, setCapacity] = useState<{ usedBytes: number; maxBytes: number; maxFileBytes: number } | null>(null);
  const [mineruConnection, setMineruConnection] = useState<{ documentId: string; token: string; expiresAt: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [archiveMeta, setArchiveMeta] = useState({ sourceTitle: "", author: "", sourceYear: "", skill: "", skillTags: [] as string[], contentKind: "unknown", licenseName: "", sourceUrl: "" });
  const [docSearch, setDocSearch] = useState("");
  const [docKindFilter, setDocKindFilter] = useState("all");
  const [docSkillFilter, setDocSkillFilter] = useState("all");
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [review, setReview] = useState<ReviewCandidate[]>([]);
  const [reviewDocuments, setReviewDocuments] = useState<ReviewDocument[]>([]);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewCount, setReviewCount] = useState(0);
  const [reviewStatus, setReviewStatus] = useState("open");
  const [reviewDocumentFilter, setReviewDocumentFilter] = useState("");
  const [auditPhysicalPage, setAuditPhysicalPage] = useState(1);
  const [reviewSkillFilter, setReviewSkillFilter] = useState("");
  const [reviewContentFilter, setReviewContentFilter] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [payloadText, setPayloadText] = useState("");
  const [reviewKind, setReviewKind] = useState<ReviewCandidate["content_kind"]>("page_text");
  const [confirmedSource, setConfirmedSource] = useState(false);
  const [confirmedAnswers, setConfirmedAnswers] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewPhysicalPage, setPreviewPhysicalPage] = useState(1);
  const [importTarget, setImportTarget] = useState("");
  const [importing, setImporting] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingLicenseId, setEditingLicenseId] = useState<string | null>(null);
  const [licenseDraft, setLicenseDraft] = useState("");
  const [savingLicense, setSavingLicense] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const uploadLock = useRef(false);
  const loadSequence = useRef(0);
  const importInput = useRef<HTMLInputElement>(null);
  const selectedCandidate = review.find((item) => item.id === selectedCandidateId) ?? null;
  const documentById = new Map(reviewDocuments.map((document) => [document.id, document]));
  const filteredDocuments = documents.filter((document) =>
    (docKindFilter === "all" || document.content_kind === docKindFilter) &&
    (docSkillFilter === "all" || (document.skill_tags?.length ? document.skill_tags.includes(docSkillFilter) : document.skill === docSkillFilter)) &&
    `${document.title} ${document.original_name} ${document.source_title} ${document.author} ${document.source_year ?? ""}`.toLowerCase().includes(docSearch.toLowerCase()),
  );

  const refreshDocuments = useCallback(async () => {
    if (!client) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const result = await apiFetch(client, "/api/source-documents") as { documents: SourceDocument[]; capacity: typeof capacity };
      if (sequence !== loadSequence.current) return;
      setDocuments(result.documents ?? []);
      setCapacity(result.capacity ?? null);
      setImportTarget(previous => previous || result.documents?.find(item => item.status === "ready" && item.canManageSharing)?.id || "");
    } catch (error) {
      if (sequence === loadSequence.current) setLoadError(error instanceof Error ? error.message : "无法读取资料库");
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [client]);

  const refreshReview = useCallback(async () => {
    if (!client) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const search = new URLSearchParams({ status: reviewStatus, page: String(reviewPage), pageSize: "30" });
      if (reviewDocumentFilter) search.set("documentId", reviewDocumentFilter);
      if (reviewSkillFilter) search.set("skill", reviewSkillFilter);
      if (reviewContentFilter) search.set("kind", reviewContentFilter);
      const [result, archived] = await Promise.all([
        apiFetch(client, `/api/source-review?${search}`) as Promise<{ candidates: ReviewCandidate[]; documents: ReviewDocument[]; count: number }>,
        apiFetch(client, "/api/source-documents?includeCapacity=false") as Promise<{ documents: SourceDocument[] }>,
      ]);
      if (sequence !== loadSequence.current) return;
      setReview(result.candidates ?? []);
      setReviewCount(result.count ?? 0);
      setReviewDocuments(result.documents ?? []);
      setDocuments(archived.documents ?? []);
      setImportTarget(previous => previous || archived.documents?.find(item => item.status === "ready" && item.canManageSharing)?.id || "");
      setSelectedCandidateId(previous => previous && result.candidates.some(candidate => candidate.id === previous) ? previous : null);
    } catch (error) {
      if (sequence === loadSequence.current) setLoadError(error instanceof Error ? error.message : "无法读取审核队列");
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [client, reviewPage, reviewStatus, reviewDocumentFilter, reviewSkillFilter, reviewContentFilter]);

  useEffect(() => {
    if (mode === "originals") void refreshDocuments();
    else void refreshReview();
    return () => { loadSequence.current++; };
  }, [mode, refreshDocuments, refreshReview]);

  useEffect(() => {
    setPayloadText(selectedCandidate ? JSON.stringify(selectedCandidate.payload, null, 2) : "");
    setReviewKind((selectedCandidate?.content_kind as ReviewCandidate["content_kind"]) ?? "page_text");
    setConfirmedSource(false);
    setConfirmedAnswers(false);
    setPreviewUrl("");
    setPreviewPhysicalPage(selectedCandidate?.physical_page ?? 1);
    if (!client || !selectedCandidate) return;
    let active = true;
    void apiFetch(client, `/api/source-documents/${selectedCandidate.document_id}/url`).then((value) => {
      if (active) setPreviewUrl((value as { url: string }).url);
    }).catch((error) => {
      if (active) setLoadError(error instanceof Error ? error.message : "无法打开原始 PDF");
    });
    return () => { active = false; };
  }, [client, selectedCandidate]);

  function updateQueue(id: string, update: Partial<UploadItem>) {
    setQueue((previous) => previous.map((item) => item.id === id ? { ...item, ...update } : item));
  }

  async function toggleDocumentSharing(document: SourceDocument) {
    if (!client || !document.canManageSharing || sharingId) return;
    const membersVisible = !document.members_visible;
    if (membersVisible && !window.confirm(t(lang,
      "组内所有有效成员都可以查看并打开这份原始 PDF。确认你有权向组内成员分享此资料。",
      "All active group members will be able to view and open this original PDF. Confirm you have permission to share it with the group.",
    ))) return;
    setSharingId(document.id);
    try {
      await apiFetch(client, `/api/source-documents/${document.id}/sharing`, { method: "PATCH", body: JSON.stringify({ membersVisible }) });
      setDocuments((current) => current.map((item) => item.id === document.id ? { ...item, members_visible: membersVisible } : item));
      notify(membersVisible ? t(lang, "已开放给组内成员", "Shared with group members") : t(lang, "已恢复为仅自己可见", "Private access restored"));
    } catch (error) { notify(error instanceof Error ? error.message : t(lang, "更新分享状态失败", "Could not update sharing")); }
    finally { setSharingId(null); }
  }

  async function deleteDocument(document: SourceDocument) {
    if (!client || !document.canManageSharing || deletingId) return;
    const warning = document.members_visible
      ? t(lang, `永久删除「${document.title}」的原始 PDF 及其历史版本？组内成员将立即失去访问权限。已发布练习仍保留，但原件链接会失效。`, `Permanently delete the original PDF and every stored version of “${document.title}”? Group members will lose access. Published exercises remain, but their original PDF link will stop working.`)
      : t(lang, `永久删除「${document.title}」的原始 PDF 及其历史版本？已发布练习仍保留，但原件链接会失效。`, `Permanently delete the original PDF and every stored version of “${document.title}”? Published exercises remain, but their original PDF link will stop working.`);
    if (!window.confirm(warning)) return;
    setDeletingId(document.id);
    try {
      await apiFetch(client, `/api/source-documents/${document.id}`, { method: "DELETE" });
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      if (importTarget === document.id) setImportTarget("");
      if (mineruConnection?.documentId === document.id) setMineruConnection(null);
      notify(t(lang, "原始 PDF 已删除", "Original PDF deleted"));
      await refreshDocuments();
    } catch (error) { notify(error instanceof Error ? error.message : t(lang, "删除失败，请重试", "Could not delete the PDF; retry")); }
    finally { setDeletingId(null); }
  }

  async function saveLicense(documentId: string) {
    if (!client || savingLicense) return;
    setSavingLicense(true);
    try {
      const result = await apiFetch(client, `/api/source-documents/${documentId}`, {
        method: "PATCH", body: JSON.stringify({ licenseName: licenseDraft.trim() }),
      }) as { licenseName: string };
      setDocuments((current) => current.map((item) => item.id === documentId ? { ...item, license_name: result.licenseName } : item));
      setEditingLicenseId(null);
      notify(t(lang, "授权依据已保存", "Permission notes saved"));
    } catch (error) { notify(error instanceof Error ? error.message : t(lang, "保存失败，请重试", "Could not save permission notes")); }
    finally { setSavingLicense(false); }
  }

  async function connectMinerU(documentId: string) {
    if (!client) return;
    try {
      const result = await apiFetch(client, `/api/source-documents/${documentId}/import-token`, { method: "POST", body: "{}" }) as { token: string; expiresAt: string; documentId: string };
      setMineruConnection(result);
      notify(t(lang, "本机 MinerU 连接令牌已生成，30 分钟后失效。", "Local MinerU token created; it expires in 30 minutes."));
    } catch (error) { notify(error instanceof Error ? error.message : "无法连接本机 MinerU"); }
  }

  function pauseUpload(id: string) {
    controllers.current.get(id)?.abort();
  }

  async function uploadFile(file: File, queueItem: UploadItem) {
    if (!client) throw new Error("请登录后上传");
    const controller = new AbortController();
    controllers.current.set(queueItem.id, controller);
    try {
      updateQueue(queueItem.id, { state: "hashing", progress: 0, error: "" });
      if (file.size > MAX_FILE_BYTES) throw new Error("单份 PDF 不能超过 512 MiB");
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
      const start = await apiFetch(client, "/api/source-documents", {
        method: "POST",
        body: JSON.stringify({ title: file.name.replace(/\.pdf$/i, ""), originalName: file.name, byteSize: file.size, sha256,
          contentKind: archiveMeta.contentKind, sourceTitle: archiveMeta.sourceTitle, author: archiveMeta.author,
          sourceYear: archiveMeta.sourceYear ? Number(archiveMeta.sourceYear) : null,
          skill: archiveMeta.skill || null, skillTags: archiveMeta.skillTags, licenseName: archiveMeta.licenseName, sourceUrl: archiveMeta.sourceUrl }),
        signal: controller.signal,
      }) as { documentId: string; uploadId: string; partSize: number };
      const session = await apiFetch(client, `/api/source-documents/uploads/${start.uploadId}`, { signal: controller.signal }) as {
        partSize: number; parts: { partNumber: number; etag: string }[];
      };
      const partCount = Math.ceil(file.size / session.partSize);
      const parts = new Map((session.parts ?? []).map((part) => [part.partNumber, part.etag]));
      let finished = parts.size;
      updateQueue(queueItem.id, { state: "uploading", progress: Math.round((finished / partCount) * 100) });
      let nextPart = 1;
      const uploadWorker = async () => {
        for (;;) {
          const partNumber = nextPart++;
          if (partNumber > partCount) return;
          if (parts.has(partNumber)) continue;
          if (controller.signal.aborted) throw new DOMException("Upload paused", "AbortError");
          const signed = await apiFetch(client, `/api/source-documents/uploads/${start.uploadId}/parts/${partNumber}`, { signal: controller.signal }) as { url: string };
          const begin = (partNumber - 1) * session.partSize;
          const response = await fetch(signed.url, { method: "PUT", body: file.slice(begin, Math.min(begin + session.partSize, file.size)), signal: controller.signal });
          if (!response.ok) throw new Error(`第 ${partNumber} 个分片上传失败 (${response.status})`);
          const etag = response.headers.get("ETag") ?? response.headers.get("etag");
          if (!etag) throw new Error("存储服务没有返回分片 ETag；请检查 bucket CORS 是否暴露 ETag");
          parts.set(partNumber, etag);
          finished++;
          updateQueue(queueItem.id, { progress: Math.round((finished / partCount) * 100) });
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, partCount) }, () => uploadWorker()));
      if (controller.signal.aborted) throw new DOMException("Upload paused", "AbortError");
      await apiFetch(client, `/api/source-documents/uploads/${start.uploadId}/complete`, {
        method: "POST", signal: controller.signal,
        body: JSON.stringify({ parts: [...parts].sort(([a], [b]) => a - b).map(([partNumber, etag]) => ({ partNumber, etag })) }),
      });
      updateQueue(queueItem.id, { state: "done", progress: 100 });
      await refreshDocuments();
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) updateQueue(queueItem.id, { state: "paused" });
      else updateQueue(queueItem.id, { state: "error", error: error instanceof Error ? error.message : "上传失败" });
    } finally { controllers.current.delete(queueItem.id); }
  }

  async function runQueue() {
    if (uploadLock.current || !client) return;
    uploadLock.current = true;
    try {
      for (const file of files) {
        const id = `${file.name}:${file.size}:${file.lastModified}`;
        const item = queue.find((candidate) => candidate.id === id);
        if (!item || ["done", "uploading"].includes(item.state)) continue;
        await uploadFile(file, item);
      }
    } finally { uploadLock.current = false; }
  }

  async function importMineruBundle(file: File) {
    if (!client || !importTarget) return;
    setImporting(true);
    try {
      const value = JSON.parse(await file.text()) as {
        sourceSha256?: string; sourceDocumentId?: string; format?: string; parser?: string; parserVersion?: string; totalPages?: number; parsedPages?: number;
        items?: { physicalPage: number; printedPage?: string; sectionTitle?: string; contentKind: string; payload: Record<string, unknown> }[];
      };
      if (value.format !== "jiawenlex-mineru-v1" || !Array.isArray(value.items) || !value.totalPages || value.parsedPages === undefined)
        throw new Error("文件格式无效。请使用 JiawenLex MinerU 审核包格式。");
      const original=documents.find(document=>document.id===importTarget);
      if(value.sourceDocumentId&&value.sourceDocumentId!==importTarget)throw new Error("审核包不是选中的原文件。");
      if(value.sourceSha256&&original?.sha256!==value.sourceSha256)throw new Error("审核包 SHA-256 与原文件不符。");
      let inserted = 0;
      for (let index = 0; index < value.items.length; index += 100) {
        const items = value.items.slice(index, index + 100);
        const parser = value.parser ?? "MinerU";
        const parserVersion = value.parserVersion ?? "";
        const idempotencyKey = await stableImportKey(importTarget, parser, parserVersion, value.totalPages, value.parsedPages, items);
        const result = await apiFetch(client, `/api/source-documents/${importTarget}/candidates`, {
          method: "POST",
          body: JSON.stringify({
            parser, parserVersion,
            totalPages: value.totalPages, parsedPages: value.parsedPages,
            idempotencyKey, items, sourceSha256:value.sourceSha256,
          }),
        }) as { inserted?: number };
        inserted += result.inserted ?? 0;
      }
      notify(t(lang, `已导入 ${inserted} 条待核验内容`, `${inserted} items added to review`));
      await refreshReview();
      if (importInput.current) importInput.current.value = "";
    } catch (error) {
      notify(error instanceof Error ? error.message : "无法导入 MinerU 审核包");
    } finally { setImporting(false); }
  }

  const [batchBusy,setBatchBusy]=useState(false);
  const [batchMessage,setBatchMessage]=useState("");
  const [groupPublish,setGroupPublish]=useState(false);
  const [administratorApproval,setAdministratorApproval]=useState(false);
  async function publishVerifiedBatch() {
    if(!client||batchBusy)return;
    setBatchBusy(true);setBatchMessage("");
    let completed=0,total=0;
    try {
      const ids:string[]=[];
      for(let page=1;;page++) {
        const search=new URLSearchParams({status:"open",page:String(page),pageSize:"100"});
        if(!administratorApproval)search.set("verified","true");
        if(reviewDocumentFilter)search.set("documentId",reviewDocumentFilter);
        if(reviewSkillFilter)search.set("skill",reviewSkillFilter);
        if(reviewContentFilter)search.set("kind",reviewContentFilter);
        const result=await apiFetch(client,`/api/source-review?${search}`) as {candidates:ReviewCandidate[];count:number};
        ids.push(...result.candidates.filter(c=>["question","vocabulary","note"].includes(c.content_kind)).map(c=>c.id));
        if(page*100>=result.count)break;
      }
      total=ids.length;
      if(!total){setBatchMessage(t(lang,"当前筛选下没有已核验的待发布内容。","No verified pending items match these filters."));return;}
      const errors:string[]=[];
      for(let offset=0;offset<total;offset+=20) {
        const result=await apiFetch(client,"/api/source-review/batch",{method:"POST",body:JSON.stringify({ids:ids.slice(offset,offset+20),shared:groupPublish,administratorApproval})}) as {published:number;results:{id:string;error?:string}[]};
        completed+=result.published;errors.push(...result.results.filter(r=>r.error).map(r=>`${r.id.slice(0,8)}: ${r.error}`));
        setBatchMessage(`${t(lang,"已发布","Published")}: ${completed} / ${total}`);
      }
      setBatchMessage(`${t(lang,"发布成功","Published")}: ${completed} / ${total}. `+errors.slice(0,10).join(" · "));
      await refreshReview();
    }catch(e){setBatchMessage(`${t(lang,"已发布","Published")}: ${completed} / ${total}. `+(e instanceof Error?e.message:"发布失败"));}finally{setBatchBusy(false);}
  }

  async function reviewAction(action: "save" | "reject" | "publish_question" | "publish_vocabulary" | "publish_guide") {
    if (!client || !selectedCandidate) return;
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(payloadText) as Record<string, unknown>; }
    catch { notify(t(lang, "内容必须是有效 JSON。", "Content must be valid JSON.")); return; }
    if (action === "publish_vocabulary" || action === "publish_guide") {
      if (!confirmedSource) { notify(t(lang, "请先对照原页核对词汇、释义与例句。", "Compare the term, definition and example with the PDF first.")); return; }
      payload = { ...payload, reviewed_against_pdf: true };
    }
    if (action === "publish_question") {
      if (!confirmedSource || !confirmedAnswers) {
        notify(t(lang, "请先对照原页核对题干、选项及答案来源，并勾选两项确认。", "Compare the question, options and answer source with the PDF, then confirm both checks."));
        return;
      }
      payload = { ...payload, reviewed_against_pdf: true, answer_alignment_checked: true,
        questions: Array.isArray(payload.questions) ? payload.questions.map((question) => ({ ...(question as Record<string, unknown>), verified: true })) : payload.questions };
    }
    try {
      await apiFetch(client, "/api/source-review", { method: "PATCH", body: JSON.stringify({ candidateId: selectedCandidate.id, action, contentKind: reviewKind, payload }) });
      notify(action.startsWith("publish") ? t(lang, "已发布并保留来源页码。", "Published with source page reference.") : action === "reject" ? t(lang, "已从待审核队列移除。", "Removed from the review queue.") : t(lang, "已保存修改。", "Changes saved."));
      await refreshReview();
    } catch (error) { notify(error instanceof Error ? error.message : "审核操作失败"); }
  }

  if (!client) return <section className="card"><p>{t(lang, "演示模式不连接云端资料库，请登录后使用。", "Sign in to use the private document archive.")}</p></section>;

  if (mode === "originals") return (
    <div className="source-library-stack">
      <section className="card source-upload-card">
        <div className="card-top"><div><h3>{t(lang, "添加原始 PDF", "Add original PDFs")}</h3><p className="muted small">{t(lang, "支持批量选择；上传会分片进行，可暂停后继续。最大单份 512 MiB。", "Select multiple files. Uploads are resumable and can be paused. Maximum 512 MiB each.")}</p></div><button className="icon-button" aria-label={t(lang, "刷新资料", "Refresh archive")} onClick={() => void refreshDocuments()}><RefreshCw size={17}/></button></div>
        <div className="form-grid source-metadata-grid">
          <label>{t(lang, "资料类别", "Content type")}<select value={archiveMeta.contentKind} onChange={(event) => setArchiveMeta((value) => ({ ...value, contentKind: event.target.value }))}><option value="unknown">{t(lang, "待分类", "Unclassified")}</option><option value="questions">{t(lang, "练习题目", "Practice questions")}</option><option value="vocabulary">{t(lang, "词汇资料", "Vocabulary")}</option><option value="reference">{t(lang, "参考与方法", "Reference")}</option><option value="plan">{t(lang, "备考计划", "Study plan")}</option><option value="mixed">{t(lang, "综合资料", "Mixed")}</option></select></label>
          <label>{t(lang, "科目", "Skill")}<select value={archiveMeta.skill} onChange={(event) => setArchiveMeta((value) => ({ ...value, skill: event.target.value }))}><option value="">{t(lang, "不指定", "Unspecified")}</option>{["reading", "listening", "writing", "speaking"].map((skill) => <option value={skill} key={skill}>{sourceLabel(lang, skill)}</option>)}</select></label>
          <fieldset className="source-skill-tags"><legend>{t(lang, "适用科目（可多选）", "Applicable skills")}</legend>{["reading", "listening", "writing", "speaking"].map((skill) => <label key={skill}><input type="checkbox" checked={archiveMeta.skillTags.includes(skill)} onChange={(event) => setArchiveMeta((value) => ({ ...value, skillTags: event.target.checked ? [...value.skillTags, skill] : value.skillTags.filter((item) => item !== skill) }))} />{sourceLabel(lang, skill)}</label>)}</fieldset>
          <label>{t(lang, "资料来源", "Source") }<input value={archiveMeta.sourceTitle} onChange={(event) => setArchiveMeta((value) => ({ ...value, sourceTitle: event.target.value }))} placeholder={t(lang, "例如出版社或机构", "Publisher or organisation")}/></label>
          <label>{t(lang, "作者", "Author")}<input value={archiveMeta.author} onChange={(event) => setArchiveMeta((value) => ({ ...value, author: event.target.value }))}/></label>
          <label>{t(lang, "出版年份", "Publication year")}<input type="number" min="1900" max="2200" value={archiveMeta.sourceYear} onChange={(event) => setArchiveMeta((value) => ({ ...value, sourceYear: event.target.value }))}/></label>
          <label>{t(lang, "分享授权依据", "Sharing permission notes")}<input value={archiveMeta.licenseName} onChange={(event) => setArchiveMeta((value) => ({ ...value, licenseName: event.target.value }))} placeholder={t(lang, "例如：本人原创；出版方授权小组使用", "For example: my own work; publisher permitted group use")}/><small className="muted">{t(lang, "“组内可见”是访问范围，请另行记录可分享的依据。", "Group visibility is an access setting. Record the basis for sharing separately.")}</small></label>
          <label className="source-url-field">{t(lang, "来源链接（可选）", "Source URL (optional)")}<input type="url" value={archiveMeta.sourceUrl} onChange={(event) => setArchiveMeta((value) => ({ ...value, sourceUrl: event.target.value }))}/></label>
        </div>
        <input type="file" accept=".pdf,application/pdf" multiple onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          setFiles((previous) => [...previous.filter((old) => !selected.some((file) => file.name === old.name && file.size === old.size && file.lastModified === old.lastModified)), ...selected]);
          setQueue((previous) => [...previous, ...selected.map((file) => ({ id: `${file.name}:${file.size}:${file.lastModified}`, name: file.name, size: file.size, state: "queued" as const, progress: 0 }))]);
          event.target.value = "";
        }}/>
        {capacity && <p className="muted small">{t(lang, "已使用", "Used")} {formatBytes(capacity.usedBytes)} / {formatBytes(capacity.maxBytes)} · {t(lang, "剩余", "Available")} {formatBytes(Math.max(0, capacity.maxBytes - capacity.usedBytes))}</p>}
        <div className="button-row"><button className="button primary" onClick={() => void runQueue()} disabled={!queue.some((item) => ["queued", "paused", "error"].includes(item.state))}><Upload size={16}/>{t(lang, "开始 / 继续上传", "Start / resume uploads")}</button><button className="button secondary" onClick={() => { setFiles([]); setQueue([]); }} disabled={queue.some((item) => item.state === "uploading")}>{t(lang, "清空队列", "Clear queue")}</button></div>
        {!!queue.length && <div className="source-upload-queue">{queue.map((item) => <div className="source-upload-row" key={item.id}><div className="source-upload-copy"><strong>{item.name}</strong><span>{formatBytes(item.size)} · {item.state === "done" ? t(lang, "已完成", "Complete") : item.state === "uploading" ? `${t(lang, "上传中", "Uploading")} ${item.progress}%` : item.state === "hashing" ? t(lang, "计算 SHA-256…", "Calculating SHA-256…") : item.state === "paused" ? t(lang, "已暂停", "Paused") : item.state === "error" ? item.error : t(lang, "等待上传", "Queued")}</span></div><progress max={100} value={item.progress}/>{item.state === "uploading" && <button className="icon-button" aria-label={t(lang, "暂停", "Pause")} onClick={() => pauseUpload(item.id)}><Pause size={16}/></button>}</div>)}</div>}
      </section>
      {loadError && <div className="notice info">{loadError}</div>}
      <section className="card"><div className="card-top"><div><h3>{t(lang, "原始资料", "Original archive")}</h3><p className="muted small">{t(lang, "资料默认私有；组内共享的原件对所有有效成员可见，练习和识别内容仍归上传者管理。", "Documents are private by default. Group-shared originals are visible to active members; practice and review data remain owner-managed.")}</p></div><span className="soft-tag">{documents.length}</span></div><div className="library-toolbar"><div className="search-field"><input value={docSearch} onChange={(event) => setDocSearch(event.target.value)} placeholder={t(lang, "搜索标题、来源或作者", "Search title, source or author")}/></div><select value={docKindFilter} onChange={(event) => setDocKindFilter(event.target.value)}><option value="all">{t(lang, "全部类别", "All types")}</option>{["questions", "vocabulary", "reference", "plan", "mixed", "unknown"].map((kind) => <option value={kind} key={kind}>{sourceLabel(lang, kind)}</option>)}</select><select value={docSkillFilter} onChange={(event) => setDocSkillFilter(event.target.value)}><option value="all">{t(lang, "全部科目", "All skills")}</option>{["reading", "listening", "writing", "speaking"].map((skill) => <option value={skill} key={skill}>{sourceLabel(lang, skill)}</option>)}</select></div>{loading ? <p className="muted">{t(lang, "正在读取…", "Loading…")}</p> : filteredDocuments.length ? <div className="source-document-list">{filteredDocuments.map((document) => <article className="source-document-row" key={document.id}><FileText size={19}/><div className="source-upload-copy"><strong>{document.title}</strong><span>{document.original_name} · {formatBytes(document.byte_size)}{document.page_count ? ` · ${document.page_count} 页` : ""} · {document.status === "ready" ? t(lang, "已存档", "Archived") : t(lang, "上传未完成", "Upload incomplete")}{document.members_visible ? ` · ${t(lang, "组内可见", "Group visible")}` : ` · ${t(lang, "仅自己可见", "Private")}`}</span><span>{document.source_title}{document.author ? ` · ${document.author}` : ""}{document.source_year ? ` · ${document.source_year}` : ""} · {document.content_kind} · {(document.skill_tags?.length ? document.skill_tags : [document.skill].filter(Boolean)).join(" / ")} · {t(lang, "识别进度", "Parsing")}：{document.parse_status === "review" ? t(lang, "等待审核", "Review") : document.parse_status === "complete" ? t(lang, "已审核", "Complete") : document.parse_status === "failed" ? t(lang, "失败", "Failed") : `${document.parsed_pages}${document.page_count ? ` / ${document.page_count}` : ""} ${t(lang, "页", "pages")}`}</span>{(document.members_visible || document.license_name.trim() || document.rights_attestation) && <span className={document.members_visible && !document.license_name.trim() ? "source-license-warning" : "source-license-note"}>{document.license_name.trim() ? t(lang, `授权依据：${document.license_name}`, `Permission: ${document.license_name}`) : document.rights_attestation ? document.rights_attestation : t(lang, "组内可见 · 授权依据待补充", "Group visible · permission notes pending")}</span>}{document.canManageSharing && <button type="button" className="source-license-edit" onClick={() => { setEditingLicenseId(editingLicenseId === document.id ? null : document.id); setLicenseDraft(document.license_name); }} aria-expanded={editingLicenseId === document.id}>{t(lang, "编辑授权依据", "Edit permission notes")}</button>}{editingLicenseId === document.id && <div className="source-license-editor"><label>{t(lang, "可分享的依据", "Basis for sharing")}<input value={licenseDraft} onChange={(event) => setLicenseDraft(event.target.value)} maxLength={500} placeholder={t(lang, "例如：本人原创；出版方授权小组使用", "For example: my own work; publisher permitted group use")}/></label><div className="button-row"><button type="button" className="button primary small" disabled={savingLicense} onClick={() => void saveLicense(document.id)}>{savingLicense ? t(lang, "保存中…", "Saving…") : t(lang, "保存依据", "Save notes")}</button><button type="button" className="button secondary small" onClick={() => setEditingLicenseId(null)}>{t(lang, "取消", "Cancel")}</button></div></div>}</div>{document.canManageSharing && document.status === "ready" && <button className="button secondary small" disabled={sharingId === document.id} onClick={() => void toggleDocumentSharing(document)} aria-label={document.members_visible ? t(lang, `停止分享 ${document.title}`, `Stop sharing ${document.title}`) : t(lang, `分享 ${document.title}`, `Share ${document.title}`)}><Users size={15}/>{sharingId === document.id ? t(lang, "保存中…", "Saving…") : document.members_visible ? t(lang, "停止分享", "Stop sharing") : t(lang, "分享给成员", "Share with members")}</button>}{document.status === "ready" && <button className="button secondary small" onClick={() => void apiFetch(client, `/api/source-documents/${document.id}/url`).then((result) => window.open((result as {url:string}).url, "_blank", "noopener,noreferrer")).catch((error) => notify(error instanceof Error ? error.message : "无法打开 PDF"))}>{t(lang, "打开 PDF", "Open PDF")}</button>}{document.canManageSharing && <button className="button secondary small" disabled={deletingId === document.id} onClick={() => void deleteDocument(document)} aria-label={t(lang, `删除 ${document.title}`, `Delete ${document.title}`)}>{deletingId === document.id ? t(lang, "删除中…", "Deleting…") : t(lang, "删除", "Delete")}</button>}</article>)}</div> : <div className="empty-inline"><FileText size={28}/><strong>{t(lang, "没有匹配资料", "No matching documents")}</strong><p>{t(lang, "调整筛选条件或添加原始 PDF。", "Adjust filters or add original PDFs.")}</p></div>}</section>
      {mineruConnection && <section className="card mineru-connection-card"><div className="card-top"><div><h3>{t(lang, "本机 MinerU 已连接", "Local MinerU connected")}</h3><p className="muted small">{t(lang, "令牌只显示在此页内，30 分钟后失效；再次生成会立即撤销旧令牌。", "This token is shown only here and expires in 30 minutes. Creating another revokes it.")}</p></div><button className="icon-button" onClick={() => setMineruConnection(null)} aria-label={t(lang, "关闭令牌", "Close token")}>×</button></div><code className="mineru-token">{mineruConnection.token}</code><p className="muted small">{t(lang, "在同一台已安装 MinerU 的电脑上运行脚本。PDF 原件必须是已存档文件的同一份本地文件；先用 MinerU 完成全文标准解析，再指定需要送审的页码范围。", "Run the helper on the MinerU computer with the exact archived local PDF. Complete standard parsing first, then specify pages to send for review.")}</p><pre className="mineru-command">node scripts/mineru-push-review.mjs --pdf "本机 PDF 完整路径" --document "{mineruConnection.documentId}" --token "{mineruConnection.token}" --pages 1-20 --api "{window.location.origin}"</pre><button className="button secondary" onClick={() => void navigator.clipboard.writeText(`node scripts/mineru-push-review.mjs --pdf "本机 PDF 完整路径" --document "${mineruConnection.documentId}" --token "${mineruConnection.token}" --pages 1-20 --api "${window.location.origin}"`).then(() => notify(t(lang, "命令已复制", "Command copied"))).catch(() => notify(t(lang, "复制失败，请手动复制命令", "Copy failed; copy the command manually")))}>{t(lang, "复制命令", "Copy command")}</button></section>}
    </div>
  );

  return (
    <div className="source-review-layout">
      <section className="card source-import-card"><div className="card-top"><div><h3>{t(lang, "导入 MinerU 识别包", "Import MinerU review bundle")}</h3><p className="muted small">{t(lang, "先用 MinerU 完成全文解析，再导入按原页标记的 JiawenLex JSON 审核包。导入后仍需逐条核对。", "Parse the full PDF with MinerU, then import a JiawenLex JSON bundle with source page numbers. Every item still needs review.")}</p></div></div><div className="form-grid"><label>{t(lang, "原始资料", "Source PDF")}<select value={importTarget} onChange={(event) => setImportTarget(event.target.value)}><option value="">{t(lang, "选择已存档 PDF", "Select archived PDF")}</option>{documents.filter((document) => document.status === "ready" && document.canManageSharing).map((document) => <option value={document.id} key={document.id}>{document.title}</option>)}</select></label><label>{t(lang, "MinerU 审核包 JSON", "MinerU review bundle JSON")}<input ref={importInput} type="file" accept="application/json,.json" disabled={!importTarget || importing} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importMineruBundle(file); }}/></label></div>{importing && <p className="muted">{t(lang, "正在导入审核内容…", "Importing review candidates…")}</p>}</section>
      <section className="card"><div className="library-toolbar"><label>{t(lang, "文件", "Document")}<select value={reviewDocumentFilter} onChange={(event) => { setReviewPage(1); setReviewDocumentFilter(event.target.value); }}><option value="">{t(lang, "全部文件", "All documents")}</option>{documents.filter((document) => document.canManageSharing).map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</select></label><label>{t(lang, "科目", "Skill")}<select value={reviewSkillFilter} onChange={(event) => { setReviewPage(1); setReviewSkillFilter(event.target.value); }}><option value="">{t(lang, "全部科目", "All skills")}</option>{["reading", "listening", "writing", "speaking"].map((skill) => <option key={skill} value={skill}>{sourceLabel(lang, skill)}</option>)}</select></label><label>{t(lang,"内容","Content")}<select value={reviewContentFilter} onChange={event=>{setReviewPage(1);setReviewContentFilter(event.target.value);}}><option value="">{t(lang,"全部内容","All content")}</option><option value="question">{t(lang,"练习题","Exercises")}</option><option value="vocabulary">{t(lang,"词卡","Word cards")}</option><option value="note">{t(lang,"方法笔记","Study guides")}</option></select></label><label>{t(lang, "状态", "Status")}<select value={reviewStatus} onChange={(event) => { setReviewPage(1); setReviewStatus(event.target.value); }}>{["open", "pending", "edited", "published", "rejected", "all"].map((status) => <option key={status} value={status}>{sourceLabel(lang, status)}</option>)}</select></label></div><div className="button-row"><button className="button secondary small" disabled={loading || reviewPage <= 1} onClick={() => setReviewPage((page) => page - 1)}>{t(lang, "上一页", "Previous")}</button><span className="muted small">{reviewPage} / {Math.max(1, Math.ceil(reviewCount / 30))} · {reviewCount} {t(lang, "条", "items")}</span><button className="button secondary small" disabled={loading || reviewPage * 30 >= reviewCount} onClick={() => setReviewPage((page) => page + 1)}>{t(lang, "下一页", "Next")}</button></div></section>
      {loadError && <div className="notice info">{loadError}</div>}
      <section className="card"><div className="card-top"><div><h3>{t(lang, "待审核内容", "Items to review")}</h3><p className="muted small">{t(lang, "确认原文、答案与页码后，再发布到练习或词汇。", "Check the original text, answers and page before publishing to practice or vocabulary.")}</p></div><span className="soft-tag">{review.length}</span></div>{loading ? <p className="muted" role="status">{t(lang, "正在读取审核内容…", "Loading review items…")}</p> : !review.length ? <div className="empty-inline"><Check size={28}/><strong>{t(lang, "审核队列为空", "The review queue is empty")}</strong><p>{t(lang, "从已解析的原始 PDF 导入 MinerU 审核包。", "Import a MinerU bundle from a parsed original PDF.")}</p></div> : <div className="source-review-list">{review.map((candidate) => <button type="button" className={`source-review-item ${selectedCandidateId === candidate.id ? "selected" : ""}`} key={candidate.id} onClick={() => setSelectedCandidateId(candidate.id)}><span className="source-review-kind">{sourceLabel(lang, candidate.content_kind)}</span><strong>{documentById.get(candidate.document_id)?.title ?? t(lang, "来源资料", "Source document")}</strong><span>{candidate.section_title || t(lang, `第 ${candidate.physical_page} 页`, `Page ${candidate.physical_page}`)} · {candidate.printed_page && `${t(lang, "印刷页码", "Printed page")} ${candidate.printed_page}`}</span><small>{String(candidate.payload.term ?? candidate.payload.prompt ?? candidate.payload.text ?? candidate.payload.title ?? "").slice(0, 180)}</small></button>)}</div>}</section>
      {client && (selectedCandidate || reviewDocumentFilter) && <div className="source-page-audit">
        {!selectedCandidate && <label>{t(lang, "核对页码", "Page to review")}<input type="number" min={1} max={documents.find((document) => document.id === reviewDocumentFilter)?.page_count ?? 1} value={auditPhysicalPage} onChange={(event) => setAuditPhysicalPage(Math.max(1, Math.min(documents.find((document) => document.id === reviewDocumentFilter)?.page_count ?? 1, Number(event.target.value) || 1)))} /></label>}
        <PageAuditControls client={client} lang={lang} documentId={selectedCandidate?.document_id ?? reviewDocumentFilter} physicalPage={selectedCandidate?.physical_page ?? auditPhysicalPage} notify={notify} />
      </div>}
      <section className="card"><div className="button-row"><button className="button primary" disabled={batchBusy} onClick={()=>void publishVerifiedBatch()}>{batchBusy?t(lang,"正在发布…","Publishing…"):administratorApproval?t(lang,"批准发布待审核内容","Approve pending publication"):t(lang,"一键发布全部已核验内容","Publish all verified items")}</button><label><input type="checkbox" checked={groupPublish} onChange={e=>setGroupPublish(e.target.checked)}/>{t(lang,"同时向组内成员发布（管理员）","Publish to group members (admin)")}</label>{isAdmin&&<label><input type="checkbox" checked={administratorApproval} disabled={batchBusy} onChange={e=>{setAdministratorApproval(e.target.checked);if(e.target.checked)setGroupPublish(true);}}/>{t(lang,"管理员批准（保留原页待核验标识）","Administrator approval (source review still pending)")}</label>}</div><p className="muted small">{t(lang,"每批最多 20 条；不会自动勾选核验。缺配套、重复未处理或有识别疑点的内容会说明原因。","Up to 20 per batch. Unchecked, incomplete or unresolved items stay pending.")}</p>{batchMessage&&<p role="status">{batchMessage}</p>}</section>
      {selectedCandidate && (reviewKind === "vocabulary" || reviewKind === "note") && <label className="question-report-check"><input type="checkbox" checked={confirmedSource} onChange={(event) => setConfirmedSource(event.target.checked)} />{t(lang, "已对照原页核对文字、含义、语境和例句。", "I checked the term, definition, context and example against the source PDF.")}</label>}
      {selectedCandidate && reviewKind === "question" && <section className="card"><h3>{t(lang, "发布前核验", "Review before publication")}</h3>{Boolean(selectedCandidate.payload.possible_duplicate_of) && <p className="notice info">{t(lang, "发现相同题干：请检查已有题目。同题的不同范文应合并为参考答案变体；确实是不同题目时，在 JSON 中填写 duplicate_resolution=distinct 和至少 10 字的 duplicate_note。", "A matching prompt exists. Merge alternate sample answers into the existing question. If this is genuinely distinct, set duplicate_resolution=distinct and add a duplicate_note of at least 10 characters in the JSON.")}</p>}<label className="question-report-check"><input type="checkbox" checked={confirmedSource} onChange={(event) => setConfirmedSource(event.target.checked)} />{t(lang, "已逐题对照 PDF 原页，核对题干、选项及所需文章或图表。", "I compared every question, option and required passage or figure with the source PDF.")}</label><label className="question-report-check"><input type="checkbox" checked={confirmedAnswers} onChange={(event) => setConfirmedAnswers(event.target.checked)} />{t(lang, "已核对答案对应页；缺答案的题明确保留为未判分，开放回答不设唯一答案。", "I checked the answer source; unanswered and open questions remain unscored.")}</label></section>}
      {selectedCandidate && <section className="card source-review-detail"><div className="card-top"><div><h3>{selectedCandidate.content_kind === "vocabulary" ? t(lang, "核对词汇", "Review vocabulary") : selectedCandidate.content_kind === "question" ? t(lang, "核对练习题", "Review exercise") : t(lang, "核对原文摘录", "Review extracted text")}</h3><p className="muted small">{documentById.get(selectedCandidate.document_id)?.title} · {t(lang, "PDF 物理页", "PDF page")} {selectedCandidate.physical_page}{selectedCandidate.printed_page ? ` · ${t(lang, "书页", "Printed page")} ${selectedCandidate.printed_page}` : ""}</p></div><button className="icon-button" aria-label={t(lang, "关闭审核内容", "Close review item")} onClick={() => setSelectedCandidateId(null)}><X size={17}/></button></div><label className="review-kind-select">{t(lang, "内容类别", "Content type")}<select value={reviewKind} onChange={(event) => setReviewKind(event.target.value as ReviewCandidate["content_kind"])}><option value="page_text">{t(lang, "原文摘录", "Extracted page text")}</option><option value="question">{t(lang, "练习题", "Exercise")}</option><option value="vocabulary">{t(lang, "词汇", "Vocabulary")}</option><option value="reference_answer">{t(lang, "参考答案", "Reference answer")}</option><option value="figure">{t(lang, "图表", "Figure")}</option><option value="note">{t(lang, "笔记", "Note")}</option></select></label><div className="button-row"><button className="button secondary small" disabled={previewPhysicalPage <= 1} onClick={() => setPreviewPhysicalPage((page) => page - 1)}>{t(lang, "上一页原文", "Previous PDF page")}</button><span className="muted small">{previewPhysicalPage} / {documentById.get(selectedCandidate.document_id)?.page_count ?? "?"}</span><button className="button secondary small" disabled={previewPhysicalPage >= (documentById.get(selectedCandidate.document_id)?.page_count ?? previewPhysicalPage)} onClick={() => setPreviewPhysicalPage((page) => page + 1)}>{t(lang, "下一页原文", "Next PDF page")}</button></div><div className="source-review-columns"><div className="source-page-preview">{previewUrl ? <iframe title={t(lang, "PDF 原文页", "Original PDF page")} src={`${previewUrl}#page=${previewPhysicalPage}`} /> : <p className="muted">{t(lang, "正在载入原页…", "Loading source page…")}</p>}</div><label className="source-payload-editor">{t(lang, "识别内容（JSON）", "Extracted content (JSON)")}<textarea rows={22} value={payloadText} onChange={(event) => setPayloadText(event.target.value)} spellCheck={false}/></label></div><div className="button-row"><button className="button secondary" onClick={() => void reviewAction("save")}>{t(lang, "保存修改", "Save edits")}</button>{reviewKind === "question" && <button className="button primary" onClick={() => void reviewAction("publish_question")}>{t(lang, "核验并发布为练习", "Verify and publish exercise")}</button>}{reviewKind === "vocabulary" && <button className="button primary" onClick={() => void reviewAction("publish_vocabulary")}>{t(lang, "核验并加入词库", "Verify and add to vocabulary")}</button>}{reviewKind === "note" && <button className="button primary" onClick={() => void reviewAction("publish_guide")}>{t(lang,"核验并发布为方法笔记","Verify and publish guide")}</button>}<button className="button danger-outline" onClick={() => void reviewAction("reject")}>{t(lang, "忽略此条", "Reject this item")}</button></div></section>}
    </div>
  );
}
