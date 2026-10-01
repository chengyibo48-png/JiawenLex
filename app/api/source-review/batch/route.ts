import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, authenticatedDb, HttpError, requireUser } from "@/lib/server-auth";
import { PATCH as publish } from "../route";
export const maxDuration = 60;
export async function POST(request:Request) {
  try {
    const {userId,admin,profile}=await requireUser(request);
    const input=z.object({ids:z.array(z.string().uuid()).min(1).max(20),shared:z.boolean().default(false),administratorApproval:z.boolean().default(false)}).parse(await request.json());
    if(input.administratorApproval && (!input.shared || profile.role!=="admin"))throw new HttpError(403,"管理员批准发布需要管理员和组内分享");
    if(input.shared&&profile.role!=="admin")throw new HttpError(403,"仅管理员可以审批组内发布");
    const results:{id:string;published:boolean;error?:string}[]=[];
    const wordRows=await admin.from("source_review_candidates").select("id").eq("owner_id",userId).eq("content_kind","vocabulary").in("id",input.ids);
    if(wordRows.error)throw wordRows.error;
    const wordIds=new Set<string>((wordRows.data??[]).map(row=>row.id));
    if(wordIds.size){
      const words=await authenticatedDb(request).rpc(input.administratorApproval ? "publish_administrator_word_cards" : "publish_verified_word_cards",{p_ids:[...wordIds],p_shared:input.shared});
      if(words.error)throw words.error;
      results.push(...words.data);
    }
    for(const id of [...new Set(input.ids)]) {
      if(wordIds.has(id))continue;
      const found=await admin.from("source_review_candidates").select("id,content_kind,payload,status,published_material_id,document_id").eq("id",id).eq("owner_id",userId).maybeSingle();
      if(found.error)throw found.error;
      const row=found.data;
      if(!row){results.push({id,published:false,error:"候选不可访问"});continue;}
      // Batch actions never turn unchecked OCR into verified content.
      if(row.status==="published") {
        if(input.shared&&(row.published_material_id||row.content_kind==="note")){
          const source=await admin.from("source_documents").select("rights_attested_at").eq("id",row.document_id).eq("owner_id",userId).single();
          if(source.error||!source.data.rights_attested_at){results.push({id,published:false,error:"未记录发布授权声明"});continue;}
          const result=await authenticatedDb(request).from(row.content_kind==="note"?"study_guides":"materials").update({visibility:"shared",approval:"approved"}).eq("id",row.published_material_id??row.id).eq("owner_id",userId).select("id");
          if(result.error||!result.data?.length){results.push({id,published:false,error:result.error?.message??"练习不可访问"});continue;}
        }
        results.push({id,published:true});continue;
      }
      const action=({question:"publish_question",vocabulary:"publish_vocabulary",note:"publish_guide"} as Record<string,string>)[row.content_kind];
      if(!action){results.push({id,published:false,error:"此内容不是可发布的题目、词卡或方法笔记"});continue;}
      const response=await publish(new Request(request.url,{method:"PATCH",headers:request.headers,body:JSON.stringify({candidateId:id,action,shared:input.shared,administratorApproval:input.administratorApproval})}));
      const body=await response.json();results.push({id,published:response.ok,...(!response.ok?{error:body.error??"发布失败"}:{})});
    }
    return NextResponse.json({results,published:results.filter(r=>r.published).length,remaining:results.filter(r=>!r.published).length});
  } catch(error){return apiError(error);}
}
