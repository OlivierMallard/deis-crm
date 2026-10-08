import { ValidationError } from './prospects.js';
import { parseActionFilters, dayBounds } from './actions.js';
import { parseId } from './commerce.js';

export const kinds = ['prospects','clients','actions','contracts','quotes','invoices'] as const;
export type Kind = typeof kinds[number];
export const statuses: Record<string,string[]> = { prospects:['NEW','CONTACTED','QUALIFIED','WON','LOST'], contracts:['DRAFT','PROPOSED','SIGNED','IN_PROGRESS','COMPLETED','CANCELLED'], quotes:['DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED'], invoices:['DRAFT','ISSUED','CANCELLED'] };
export function textQuery(value: unknown, key: string, max = 200) {
  if (typeof value !== 'string' || value.length > max) throw new ValidationError(`${key} : texte attendu, ${max} caractères maximum.`);
  return value.trim();
}
export function integer(value: unknown, key: string, min: number, max: number) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)<min || Number(value)>max) throw new ValidationError(`${key} : entier entre ${min} et ${max} attendu.`);
  return Number(value);
}
export function dateOnly(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(new Date(value).getTime()) || new Date(value).toISOString().slice(0,10)!==value) throw new ValidationError('Date invalide : YYYY-MM-DD attendu.');
  return value;
}
export function localBounds(date: string, zone: string) {
  // Noon in UTC anchors the requested local calendar date; adjust for extreme offsets.
  const anchor = new Date(date+'T12:00:00Z');
  const parts = new Intl.DateTimeFormat('en-CA',{ timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(anchor);
  const get = (k:string) => parts.find(p=>p.type===k)!.value;
  const actual = `${get('year')}-${get('month')}-${get('day')}`;
  anchor.setTime(anchor.getTime() + new Date(date).getTime()-new Date(actual).getTime());
  return dayBounds(zone,anchor);
}
export function parseList(kind: Kind, query: Record<string,unknown>) {
  const specific: Record<Kind,string[]> = { prospects:['status','createdFrom','createdTo'], clients:['createdFrom','createdTo'], actions:['type','prospectId','completed','period'], contracts:['clientId','status','startFrom','startTo','endFrom','endTo','amountMin','amountMax'], quotes:['clientId','contractId','status','dateFrom','dateTo','amountMin','amountMax'], invoices:['clientId','contractId','status','paymentStatus','overdue','dateFrom','dateTo','dueFrom','dueTo','amountMin','amountMax'] };
  const allowed = ['q','search','page','pageSize','sort','direction','timeZone',...specific[kind]];
  for (const key of Object.keys(query)) if (!allowed.includes(key)) throw new ValidationError(`Filtre inconnu : ${key}.`);
  for (const [key,value] of Object.entries(query)) if(typeof value!=='string') throw new ValidationError(`${key} doit être une valeur simple.`);
  const zone = query.timeZone === undefined ? kind==='invoices'?'Europe/Paris':'UTC' : textQuery(query.timeZone,'timeZone');
  dayBounds(zone);
  const page = query.page === undefined ? 1 : integer(query.page,'page',1,1000000);
  const pageSize = query.pageSize === undefined ? 25 : integer(query.pageSize,'pageSize',1,100);
  const q = query.q === undefined ? query.search === undefined ? '' : textQuery(query.search,'search') : textQuery(query.q,'q');
  const where: Record<string,unknown> = {};
  if (q) where.OR = (kind==='actions' ? ['title','description'] : ['prospects','clients'].includes(kind) ? ['firstName','lastName','company','email','phone'] : ['reference','title']).map(k=>({[k]:{contains:q,mode:'insensitive'}}));
  for(const key of ['clientId','contractId','prospectId']) if(query[key]!==undefined) where[key]=parseId(query[key]);
  if(query.status!==undefined) { const value=textQuery(query.status,'status'); if(!statuses[kind]?.includes(value)) throw new ValidationError('Statut invalide.'); where.status=value; }
  if(kind==='actions') {
    Object.assign(where,parseActionFilters(Object.fromEntries(Object.entries(query).filter(([k])=>['prospectId','completed','period','timeZone'].includes(k)))));
    if(query.type!==undefined) { if(!['CALL','EMAIL','MEETING','TASK','OTHER'].includes(String(query.type))) throw new ValidationError('Type invalide.'); where.type=query.type; }
  }
  for(const [prefix,field,calendar] of [['created','createdAt',false],['start','startDate',true],['end','endDate',true],['date','issueDate',true],['due','dueDate',true]] as const) {
    const from=query[prefix+'From'], to=query[prefix+'To'];
    if(from===undefined && to===undefined) continue;
    const a=from===undefined?undefined:dateOnly(from), b=to===undefined?undefined:dateOnly(to);
    if(a && b && a>b) throw new ValidationError('La borne minimum dépasse la borne maximum.');
    where[field]={ ...(a?{gte:calendar?new Date(a):localBounds(a,zone).start}:{}), ...(b?{lt:calendar?new Date(new Date(b).getTime()+86400000):localBounds(b,zone).end}:{}) };
  }
  if(query.amountMin!==undefined || query.amountMax!==undefined) {
    const min=query.amountMin===undefined?undefined:integer(query.amountMin,'amountMin',0,2147483647), max=query.amountMax===undefined?undefined:integer(query.amountMax,'amountMax',0,2147483647);
    if(min!==undefined && max!==undefined && min>max) throw new ValidationError('Fourchette de montant inversée.');
    where[kind==='contracts'?'amountCents':'totalExclTaxCents']={...(min!==undefined?{gte:min}:{}),...(max!==undefined?{lte:max}:{})};
  }
  if(query.paymentStatus!==undefined && !['UNPAID','PARTIAL','PAID'].includes(String(query.paymentStatus))) throw new ValidationError('État de règlement invalide.');
  if(query.overdue!==undefined && !['true','false'].includes(String(query.overdue))) throw new ValidationError('overdue doit être true ou false.');
  const sortMap: Record<Kind,Record<string,unknown>> = { prospects:{name:{lastName:'asc'},date:{createdAt:'desc'},updated:{updatedAt:'desc'}},clients:{name:{lastName:'asc'},date:{createdAt:'desc'},contracts:{contracts:{_count:'desc'}}},actions:{due:{dueAt:'asc'}},contracts:{date:{createdAt:'desc'},amount:{amountCents:'desc'},status:{status:'asc'}},quotes:{date:{issueDate:'desc'},amount:{totalExclTaxCents:'desc'}},invoices:{date:{issueDate:'desc'},due:{dueDate:'asc'},amount:{totalExclTaxCents:'desc'}} };
  const sort=query.sort===undefined?undefined:textQuery(query.sort,'sort');
  if(sort!==undefined && !sortMap[kind][sort]) throw new ValidationError('Tri invalide.');
  if(query.direction!==undefined && !['asc','desc'].includes(String(query.direction))) throw new ValidationError('direction doit être asc ou desc.');
  let primary=sort?sortMap[kind][sort]:kind==='prospects'?{createdAt:'desc'}:kind==='actions'?{dueAt:'asc'}:{id:'desc'};
  if(query.direction) { const field=Object.keys(primary as object)[0]; primary=field==='contracts'?{contracts:{_count:query.direction}}:{[field]:query.direction}; }
  return { where,page,pageSize,orderBy:[primary,{id:kind==='actions'?'asc':'desc'}],zone,paymentStatus:query.paymentStatus,overdue:query.overdue };
}
