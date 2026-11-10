/** ORXELIA legal review gate: pure evaluation; never approves publication or spending. */
export const CHECKS = Object.freeze([
  {id:'regulation',label:'事業規制・許認可',required:true},
  {id:'trademark',label:'商標・サービス名・ロゴ',required:true},
  {id:'copyright',label:'著作権・素材利用',required:true},
  {id:'terms',label:'利用規約・契約条件',required:true},
  {id:'privacy',label:'個人情報・委託・国外取扱い',required:true},
  {id:'sales',label:'販売者・料金・解約表示',required:true},
  {id:'security',label:'認証・権限・決済安全性',required:true}
]);
const STATES=new Set(['unreviewed','in_review','passed','blocked','expert_review']);
export function assessLegalGate(review) {
  const findings=[];
  for(const c of CHECKS){
    const item=review?.checks?.[c.id];
    if(!item||!STATES.has(item.status)){findings.push({id:c.id,reason:'未審査'});continue;}
    if(item.status!=='passed'){findings.push({id:c.id,reason:item.status});continue;}
    if(!Array.isArray(item.evidence)||!item.evidence.length||!item.reviewedAt||!item.reviewer){
      findings.push({id:c.id,reason:'根拠・確認日・確認者が不足'});
    }
  }
  const blockers=(Array.isArray(review?.risks)?review.risks:[]).filter(r=>r.severity==='critical'||(r.severity==='high'&&r.status==='open'));
  const eligible=findings.length===0&&blockers.length===0&&Boolean(review?.version);
  return {status:eligible?'ready_for_development_approval':'legal_hold',eligible,findings,blockers,disclaimer:'法務ゲート通過は適法性の保証ではありません。開発・販売・支出・公開は別々の明示承認が必要です。'};
}
export function canStartDevelopment(review,approval){
  return assessLegalGate(review).eligible&&approval?.decision==='approved'&&approval?.scope==='development'&&Boolean(approval?.approvedBy)&&Boolean(approval?.approvedAt)&&approval?.reviewVersion===review?.version;
}
export function canPublish(){return false;}
