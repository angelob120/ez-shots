'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
async function trackerAnalytics(db,req,url){
  const key=String(process.env.TRACKER_INGEST_KEY||'').trim();
  const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');
  const digest=s=>createHash('sha256').update(s).digest();
  if(!key||!timingSafeEqual(digest(key),digest(supplied)))return {status:401,data:{error:'unauthorized'}};
  if(!db)return {status:503,data:{error:'analytics_unavailable'}};
  const days=Math.min(365,Math.max(1,Number(url.searchParams.get('days'))||90));
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Detroit",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const from=new Date(today+"T00:00:00Z");from.setUTCHours(0,0,0,0);from.setUTCDate(from.getUTCDate()-days+1);
  const until=new Date(today+"T00:00:00Z");until.setUTCHours(0,0,0,0);until.setUTCDate(until.getUTCDate()+1);
  const {rows}=await db.query(`WITH data AS (
    SELECT at,CASE name WHEN 'view' THEN 'page_views' WHEN 'cta' THEN 'cta_clicks' WHEN 'book_step' THEN 'checkout_steps' WHEN 'booked' THEN 'booking_submissions' WHEN 'contact' THEN 'contact_submissions' END AS metric,1::bigint AS value FROM analytics_events
    UNION ALL SELECT coalesce(paid_at,created_at),'customer_sales',1 FROM bookings WHERE paid AND checkout_mode NOT IN ('stub','test')
    UNION ALL SELECT coalesce(paid_at,created_at),'platform_revenue_cents',amount*100-refunded_cents FROM bookings WHERE paid AND checkout_mode NOT IN ('stub','test')
    UNION ALL SELECT min(coalesce(paid_at,created_at)),'signups',1 FROM bookings WHERE paid AND checkout_mode NOT IN ('stub','test') GROUP BY lower(email)
  ) SELECT to_char(at AT TIME ZONE 'America/Detroit','YYYY-MM-DD') AS day,'site' AS tenant,metric,sum(value)::text AS value FROM data WHERE at >= (($1::timestamptz AT TIME ZONE 'UTC')::date AT TIME ZONE 'America/Detroit') AND at < (($2::timestamptz AT TIME ZONE 'UTC')::date AT TIME ZONE 'America/Detroit') GROUP BY 1,3 ORDER BY 1,3`,[from,until]);
  return {status:200,data:{source:'ezshots',from:from.toISOString().slice(0,10),until:until.toISOString().slice(0,10),generated_at:new Date().toISOString(),active_tenants:1,points:rows.map(p=>({...p,value:Number(p.value)})),coverage:['First-party site analytics; known bots and owner visits excluded by the existing recorder.','Sales use paid bookings, net of recorded refunds; stub and test checkout excluded.','Signups mean first paid shoot per client; client identifiers remain inside EZ Shots.','Daily Detroit-time totals; payment corrections update the original sale day.']}};
}
module.exports={trackerAnalytics};
